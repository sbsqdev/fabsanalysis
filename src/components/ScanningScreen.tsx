import { useEffect, useRef, useState } from 'react';
import type { NormalizedLandmark, AngleCapture, UserProfile } from '../types';
import { FACE_CONTOUR, LEFT_EYE, RIGHT_EYE, LEFT_EYEBROW, RIGHT_EYEBROW, NOSE, LIPS, LIPS_OUTER_UPPER, LIPS_OUTER_LOWER, JAW } from '../analysis/landmarks';
import { detectProfileContourFromMask, extractProfileContourFromMask } from '../analysis/profileContourDetector';
import { segmentFaceProfile, loadSamModels } from '../analysis/mobileSam';
import SurveyPanel from './SurveyPanel';
import { TextShimmer } from './ui/text-shimmer';
import { useT } from '../lib/language';

type ProfileLandmarkSource = 'ai' | 'contour' | 'mediapipe';

export interface ProfileScanResult {
  imageData: ImageData;
  landmarks: NormalizedLandmark[] | null;
  width: number;
  height: number;
  /** Optional SAM mask visualization (data URL) */
  maskDataUrl?: string;
  /** Which detector produced the landmarks */
  landmarkSource?: ProfileLandmarkSource;
  /** Confidence of the contour detector (if used) */
  contourConfidence?: number;
}

interface Props {
  canvas: HTMLCanvasElement;
  profileCaptures?: AngleCapture[];
  onScanComplete: (
    landmarks: NormalizedLandmark[],
    imageData: ImageData,
    confidence: number,
    bbox: { x: number; y: number; width: number; height: number },
    startedAt: number,
    profileLeft?: ProfileScanResult,
    profileRight?: ProfileScanResult,
  ) => Promise<void> | void;
  onScanFailed: (error: string) => void;
  onSurveyChange?: (profile: UserProfile) => void;
  faceMeshDetect: (source: HTMLCanvasElement) => {
    landmarks: NormalizedLandmark[];
    confidence: number;
    bbox: { x: number; y: number; width: number; height: number };
  } | null;
  faceMeshReady: boolean;
  faceMeshInitialize: () => Promise<void>;
  faceMeshLoading: boolean;
  faceMeshError: string | null;
  faceMeshDelegate: 'GPU' | 'CPU' | null;
}

type Phase =
  | 'loading_model'
  | 'detecting_front'
  | 'drawing'
  | 'detecting_left'
  | 'detecting_right'
  | 'waiting_survey'
  | 'ai_enhancing'
  | 'done'
  | 'error';

const SAM_ACCEPT_THRESHOLD = 0.25;
type ContourTuple = [number, number, number];
type SparseEntry = [number, number, number, number?];

interface ProfileLandmarkApiRequestProfile {
  side: 'left' | 'right';
  imageWidth: number;
  imageHeight: number;
  contourCount: number;
  contourPointsTopToBottom: ContourTuple[];
}

interface LandmarkCoord {
  index: number;
  x: number;
  y: number;
  confidence: number;
}

interface ProfileLandmarkApiResultProfile {
  side: 'left' | 'right';
  source: 'ai' | 'detector';
  overallConfidence: number;
  landmarks: {
    g: LandmarkCoord;
    n: LandmarkCoord;
    prn: LandmarkCoord;
    cm: LandmarkCoord;
    sn: LandmarkCoord;
    ls: LandmarkCoord;
    pg: LandmarkCoord;
  } | null;
  landmarkEntries: SparseEntry[];
  reason?: string;
}

function sparseEntriesToLandmarks(entries: SparseEntry[]): NormalizedLandmark[] {
  const lm = new Array<NormalizedLandmark>(478);
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const idx = Number(entry[0]);
    const x = Number(entry[1]);
    const y = Number(entry[2]);
    const z = Number(entry[3] ?? 0);
    if (!Number.isInteger(idx) || idx < 0 || idx >= 478) continue;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    lm[idx] = { x, y, z };
  }
  return lm;
}

async function requestProfileLandmarksAi(
  profiles: ProfileLandmarkApiRequestProfile[],
): Promise<ProfileLandmarkApiResultProfile[]> {
  const res = await fetch('/api/profile-landmarks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profiles }),
  });
  if (!res.ok) {
    throw new Error(`/api/profile-landmarks failed: HTTP ${res.status}`);
  }
  const data = await res.json() as { profiles?: ProfileLandmarkApiResultProfile[] };
  return Array.isArray(data?.profiles) ? data.profiles : [];
}

export default function ScanningScreen({
  canvas,
  profileCaptures,
  onScanComplete,
  onScanFailed,
  onSurveyChange,
  faceMeshDetect,
  faceMeshReady,
  faceMeshInitialize,
  faceMeshLoading,
  faceMeshError,
  faceMeshDelegate,
}: Props) {
  const t = useT();
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>('loading_model');
  const [progress, setProgress] = useState(0);
  const [surveyDone, setSurveyDone] = useState(false);
  const surveyDoneRef = useRef(false);
  const surveyResolveRef = useRef<(() => void) | null>(null);
  const hasRun = useRef(false);
  // Contour overlay images stored as data URLs so they survive React re-renders
  const [leftContourUrl, setLeftContourUrl] = useState<string | null>(null);
  const [rightContourUrl, setRightContourUrl] = useState<string | null>(null);
  // MobileSAM mask overlays for profile thumbnails during loading
  const [leftMaskUrl, setLeftMaskUrl] = useState<string | null>(null);
  const [rightMaskUrl, setRightMaskUrl] = useState<string | null>(null);

  const hasProfiles = profileCaptures && profileCaptures.length > 0;

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    async function run() {
      try {
        const startedAt = Date.now();

        // Phase 1: load models
        setPhase('loading_model');
        setProgress(10);

        // Start SAM model prefetch for profile analysis (parallel with MediaPipe init)
        const samPrefetch = hasProfiles
          ? loadSamModels()
              .then((ok) => ({ ok, error: null as string | null }))
              .catch((error: unknown) => ({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              }))
          : Promise.resolve({ ok: true, error: null as string | null });
        // Animate progress in loading phase to avoid "stuck at 10%" perception.
        const ticker = setInterval(() => setProgress((p) => Math.min(p + 2, hasProfiles ? 46 : 38)), 500);
        try {
          if (!faceMeshReady) {
            await faceMeshInitialize();
          }
          if (hasProfiles) {
            const samInit = await samPrefetch;
            if (!samInit.ok) {
              console.error('[SAM] Initialization failed before scan:', samInit.error ?? 'unknown');
              throw new Error(t('scanning.samLoadError'));
            }
          }
        } finally {
          clearInterval(ticker);
        }

        setProgress(40);
        setPhase('detecting_front');

        await new Promise((r) => setTimeout(r, 300));

        // Phase 2: detect front face
        const result = faceMeshDetect(canvas);

        if (!result) {
          setPhase('error');
          onScanFailed(
            faceMeshError ??
              t('scanning.faceNotFound'),
          );
          return;
        }

        setProgress(hasProfiles ? 40 : 70);
        setPhase('drawing');

        // Draw landmarks overlay on front image
        drawLandmarks(result.landmarks, canvas.width, canvas.height);

        await new Promise((r) => setTimeout(r, 500));

        // Phase 3: process profiles if available
        let profileLeft: ProfileScanResult | undefined;
        let profileRight: ProfileScanResult | undefined;

        if (hasProfiles) {
          const leftCapture = profileCaptures!.find((c) => c.angle === 'left');
          const rightCapture = profileCaptures!.find((c) => c.angle === 'right');
          type PreparedProfile = {
            side: 'left' | 'right';
            capture: AngleCapture;
            imageData: ImageData;
            maskDataUrl?: string;
            samMask?: { mask: Uint8Array; width: number; height: number };
            contourTuples: ContourTuple[];
          };

          const prepared: Partial<Record<'left' | 'right', PreparedProfile>> = {};

          if (leftCapture) {
            setPhase('detecting_left');
            setProgress(55);
            await new Promise((r) => setTimeout(r, 300));

            const leftCtx = leftCapture.canvas.getContext('2d');
            const leftImageData = leftCtx?.getImageData(0, 0, leftCapture.canvas.width, leftCapture.canvas.height) ?? leftCapture.imageData;

            const samMask = await segmentFaceProfile(leftCapture.canvas, 'left');
            let leftMaskDataUrl: string | undefined;
            let contourTuples: ContourTuple[] = [];
            if (samMask) {
              leftMaskDataUrl = renderMaskToDataUrl(samMask.mask, samMask.width, samMask.height);
              setLeftMaskUrl(leftMaskDataUrl);
              const contourPoints = extractProfileContourFromMask(samMask.mask, samMask.width, samMask.height, 'left');
              contourTuples = contourPoints.map((pt, i) => [i, Math.round(pt.x), Math.round(pt.y)] as ContourTuple);
            } else {
              console.warn('[Profile] Left: SAM segmentation failed (models unavailable or inference error)');
              setLeftMaskUrl(null);
              setLeftContourUrl(null);
            }

            prepared.left = {
              side: 'left',
              capture: leftCapture,
              imageData: leftImageData,
              maskDataUrl: leftMaskDataUrl,
              samMask: samMask ?? undefined,
              contourTuples,
            };
          }

          if (rightCapture) {
            setPhase('detecting_right');
            setProgress(75);
            await new Promise((r) => setTimeout(r, 300));

            const rightCtx = rightCapture.canvas.getContext('2d');
            const rightImageData = rightCtx?.getImageData(0, 0, rightCapture.canvas.width, rightCapture.canvas.height) ?? rightCapture.imageData;

            const samMask = await segmentFaceProfile(rightCapture.canvas, 'right');
            let rightMaskDataUrl: string | undefined;
            let contourTuples: ContourTuple[] = [];
            if (samMask) {
              rightMaskDataUrl = renderMaskToDataUrl(samMask.mask, samMask.width, samMask.height);
              setRightMaskUrl(rightMaskDataUrl);
              const contourPoints = extractProfileContourFromMask(samMask.mask, samMask.width, samMask.height, 'right');
              contourTuples = contourPoints.map((pt, i) => [i, Math.round(pt.x), Math.round(pt.y)] as ContourTuple);
            } else {
              console.warn('[Profile] Right: SAM segmentation failed (models unavailable or inference error)');
              setRightMaskUrl(null);
              setRightContourUrl(null);
            }

            prepared.right = {
              side: 'right',
              capture: rightCapture,
              imageData: rightImageData,
              maskDataUrl: rightMaskDataUrl,
              samMask: samMask ?? undefined,
              contourTuples,
            };
          }

          const aiPayload: ProfileLandmarkApiRequestProfile[] = [];
          if (prepared.left && prepared.left.contourTuples.length >= 30) {
            aiPayload.push({
              side: 'left',
              imageWidth: prepared.left.capture.canvas.width,
              imageHeight: prepared.left.capture.canvas.height,
              contourCount: prepared.left.contourTuples.length,
              contourPointsTopToBottom: prepared.left.contourTuples,
            });
          }
          if (prepared.right && prepared.right.contourTuples.length >= 30) {
            aiPayload.push({
              side: 'right',
              imageWidth: prepared.right.capture.canvas.width,
              imageHeight: prepared.right.capture.canvas.height,
              contourCount: prepared.right.contourTuples.length,
              contourPointsTopToBottom: prepared.right.contourTuples,
            });
          }

          const aiBySide = new Map<'left' | 'right', ProfileLandmarkApiResultProfile>();
          if (aiPayload.length > 0) {
            try {
              const aiProfiles = await requestProfileLandmarksAi(aiPayload);
              for (const p of aiProfiles) {
                if (p.side === 'left' || p.side === 'right') aiBySide.set(p.side, p);
              }
            } catch (error) {
              console.warn('[Profile] AI landmark service failed, using local detector fallback:', error);
            }
          }

          const finalizeProfile = (side: 'left' | 'right'): ProfileScanResult | undefined => {
            const prep = prepared[side];
            if (!prep) return undefined;

            let landmarks: NormalizedLandmark[] | null = null;
            let landmarkSource: ProfileLandmarkSource | undefined;
            let contourConfidence: number | undefined;

            const aiResult = aiBySide.get(side);
            if (aiResult && Array.isArray(aiResult.landmarkEntries) && aiResult.landmarkEntries.length > 0) {
              landmarks = sparseEntriesToLandmarks(aiResult.landmarkEntries);
              landmarkSource = aiResult.source === 'ai' ? 'ai' : 'contour';
              contourConfidence = Number.isFinite(aiResult.overallConfidence) ? aiResult.overallConfidence : undefined;
              if (aiResult.source === 'ai') {
                console.log(`[Profile] ${side}: AI landmarks accepted (conf=${(contourConfidence ?? 0).toFixed(3)})`);
              } else {
                console.log(`[Profile] ${side}: backend detector fallback used (reason=${aiResult.reason ?? 'n/a'})`);
              }
            }

            if (!landmarks && prep.samMask) {
              const samResult = detectProfileContourFromMask(
                prep.samMask.mask,
                prep.samMask.width,
                prep.samMask.height,
                side,
              );
              if (samResult && samResult.confidence >= SAM_ACCEPT_THRESHOLD) {
                landmarks = samResult.landmarks;
                landmarkSource = 'contour';
                contourConfidence = samResult.confidence;
                const contourUrl = renderContourToDataUrl(
                  samResult,
                  prep.capture.canvas.width,
                  prep.capture.canvas.height,
                );
                if (side === 'left') setLeftContourUrl(contourUrl);
                else setRightContourUrl(contourUrl);
                console.log(`[Profile] ${side}: local detector fallback accepted (conf=${samResult.confidence.toFixed(3)})`);
              } else {
                console.warn(`[Profile] ${side}: local detector fallback failed (conf=${samResult?.confidence.toFixed(3) ?? 'null'})`);
                if (side === 'left') setLeftContourUrl(null);
                else setRightContourUrl(null);
              }
            }

            return {
              imageData: prep.imageData,
              landmarks,
              width: prep.capture.canvas.width,
              height: prep.capture.canvas.height,
              maskDataUrl: prep.maskDataUrl,
              landmarkSource,
              contourConfidence,
            };
          };

          profileLeft = finalizeProfile('left');
          profileRight = finalizeProfile('right');
        }

        setProgress(88);

        // If survey prop is provided, wait for it to be completed before proceeding
        if (onSurveyChange && !surveyDoneRef.current) {
          setPhase('waiting_survey');
          await new Promise<void>((resolve) => {
            surveyResolveRef.current = resolve;
          });
        }

        setPhase('ai_enhancing');

        await new Promise((r) => setTimeout(r, 250));

        // Get image data for skin analysis
        const ctx = canvas.getContext('2d');
        const imageData = ctx?.getImageData(0, 0, canvas.width, canvas.height) ?? null;

        await onScanComplete(
          result.landmarks,
          imageData!,
          result.confidence,
          result.bbox,
          startedAt,
          profileLeft,
          profileRight,
        );

        setProgress(100);
        setPhase('done');
        await new Promise((r) => setTimeout(r, 350));
      } catch (error) {
        console.error('[Scanning] Pipeline failed:', error);
        setPhase('error');
        const reason = error instanceof Error ? error.message : t('scanning.unknownError');
        onScanFailed(t('scanning.aiFailed').replace('{reason}', reason));
      }
    }

    run();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function drawLandmarks(landmarks: NormalizedLandmark[], w: number, h: number) {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.width = w;
    overlay.height = h;
    const ctx = overlay.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);

    // Draw all points (small dots)
    ctx.fillStyle = 'rgba(92, 124, 250, 0.4)';
    for (const lm of landmarks) {
      ctx.beginPath();
      ctx.arc(lm.x * w, lm.y * h, 1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw feature contours
    const drawContour = (indices: readonly number[], color: string, close = false) => {
      if (indices.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(landmarks[indices[0]].x * w, landmarks[indices[0]].y * h);
      for (let i = 1; i < indices.length; i++) {
        ctx.lineTo(landmarks[indices[i]].x * w, landmarks[indices[i]].y * h);
      }
      if (close) ctx.closePath();
      ctx.stroke();
    };

    const dist2 = (a: number, b: number) => {
      const pa = landmarks[a];
      const pb = landmarks[b];
      if (!pa || !pb) return Number.POSITIVE_INFINITY;
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      return dx * dx + dy * dy;
    };

    // Ensure eyelid points are ordered from outer -> inner to avoid self-crossing.
    const orderOuterToInner = (ids: readonly number[], outer: number, inner: number): number[] => {
      if (ids.length === 0) return [];
      const firstToOuter = dist2(ids[0], outer);
      const firstToInner = dist2(ids[0], inner);
      return firstToOuter <= firstToInner ? [...ids] : [...ids].reverse();
    };

    // Face contour
    drawContour(FACE_CONTOUR, 'rgba(92, 124, 250, 0.6)', true);
    // Estimated hairline arc: mesh top often under-covers upper forehead near hair.
    const topArcIds = [109, 67, 10, 338, 297] as const;
    const topArcY = Math.min(...topArcIds.map((idx) => (landmarks[idx]?.y ?? landmarks[10].y))) * h;
    const browMidY = ((landmarks[105]?.y ?? landmarks[10].y) + (landmarks[334]?.y ?? landmarks[10].y)) * 0.5 * h;
    const noseBaseY = (landmarks[2]?.y ?? landmarks[10].y) * h;
    const browToTop = Math.max(0, browMidY - topArcY);
    const middleThird = Math.max(0, noseBaseY - browMidY);
    const inferredLift = Math.max(0, middleThird - browToTop);
    const foreheadLift = Math.max(4, Math.min(34, browToTop * 0.6 + inferredLift * 0.35));
    ctx.save();
    ctx.strokeStyle = 'rgba(92, 124, 250, 0.45)';
    ctx.lineWidth = 1.25;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    topArcIds.forEach((idx, i) => {
      const p = landmarks[idx] ?? landmarks[10];
      const x = p.x * w;
      const y = p.y * h - foreheadLift;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Eyes: draw upper and lower lids separately (prevents polygon self-crossing on some faces).
    const rightTop = orderOuterToInner(RIGHT_EYE.top, RIGHT_EYE.outer, RIGHT_EYE.inner);
    const rightBottom = orderOuterToInner(RIGHT_EYE.bottom, RIGHT_EYE.outer, RIGHT_EYE.inner);
    drawContour([RIGHT_EYE.outer, ...rightTop, RIGHT_EYE.inner], 'rgba(59, 130, 246, 0.84)');
    drawContour([RIGHT_EYE.outer, ...rightBottom, RIGHT_EYE.inner], 'rgba(59, 130, 246, 0.84)');

    const leftTop = orderOuterToInner(LEFT_EYE.top, LEFT_EYE.outer, LEFT_EYE.inner);
    const leftBottom = orderOuterToInner(LEFT_EYE.bottom, LEFT_EYE.outer, LEFT_EYE.inner);
    drawContour([LEFT_EYE.outer, ...leftTop, LEFT_EYE.inner], 'rgba(59, 130, 246, 0.84)');
    drawContour([LEFT_EYE.outer, ...leftBottom, LEFT_EYE.inner], 'rgba(59, 130, 246, 0.84)');

    // Eyebrows
    drawContour(RIGHT_EYEBROW, 'rgba(139, 92, 246, 0.8)');
    drawContour(LEFT_EYEBROW, 'rgba(139, 92, 246, 0.8)');

    // Nose
    drawContour([NOSE.bridge, NOSE.tip], 'rgba(16, 185, 129, 0.8)');
    drawContour([NOSE.rightAlar, NOSE.tip, NOSE.leftAlar], 'rgba(16, 185, 129, 0.8)');

    // Lips — proper 11-point outer contours (avoids Cupid's bow going above corners)
    drawContour(LIPS_OUTER_UPPER, 'rgba(239, 68, 68, 0.7)');
    drawContour(LIPS_OUTER_LOWER, 'rgba(239, 68, 68, 0.7)');

    // Jaw
    drawContour(JAW.contour, 'rgba(245, 158, 11, 0.6)');

    // Draw key points larger
    const keyPoints = [
      NOSE.tip, NOSE.bridge, NOSE.rightAlar, NOSE.leftAlar,
      LIPS.upperCenter, LIPS.lowerCenter, LIPS.rightCorner, LIPS.leftCorner,
      RIGHT_EYE.inner, RIGHT_EYE.outer, LEFT_EYE.inner, LEFT_EYE.outer,
    ];

    ctx.fillStyle = 'rgba(92, 124, 250, 0.9)';
    for (const idx of keyPoints) {
      const lm = landmarks[idx];
      ctx.beginPath();
      ctx.arc(lm.x * w, lm.y * h, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Render contour result to an offscreen canvas and return a stable data URL.
  // Using data URL (not a canvas ref) ensures the overlay survives React re-renders.
  function renderContourToDataUrl(
    result: import('../analysis/profileContourDetector').ProfileContourResult,
    imgW: number,
    imgH: number,
  ): string {
    const offscreen = document.createElement('canvas');
    offscreen.width = imgW;
    offscreen.height = imgH;
    const ctx = offscreen.getContext('2d')!;

    // Silhouette contour line
    const pts = result.contourPoints;
    if (pts.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.strokeStyle = 'rgba(92, 124, 250, 0.7)';
      ctx.lineWidth = Math.max(2, imgW / 150);
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // 7 cephalometric landmark dots + labels
    const LANDMARK_STYLE: Record<string, { color: string; label: string }> = {
      glabella:         { color: '#a78bfa', label: "g'" },
      nasion:           { color: '#60a5fa', label: "n'" },
      pronasale:        { color: '#34d399', label: 'prn' },
      columella:        { color: '#2dd4bf', label: 'cm' },
      subnasale:        { color: '#fbbf24', label: 'sn' },
      labiale_superius: { color: '#fb923c', label: 'ls' },
      pogonion:         { color: '#f87171', label: 'pg' },
    };

    const dotR = Math.max(4, imgW / 60);
    const fontSize = Math.max(11, imgW / 45);

    for (const [name, detail] of Object.entries(result.landmarkDetails)) {
      const style = LANDMARK_STYLE[name];
      if (!style) continue;
      const x = detail.point.x * imgW;
      const y = detail.point.y * imgH;

      // Shadow ring
      ctx.beginPath();
      ctx.arc(x, y, dotR + 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();

      // Colored dot
      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
      ctx.fillStyle = style.color;
      ctx.fill();

      // Label with outline for readability
      ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.fillStyle = '#ffffff';
      const lx = x + dotR + 3;
      const ly = y + fontSize * 0.38;
      ctx.strokeText(style.label, lx, ly);
      ctx.fillText(style.label, lx, ly);
    }

    return offscreen.toDataURL();
  }

  function renderMaskToDataUrl(mask: Uint8Array, w: number, h: number): string {
    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const p = i * 4;
      d[p] = 34;      // R
      d[p + 1] = 197; // G
      d[p + 2] = 94;  // B
      d[p + 3] = 120; // alpha
    }
    ctx.putImageData(img, 0, 0);
    return offscreen.toDataURL('image/png');
  }

  const phaseLabels: Record<Phase, string> = {
    loading_model: t('scanning.phase.loading_model'),
    detecting_front: t('scanning.phase.detecting_front'),
    drawing: t('scanning.phase.drawing'),
    detecting_left: t('scanning.phase.detecting_left'),
    detecting_right: t('scanning.phase.detecting_right'),
    waiting_survey: t('scanning.phase.waiting_survey'),
    ai_enhancing: t('scanning.phase.ai_enhancing'),
    done: t('scanning.phase.done'),
    error: t('scanning.phase.error'),
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] px-4">
      <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">
        {t('scanning.title')}
      </h2>

      {/* Image + Overlay */}
      <div className="relative mb-3 rounded-2xl overflow-hidden shadow-lg border border-gray-200" style={{ height: '50vh' }}>
        <img
          src={canvas.toDataURL()}
          alt={t('scanning.capturedAlt')}
          className="w-full h-full object-cover object-center block"
        />
        <canvas
          ref={overlayRef}
          className={`absolute top-0 left-0 w-full h-full ${phase !== 'done' ? 'animate-hue-shift' : ''}`}
          style={{ pointerEvents: 'none', objectFit: 'cover', objectPosition: 'center' }}
        />

        {/* Scan line animation */}
        {(phase === 'detecting_front' || phase === 'loading_model' || phase === 'ai_enhancing') && (
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute left-0 right-0 h-0.5 bg-brand-400 opacity-60 animate-scan" />
          </div>
        )}
      </div>

      {/* Profile thumbnails during profile scan */}
      {hasProfiles && (phase === 'detecting_left' || phase === 'detecting_right' || phase === 'done') && (
        <div className="flex gap-3 mb-4">
          {profileCaptures!.filter((c) => c.angle !== 'front').map((c) => {
            const isActive =
              (phase === 'detecting_left' && c.angle === 'left') ||
              (phase === 'detecting_right' && c.angle === 'right');
            const contourUrl = c.angle === 'left' ? leftContourUrl : rightContourUrl;
            const maskUrl = c.angle === 'left' ? leftMaskUrl : rightMaskUrl;
            return (
              <div
                key={c.angle}
                className={`relative w-24 h-24 sm:w-28 sm:h-28 rounded-xl overflow-hidden border-2 transition-colors ${
                  isActive
                    ? 'border-brand-400'
                    : phase === 'done'
                      ? 'border-emerald-300'
                      : 'border-gray-200'
                }`}
              >
                <img src={c.canvas.toDataURL()} alt={c.angle} className="w-full h-full object-cover" />

                {/* MobileSAM mask overlay */}
                {maskUrl && (
                  <img
                    src={maskUrl}
                    alt=""
                    aria-hidden
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                  />
                )}

                {/* Contour overlay — stable img so it survives re-renders */}
                {contourUrl && (
                  <img
                    src={contourUrl}
                    alt=""
                    aria-hidden
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                  />
                )}

                {/* Scanning pulse while mask not yet ready */}
                {isActive && !maskUrl && (
                  <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute left-0 right-0 h-0.5 bg-brand-400 opacity-70 animate-scan" />
                  </div>
                )}

                {/* "Mask" badge */}
                {maskUrl && phase !== 'done' && (
                  <div className="absolute top-1 left-1">
                    <span className="bg-emerald-600/85 text-white text-[9px] font-medium px-1.5 py-0.5 rounded-full leading-tight">
                      {t('scanning.mask')}
                    </span>
                  </div>
                )}

                {/* "Contour" badge */}
                {contourUrl && phase !== 'done' && (
                  <div className="absolute bottom-1 left-1 right-1 flex justify-center">
                    <span className="bg-black/50 text-white text-[9px] font-medium px-1.5 py-0.5 rounded-full leading-tight">
                      {t('scanning.contour')}
                    </span>
                  </div>
                )}

                {phase === 'done' && (
                  <div className="absolute inset-0 bg-emerald-500/10 flex items-end justify-center pb-1">
                    <svg className="w-5 h-5 text-emerald-500 drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Survey modal — floats over scanning screen */}
      {phase === 'waiting_survey' && !surveyDone && onSurveyChange && (
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            {/* Panel */}
            <div className="relative w-full max-w-lg mx-3 mb-3 sm:mb-0 bg-white rounded-2xl shadow-2xl overflow-hidden animate-slide-up">
              <div className="px-5 pt-5 pb-1">
                <p className="text-sm text-gray-500 text-center mb-1">{t('scanning.surveyHint')}</p>
              </div>
              <div className="px-5 pb-5">
                <SurveyPanel
                  onComplete={(profile) => {
                    onSurveyChange(profile);
                    surveyDoneRef.current = true;
                    setSurveyDone(true);
                    surveyResolveRef.current?.();
                    surveyResolveRef.current = null;
                  }}
                />
              </div>
            </div>
          </div>
        )}

      {/* Progress */}
      <div className="w-full max-w-lg mt-3 mb-2">
        <div className="flex justify-between text-sm mb-2">
          <TextShimmer duration={2.2} spread={3} className="text-sm font-medium">
            {phaseLabels[phase]}
          </TextShimmer>
          <span className="text-gray-400">{progress}%</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
          <div
            className="h-2 rounded-full transition-all duration-500 ease-out relative overflow-hidden"
            style={{
              width: `${progress}%`,
              background: 'linear-gradient(90deg, #6366f1, #818cf8)',
            }}
          >
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)',
                backgroundSize: '200% 100%',
                animation: 'shimmer-bar 1.8s linear infinite',
              }}
            />
          </div>
        </div>
      </div>
      {surveyDone && phase !== 'done' && (
        <div className="mt-6 w-full max-w-lg">
          <div className="flex items-center gap-2 text-sm text-emerald-600 font-sans">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {t('scanning.surveyDone')}
          </div>
        </div>
      )}

      {faceMeshError && (
        <div className="mt-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm max-w-lg">
          {faceMeshError}
        </div>
      )}

      {faceMeshLoading && (
        <p className="text-sm text-gray-400 mt-2">
          {t('scanning.modelLoading')}
        </p>
      )}

      {faceMeshDelegate === 'CPU' && (
        <p className="text-xs text-amber-500 mt-2">
          {t('scanning.cpuFallback')}
        </p>
      )}
    </div>
  );
}
