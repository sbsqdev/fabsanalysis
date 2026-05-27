import { useState, useCallback, useEffect, useRef } from 'react';
import type { CaptureAngle, AngleCapture } from '../types';
import type { NormalizedLandmark } from '../types';
import { useFaceMesh } from '../hooks/useFaceMesh';
import { detectProfileDirection } from '../analysis/normalizeLandmarks';
import { useT } from '../lib/language';

interface Props {
  cameraVideoRef: React.Ref<HTMLVideoElement>;
  captureFrame: (mirror?: boolean) => { canvas: HTMLCanvasElement; imageData: ImageData } | null;
  onAllCaptured: (captures: AngleCapture[]) => void;
  onCancel: () => void;
  cameraLoading?: boolean;
}

const STEPS: { angle: CaptureAngle; label: string; instruction: string }[] = [
  { angle: 'front', label: 'Front', instruction: 'Look straight at the camera' },
  { angle: 'left', label: 'Left', instruction: 'Turn your head — left profile' },
  { angle: 'right', label: 'Right', instruction: 'Turn your head — right profile' },
];

// ─── Yaw estimation from face landmarks ──────────────────────────────────────
// Uses inter-eye ratio + nose offset relative to jaw midpoint.
function computeProfileYaw(landmarks: NormalizedLandmark[]): {
  yaw: number;
  ratio: number;
  signedOffset: number;
  eyeSkew: number;
} {
  const lm33  = landmarks[33];  // right eye outer
  const lm263 = landmarks[263]; // left eye outer
  const lm133 = landmarks[133]; // right eye inner
  const lm362 = landmarks[362]; // left eye inner
  const lm10  = landmarks[10];  // forehead
  const lm152 = landmarks[152]; // chin
  const jawR = landmarks[234];
  const jawL = landmarks[454];
  const nose = landmarks[1];
  if (!lm33 || !lm263 || !lm10 || !lm152 || !jawR || !jawL || !nose || !lm133 || !lm362) {
    return { yaw: 0, ratio: -1, signedOffset: 0, eyeSkew: 0 };
  }
  const interEye   = Math.abs(lm263.x - lm33.x);
  const faceHeight = Math.abs(lm152.y - lm10.y);
  const faceWidth = Math.abs(jawL.x - jawR.x);
  if (faceHeight < 0.05 || faceWidth < 0.05) return { yaw: 0, ratio: -1, signedOffset: 0, eyeSkew: 0 };
  const ratio = interEye / faceHeight;
  // Ratio-based estimate:
  //   front ~0.46, profile ~0.12 (empirical mobile range)
  const ratioYaw = Math.max(0, Math.min(1, (0.46 - ratio) / (0.46 - 0.12)));

  // Nose-offset estimate (robust when eye landmarks are noisy on profiles)
  const jawMidX = (jawR.x + jawL.x) / 2;
  const signedOffset = (nose.x - jawMidX) / faceWidth;
  const offsetYaw = Math.max(0, Math.min(1, (Math.abs(signedOffset) - 0.06) / (0.24 - 0.06)));

  // Eye skew: when one eye becomes much narrower (typical for 70°–90° profile),
  // treat this as a valid profile signal instead of requiring both eyes to be equally visible.
  const rightEyeWidth = Math.abs(lm33.x - lm133.x);
  const leftEyeWidth = Math.abs(lm263.x - lm362.x);
  const maxEyeWidth = Math.max(rightEyeWidth, leftEyeWidth);
  const eyeSkewRaw = maxEyeWidth > 1e-4
    ? Math.abs(rightEyeWidth - leftEyeWidth) / maxEyeWidth
    : 0;
  const eyeSkew = Math.max(0, Math.min(1, (eyeSkewRaw - 0.12) / (0.70 - 0.12)));

  // Weighted blend: ratio is primary signal; offset and eye skew are auxiliary.
  const yaw = Math.max(0, Math.min(1, ratioYaw * 0.60 + offsetYaw * 0.20 + eyeSkew * 0.20));
  return { yaw, ratio, signedOffset, eyeSkew };
}

export default function GuidedCaptureScreen({
  cameraVideoRef,
  captureFrame,
  onAllCaptured,
  onCancel,
  cameraLoading = false,
}: Props) {
  const t = useT();

  const stepLabel = (angle: CaptureAngle) => {
    if (angle === 'front') return t('guided.front');
    if (angle === 'left') return t('guided.left');
    return t('guided.right');
  };
  const stepInstruction = (angle: CaptureAngle) => {
    if (angle === 'front') return t('guided.frontInstruction');
    if (angle === 'left') return t('guided.leftInstruction');
    return t('guided.rightInstruction');
  };
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [captures, setCaptures] = useState<(AngleCapture | null)[]>([null, null, null]);
  const [captureHint, setCaptureHint] = useState<string | null>(null);
  const [showCaptureBadge, setShowCaptureBadge] = useState(false);
  const [showQualityChecklist, setShowQualityChecklist] = useState(true);
  const [showProfileAutoHint, setShowProfileAutoHint] = useState(false);
  const captureBadgeTimerRef = useRef<number | null>(null);
  const profileAutoHintShownRef = useRef(false);

  // ── Auto-capture for profile steps ──
  const { initialize, detect, isReady } = useFaceMesh();
  const [yawProgress, setYawProgress]   = useState(0); // 0–1 how close to profile
  const [holdProgress, setHoldProgress] = useState(0); // 0–1 countdown after target reached
  const [isAutoArmed, setIsAutoArmed] = useState(true);
  const rafRef       = useRef<number>(0);
  const holdStartRef = useRef<number | null>(null);
  const autoArmedRef = useRef(true);
  const smoothYawRef = useRef(0);
  const lastDetectRef = useRef<number>(0);
  const HOLD_MS    = 650;  // shorter hold reduces "stuck near target" feeling
  const TARGET_YAW = 0.60; // start hold threshold
  const TARGET_YAW_RELEASE = 0.52; // hysteresis: keep hold despite small jitter
  const REARM_YAW  = 0.20; // require near-frontal reset before re-arming
  const THROTTLE   = 100;  // detect at ~10fps

  const setVideoRefs = useCallback((node: HTMLVideoElement | null) => {
    videoElRef.current = node;
    if (typeof cameraVideoRef === 'function') {
      cameraVideoRef(node);
      return;
    }
    if (cameraVideoRef && 'current' in cameraVideoRef) {
      (cameraVideoRef as React.MutableRefObject<HTMLVideoElement | null>).current = node;
    }
  }, [cameraVideoRef]);

  const step = STEPS[currentStep];
  const currentCapture = captures[currentStep];
  const allCaptured = captures.every((c) => c !== null);

  const triggerCaptureBadge = useCallback(() => {
    setShowCaptureBadge(true);
    if (captureBadgeTimerRef.current !== null) {
      window.clearTimeout(captureBadgeTimerRef.current);
    }
    captureBadgeTimerRef.current = window.setTimeout(() => {
      setShowCaptureBadge(false);
      captureBadgeTimerRef.current = null;
    }, 850);
  }, []);

  const applyCapture = useCallback((capture: AngleCapture) => {
    setCaptures((prev) => {
      const next = [...prev];
      next[currentStep] = capture;
      return next;
    });
    triggerCaptureBadge();
    if (currentStep === 0 && !profileAutoHintShownRef.current) {
      profileAutoHintShownRef.current = true;
      setShowProfileAutoHint(true);
    }
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  }, [currentStep, triggerCaptureBadge]);

  const handleCapture = useCallback(() => {
    // Capture NON-mirrored frame for analysis (canonical orientation).
    // The <video> element is visually mirrored via CSS scaleX(-1) for natural UX.
    const result = captureFrame(false);
    if (!result) {
      setCaptureHint(t('guided.cameraStarting'));
      return;
    }
    setCaptureHint(null);

    const capture: AngleCapture = {
      canvas: result.canvas,
      imageData: result.imageData,
      angle: step.angle,
      mirrored: false,
    };
    applyCapture(capture);
  }, [captureFrame, step.angle, applyCapture]);

  // Pre-load MediaPipe on mount so it's ready for profile steps
  useEffect(() => { initialize(); }, [initialize]);

  useEffect(() => {
    return () => {
      if (captureBadgeTimerRef.current !== null) {
        window.clearTimeout(captureBadgeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!showQualityChecklist) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setShowQualityChecklist(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showQualityChecklist]);

  // Arm/disarm auto-capture when step changes.
  // For each profile step we require a brief re-center first to avoid instant
  // auto-shot from previous step orientation.
  useEffect(() => {
    const isProfileStep = currentStep > 0;
    const alreadyCaptured = captures[currentStep] !== null;
    if (!isProfileStep || alreadyCaptured) {
      autoArmedRef.current = true;
      setIsAutoArmed(true);
      return;
    }
    const prevStep = currentStep - 1;
    const prevWasProfile = prevStep > 0;
    const prevCaptured = prevStep >= 0 && captures[prevStep] !== null;
    const shouldRequireRearm = prevWasProfile && prevCaptured;

    autoArmedRef.current = !shouldRequireRearm;
    setIsAutoArmed(!shouldRequireRearm);
    if (shouldRequireRearm) {
      smoothYawRef.current = 0;
      setYawProgress(0);
      holdStartRef.current = null;
      setHoldProgress(0);
    }
  }, [currentStep, captures]);

  // Detection loop — only active for profile steps without a capture
  useEffect(() => {
    const isProfileStep = currentStep > 0;
    const alreadyCaptured = captures[currentStep] !== null;

    if (!isProfileStep) {
      cancelAnimationFrame(rafRef.current);
      setYawProgress(0);
      setHoldProgress(0);
      smoothYawRef.current = 0;
      holdStartRef.current = null;
      return;
    }
    if (showProfileAutoHint) {
      cancelAnimationFrame(rafRef.current);
      setHoldProgress(0);
      smoothYawRef.current = 0;
      holdStartRef.current = null;
      return;
    }
    if (alreadyCaptured) {
      cancelAnimationFrame(rafRef.current);
      setHoldProgress(0);
      smoothYawRef.current = 0;
      holdStartRef.current = null;
      return;
    }

    const loop = (timestamp: number) => {
      rafRef.current = requestAnimationFrame(loop);
      if (!isReady) return;
      if (timestamp - lastDetectRef.current < THROTTLE) return;
      lastDetectRef.current = timestamp;

      const videoEl = videoElRef.current;
      if (!videoEl || videoEl.readyState < 2) return;

      const result = detect(videoEl);
      if (!result) {
        console.log('[ProfileYaw] detect returned null, readyState:', videoEl.readyState);
        setYawProgress(0); setHoldProgress(0);
        smoothYawRef.current = 0;
        holdStartRef.current = null;
        return;
      }

      const { yaw, ratio, signedOffset, eyeSkew } = computeProfileYaw(result.landmarks);
      const direction = detectProfileDirection(result.landmarks);
      const sideProgress = Math.max(0, Math.min(1, (Math.abs(signedOffset) - 0.05) / (0.20 - 0.05)));
      const ratioProfileProgress = ratio > 0
        ? Math.max(0, Math.min(1, (0.30 - ratio) / (0.30 - 0.14)))
        : 0;
      const gatedYaw = yaw * (0.92 + 0.08 * sideProgress);
      const smoothedYaw = smoothYawRef.current * 0.45 + gatedYaw * 0.55;
      smoothYawRef.current = smoothedYaw;
      const visualYaw = Math.max(
        smoothedYaw,
        ratioProfileProgress * 0.92,
        eyeSkew * 0.88,
      );

      if (Math.random() < 0.15) {
        console.log(
          '[ProfileYaw]',
          'ratio=', ratio.toFixed(3),
          'yaw=', (smoothedYaw * 100).toFixed(0) + '%',
          'visual=', (visualYaw * 100).toFixed(0) + '%',
          'ratioP=', ratioProfileProgress.toFixed(2),
          'side=', sideProgress.toFixed(2),
          'eyeSkew=', eyeSkew.toFixed(2),
          'dir=', direction,
        );
      }

      if (!autoArmedRef.current) {
        const isFrontalNow = direction === 'frontal' || smoothedYaw <= REARM_YAW;
        if (isFrontalNow) {
          autoArmedRef.current = true;
          setIsAutoArmed(true);
        } else {
          setIsAutoArmed(false);
          setYawProgress(visualYaw);
          setHoldProgress(0);
          holdStartRef.current = null;
          return;
        }
      }

      setYawProgress(visualYaw);

      const strongCueCount =
        Number(sideProgress >= 0.30) +
        Number(ratioProfileProgress >= 0.68) +
        Number(eyeSkew >= 0.50);
      const hasProfileCue = strongCueCount >= 2;
      const canContinueHold = holdStartRef.current !== null && visualYaw >= TARGET_YAW_RELEASE;
      const canStartHold = visualYaw >= TARGET_YAW;

      if (hasProfileCue && (canStartHold || canContinueHold)) {
        if (!holdStartRef.current) holdStartRef.current = timestamp;
        const hp = Math.min(1, (timestamp - holdStartRef.current) / HOLD_MS);
        setHoldProgress(hp);
        if (hp >= 1) {
          holdStartRef.current = null;
          setHoldProgress(0);
          cancelAnimationFrame(rafRef.current);
          // Trigger capture
          const frameResult = captureFrame(false);
          if (frameResult) {
            applyCapture({
              canvas: frameResult.canvas,
              imageData: frameResult.imageData,
              angle: STEPS[currentStep].angle,
              mirrored: false,
            });
          }
        }
      } else {
        holdStartRef.current = null;
        setHoldProgress(0);
      }
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, captures, isReady, captureFrame, applyCapture, showProfileAutoHint]);

  const handleRetake = useCallback((index: number) => {
    setCurrentStep(index);
    setCaptures((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col items-center justify-start pt-4 px-4 pb-4">
      <style>{`
        @keyframes capture-pop {
          0% { opacity: 0; transform: scale(0.72); }
          25% { opacity: 1; transform: scale(1.03); }
          100% { opacity: 0; transform: scale(1.12); }
        }
      `}</style>
      {/* Spacer */}
      <div className="mb-1" />

      {/* Step tabs — single line */}
      <div className="flex items-center gap-2 mb-3 w-full justify-center">
        {STEPS.map((s, i) => (
          <button
            key={s.angle}
            onClick={() => setCurrentStep(i)}
            className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
              i === currentStep
                ? 'bg-brand-100 text-brand-700'
                : captures[i]
                  ? 'bg-emerald-50 text-emerald-600'
                  : 'bg-gray-100 text-gray-400'
            }`}
          >
            {captures[i] ? '✓ ' : ''}{stepLabel(s.angle)}
          </button>
        ))}
      </div>

      {/* Camera feed */}
      <div className="relative rounded-2xl overflow-hidden shadow-lg border border-gray-200 w-full max-w-sm" style={{ height: '60vh', maxHeight: '60vh' }}>
        <video
          ref={setVideoRefs}
          className="w-full h-full rounded-2xl"
          autoPlay
          playsInline
          muted
          style={{ transform: 'scaleX(-1)', objectFit: 'cover', display: 'block' }}
        />

        {/* Camera loading overlay */}
        {cameraLoading && (
          <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-3 rounded-2xl">
            <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
            <p className="text-white text-sm font-medium">{t('guided.cameraStarting')}</p>
          </div>
        )}

        {/* Pose guide overlay */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          {!currentCapture && (currentStep === 0 || isAutoArmed) && (
            <PoseGuide
              angle={step.angle}
              yawProgress={yawProgress}
              holdProgress={holdProgress}
              targetYaw={TARGET_YAW}
            />
          )}
        </div>

        {/* Capture confirmation badge */}
        {showCaptureBadge && (
          <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center">
            <div
              className="w-28 h-28 rounded-full flex items-center justify-center"
              style={{
                background: 'rgba(16, 185, 129, 0.28)',
                border: '2px solid rgba(110, 231, 183, 0.85)',
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
                boxShadow: '0 0 22px rgba(16,185,129,0.45)',
                animation: 'capture-pop 850ms ease-out forwards',
              }}
            >
              <svg className="w-14 h-14 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
        )}

        {/* Top instruction banner — only for frontal step */}
        {currentStep === 0 && (
          <div className="absolute top-3 left-3 right-3">
            <div className={`backdrop-blur-sm text-white text-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${holdProgress > 0 ? 'bg-emerald-600/80' : 'bg-black/50'}`}>
              {currentCapture
                ? allCaptured
                  ? t('guided.reviewHint')
                  : stepInstruction(step.angle)
                : holdProgress > 0
                  ? t('guided.capturing')
                  : stepInstruction(step.angle)}
            </div>
          </div>
        )}

        {/* Action buttons — liquid glass overlay at bottom */}
        <div className="absolute bottom-6 left-0 right-0 flex items-center justify-center gap-2 px-3">
          {!captures[currentStep] ? (
            <>
              <button
                onClick={handleCapture}
                className={`py-4 rounded-2xl font-semibold text-base text-white transition-all active:scale-95 ${currentStep === 0 ? 'w-full max-w-xs' : 'flex-1'}`}
                style={{
                  background: 'rgba(255,255,255,0.22)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                  border: '1px solid rgba(255,255,255,0.40)',
                  boxShadow: '0 4px 24px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.3)',
                }}
              >
                {t('guided.takePhoto')}
              </button>
              {currentStep > 0 && (
                <button
                  onClick={onCancel}
                  className="flex-1 py-4 rounded-2xl font-medium text-sm text-white/80 transition-all active:scale-95"
                  style={{
                    background: 'rgba(255,255,255,0.10)',
                    backdropFilter: 'blur(16px)',
                    WebkitBackdropFilter: 'blur(16px)',
                    border: '1px solid rgba(255,255,255,0.20)',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.2)',
                  }}
                >
                  {t('guided.cancel')}
                </button>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() => handleRetake(currentStep)}
                className="flex-1 py-3 rounded-2xl font-semibold text-sm text-white transition-all active:scale-95"
                style={{
                  background: 'rgba(255,255,255,0.18)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                  border: '1px solid rgba(255,255,255,0.35)',
                  boxShadow: '0 4px 24px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.3)',
                }}
              >
                {t('guided.retake')}
              </button>
              {allCaptured ? (
                <button
                  onClick={() => onAllCaptured(captures as AngleCapture[])}
                  className="flex-1 py-3 rounded-2xl font-semibold text-sm text-white transition-all active:scale-95"
                  style={{
                    background: 'rgba(59,130,246,0.45)',
                    backdropFilter: 'blur(16px)',
                    WebkitBackdropFilter: 'blur(16px)',
                    border: '1px solid rgba(147,197,253,0.5)',
                    boxShadow: '0 4px 24px rgba(59,130,246,0.25), inset 0 1px 0 rgba(255,255,255,0.3)',
                  }}
                >
                  {t('guided.startAnalysis')}
                </button>
              ) : (
                <button
                  onClick={onCancel}
                  className="flex-1 py-3 rounded-2xl font-medium text-sm text-white/80 transition-all active:scale-95"
                  style={{
                    background: 'rgba(255,255,255,0.10)',
                    backdropFilter: 'blur(16px)',
                    WebkitBackdropFilter: 'blur(16px)',
                    border: '1px solid rgba(255,255,255,0.20)',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.2)',
                  }}
                >
                  {t('guided.cancel')}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {captureHint && (
        <p className="text-sm text-amber-600 mt-3">{captureHint}</p>
      )}

      {/* Thumbnail strip */}
      <div className="flex gap-3 mt-4 mb-4">
        {STEPS.map((s, i) => (
          <div
            key={s.angle}
            className={`relative w-20 h-20 rounded-xl overflow-hidden border-2 transition-colors cursor-pointer ${
              i === currentStep
                ? 'border-brand-400'
                : captures[i]
                  ? 'border-emerald-300'
                  : 'border-gray-200 border-dashed'
            }`}
            onClick={() => captures[i] ? handleRetake(i) : setCurrentStep(i)}
          >
            {captures[i] ? (
              <img
                src={captures[i]!.canvas.toDataURL()}
                alt={stepLabel(s.angle)}
                className="w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }} // Mirror thumbnails to match video preview UX
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gray-50">
                <span className="text-[10px] text-gray-400 text-center px-1">{stepLabel(s.angle)}</span>
              </div>
            )}
            {captures[i] && (
              <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Start analysis button removed — use the one inside camera overlay */}

      {showQualityChecklist && (
        <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white border border-gray-100 shadow-2xl p-5">
            <h3 className="font-serif text-xl text-charcoal mb-2">
              {t('guided.qualityModalTitle')}
            </h3>
            <p className="text-sm font-sans text-gray-600 mb-4">
              {t('guided.qualityModalSubtitle')}
            </p>

            <div className="space-y-2.5 mb-5">
              <div className="flex items-start gap-2.5 text-sm font-sans text-emerald-700">
                <span className="mt-0.5">✓</span>
                <span>{t('guided.qualityModalGoodHair')}</span>
              </div>
              <div className="flex items-start gap-2.5 text-sm font-sans text-emerald-700">
                <span className="mt-0.5">✓</span>
                <span>{t('guided.qualityModalGoodFaceVisible')}</span>
              </div>
              <div className="flex items-start gap-2.5 text-sm font-sans text-emerald-700">
                <span className="mt-0.5">✓</span>
                <span>{t('guided.qualityModalGoodLight')}</span>
              </div>
              <div className="h-px bg-gray-100 my-2" />
              <div className="flex items-start gap-2.5 text-sm font-sans text-red-600">
                <span className="mt-0.5">✕</span>
                <span>{t('guided.qualityModalBadAccessories')}</span>
              </div>
              <div className="flex items-start gap-2.5 text-sm font-sans text-red-600">
                <span className="mt-0.5">✕</span>
                <span>{t('guided.qualityModalBadHeadwear')}</span>
              </div>
            </div>

            <button
              type="button"
              className="w-full h-11 rounded-xl bg-charcoal text-white font-sans text-sm font-semibold hover:opacity-95 transition-opacity"
              onClick={() => setShowQualityChecklist(false)}
            >
              {t('guided.qualityModalContinue')}
            </button>
          </div>
        </div>
      )}

      {showProfileAutoHint && (
        <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white border border-gray-100 shadow-2xl p-5 text-center">
            <h3 className="font-serif text-xl text-charcoal mb-3">
              {t('guided.profileAutoModalTitle')}
            </h3>

            <p className="text-sm font-sans text-gray-700 leading-relaxed">
              {t('guided.profileAutoModalText1')}
            </p>
            <p className="text-sm font-sans text-gray-700 leading-relaxed mt-2">
              {t('guided.profileAutoModalText2')}
            </p>

            <button
              type="button"
              className="w-full h-11 rounded-xl bg-charcoal text-white font-sans text-sm font-semibold hover:opacity-95 transition-opacity mt-5"
              onClick={() => setShowProfileAutoHint(false)}
            >
              {t('guided.qualityModalContinue')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pose Guide SVG Overlay ─────────────────────────────────────────────────

function PoseGuide({
  angle,
  yawProgress,
  holdProgress,
  targetYaw,
}: {
  angle: CaptureAngle;
  yawProgress: number;
  holdProgress: number;
  targetYaw: number;
}) {
  if (angle !== 'front') {
    return (
      <ProfileRotationGuide
        angle={angle}
        yawProgress={yawProgress}
        holdProgress={holdProgress}
        targetYaw={targetYaw}
      />
    );
  }

  const strokeColor = 'rgba(92, 124, 250, 0.5)';
  const size = 300;

  return (
    <svg width={size} height={size * 1.3} viewBox="0 0 100 130" fill="none" opacity={0.6}>
      <ellipse cx="50" cy="58" rx="32" ry="42" stroke={strokeColor} strokeWidth="2" strokeDasharray="6 4" />
      <ellipse cx="36" cy="50" rx="7" ry="3.5" stroke={strokeColor} strokeWidth="1.5" />
      <ellipse cx="64" cy="50" rx="7" ry="3.5" stroke={strokeColor} strokeWidth="1.5" />
      <line x1="50" y1="45" x2="50" y2="65" stroke={strokeColor} strokeWidth="1.5" />
      <path d="M44 65 Q50 70 56 65" stroke={strokeColor} strokeWidth="1.5" fill="none" />
      <path d="M38 78 Q50 86 62 78" stroke={strokeColor} strokeWidth="1.5" fill="none" />
      <line x1="50" y1="10" x2="50" y2="20" stroke={strokeColor} strokeWidth="1" />
      <line x1="50" y1="96" x2="50" y2="106" stroke={strokeColor} strokeWidth="1" />
      <line x1="12" y1="58" x2="22" y2="58" stroke={strokeColor} strokeWidth="1" />
      <line x1="78" y1="58" x2="88" y2="58" stroke={strokeColor} strokeWidth="1" />
    </svg>
  );
}

// ─── Profile Rotation Guide ───────────────────────────────────────────────────

function ProfileRotationGuide({ angle, yawProgress, holdProgress, targetYaw }: {
  angle: 'left' | 'right';
  yawProgress: number;
  holdProgress: number;
  targetYaw: number;
}) {
  // Preview is mirrored (selfie mode): capturing "left" profile → user turns right visually.
  const visualTurnLeft = angle === 'right';
  const isAtTarget = yawProgress >= targetYaw;
  const pct = Math.min(100, Math.round((yawProgress / targetYaw) * 100));
  const holdCirc = 2 * Math.PI * 36;

  const turnLabel = visualTurnLeft ? 'Поверните голову влево' : 'Поверните голову вправо';

  return (
    <>
      <style>{`
        @keyframes prg-nudge-l { 0%,100%{transform:translateX(0)} 45%{transform:translateX(-14px)} }
        @keyframes prg-nudge-r { 0%,100%{transform:translateX(0)} 45%{transform:translateX(14px)} }
        @keyframes prg-hold-pulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.04);opacity:0.8} }
      `}</style>

      {/* ── Instruction card — top of frame ── */}
      <div className="absolute top-6 left-4 right-4 flex justify-center z-10" style={{ pointerEvents: 'none' }}>
        {isAtTarget ? (
          <div
            className="flex items-center gap-3 bg-emerald-500/90 backdrop-blur-md rounded-2xl px-5 py-3.5 shadow-lg border border-emerald-300/30"
            style={{ animation: 'prg-hold-pulse 0.9s ease-in-out infinite' }}
          >
            <span className="text-2xl">📸</span>
            <div>
              <p className="text-white font-bold text-sm leading-tight">Держите позицию!</p>
              <p className="text-emerald-100 text-xs">Не двигайтесь — снимаю...</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 bg-black/70 backdrop-blur-md rounded-2xl px-5 py-4 shadow-lg border border-white/10 w-full max-w-xs">
            {/* Animated arrow */}
            <div
              className="text-4xl leading-none"
              style={{ animation: `${visualTurnLeft ? 'prg-nudge-l' : 'prg-nudge-r'} 1.3s ease-in-out infinite` }}
            >
              {visualTurnLeft ? '⬅️' : '➡️'}
            </div>
            <p className="text-white font-bold text-sm text-center leading-snug">{turnLabel}</p>
            <p className="text-white/55 text-xs text-center">
              {pct >= 70 ? '🔥 Почти! Чуть дальше...' : 'Медленно поворачивайте до профиля'}
            </p>
          </div>
        )}
      </div>

      {/* ── Progress / hold indicator — bottom ── */}
      <div className="absolute bottom-[20%] left-5 right-5 flex flex-col items-center gap-2" style={{ pointerEvents: 'none' }}>
        {isAtTarget && holdProgress > 0 ? (
          /* Countdown ring when holding */
          <svg width="88" height="88" viewBox="0 0 88 88">
            <circle cx="44" cy="44" r="36" fill="rgba(0,0,0,0.55)" />
            <circle cx="44" cy="44" r="36" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="7" />
            <circle
              cx="44" cy="44" r="36" fill="none"
              stroke="#10b981" strokeWidth="7" strokeLinecap="round"
              strokeDasharray={`${holdProgress * holdCirc} ${holdCirc}`}
              transform="rotate(-90 44 44)"
              style={{ filter: 'drop-shadow(0 0 6px #10b981)', transition: 'stroke-dasharray 0.1s linear' }}
            />
            <text x="44" y="50" textAnchor="middle" fill="white" fontSize="18" fontWeight="bold">
              {Math.round(holdProgress * 100)}%
            </text>
          </svg>
        ) : !isAtTarget ? (
          /* Progress bar Прямо → Профиль */
          <div className="w-full bg-black/55 backdrop-blur-sm rounded-2xl px-4 py-3 border border-white/10">
            <div className="flex justify-between text-[11px] font-semibold mb-2">
              <span className="text-white/50">😐 Прямо</span>
              <span className={pct >= 80 ? 'text-emerald-400' : 'text-white/80'}>{pct}%</span>
              <span className="text-white/50">😏 Профиль</span>
            </div>
            <div className="w-full bg-white/15 rounded-full h-2.5 overflow-hidden">
              <div
                className="h-2.5 rounded-full transition-all duration-150"
                style={{
                  width: `${pct}%`,
                  background: pct >= 90
                    ? 'linear-gradient(90deg,#10b981,#34d399)'
                    : 'linear-gradient(90deg,#6366f1,#a855f7)',
                  boxShadow: pct >= 70 ? '0 0 10px rgba(99,102,241,0.7)' : 'none',
                }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
