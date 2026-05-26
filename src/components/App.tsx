import { useState, useCallback, useEffect } from 'react';
import type { AppScreen, NormalizedLandmark, AnalysisReport, AngleCapture, FeatureAnalysis, UserProfile } from '../types';
import { useAuth } from '../lib/auth';
import { saveAnalysisForUser } from '../lib/analysisStore';
import { getCurrentLang } from '../lib/language';
import ru from '../locales/ru';
import en from '../locales/en';
import { useCamera } from '../hooks/useCamera';
import { useFaceMesh } from '../hooks/useFaceMesh';
import { generateReport } from '../analysis/report';
import type { ProfileData } from '../analysis/report';
import { enhanceWithAI } from '../analysis/llm';
import type { LLMAnalysisResult, LLMStatus } from '../analysis/llm';
import { computeProportions } from '../analysis/proportions';
import {
  FEATURE_TRANSFORM_MAP,
  buildMaskDataUrl,
  requestFaceTransform,
  blendTransformedWithOriginal,
  type TransformPresetId,
} from '../analysis/faceTransform';
import { loadSamModels } from '../analysis/mobileSam';
import CaptureScreen from './CaptureScreen';
import GuidedCaptureScreen from './GuidedCaptureScreen';
import ScanningScreen from './ScanningScreen';
import type { ProfileScanResult } from './ScanningScreen';
import ReportScreen from './ReportScreen';

export default function App() {
  const tApp = (key: string) => {
    const lang = getCurrentLang();
    return (lang === 'en' ? en : ru)[key] ?? key;
  };

  const { user } = useAuth();
  const [screen, setScreen] = useState<AppScreen>('capture');
  const [capturedCanvas, setCapturedCanvas] = useState<HTMLCanvasElement | null>(null);
  const [frontImageDataUrl, setFrontImageDataUrl] = useState<string | null>(null);
  const [profileImageDataUrls, setProfileImageDataUrls] = useState<{ left?: string; right?: string }>({});
  const [profileMaskDataUrls, setProfileMaskDataUrls] = useState<{ left?: string; right?: string }>({});
  const [profileLandmarks, setProfileLandmarks] = useState<{ left?: NormalizedLandmark[] | null; right?: NormalizedLandmark[] | null }>({});
  const [profileLandmarkSource, setProfileLandmarkSource] = useState<{ left?: 'ai' | 'contour' | 'mediapipe'; right?: 'ai' | 'contour' | 'mediapipe' }>({});
  const [profileLandmarkConfidence, setProfileLandmarkConfidence] = useState<{ left?: number; right?: number }>({});
  const [analysisLandmarks, setAnalysisLandmarks] = useState<NormalizedLandmark[] | null>(null);
  const [inputSource, setInputSource] = useState<'photo' | 'camera'>('photo');
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [aiStatus, setAiStatus] = useState<LLMStatus>('idle');
  const [aiResult, setAiResult] = useState<LLMAnalysisResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [profileCaptures, setProfileCaptures] = useState<AngleCapture[]>([]);
  const [precomputedTransforms, setPrecomputedTransforms] = useState<Partial<Record<string, string>>>({});
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  const camera = useCamera();
  const faceMesh = useFaceMesh();

  // Warm up FaceMesh early so users don't wait on the scanning screen.
  useEffect(() => {
    if (faceMesh.isReady || faceMesh.isLoading) return;
    void faceMesh.initialize();
  }, [faceMesh.isReady, faceMesh.isLoading, faceMesh.initialize]);

  const handleImageReady = useCallback(
    (canvas: HTMLCanvasElement, _imageData: ImageData, source: 'photo' | 'camera') => {
      setCapturedCanvas(canvas);
      setFrontImageDataUrl(canvas.toDataURL('image/png'));
      setProfileImageDataUrls({});
      setProfileMaskDataUrls({});
      setProfileLandmarks({});
      setProfileLandmarkSource({});
      setProfileLandmarkConfidence({});
      setAnalysisLandmarks(null);
      setInputSource(source);
      setScanError(null);
      setProfileCaptures([]);
      setAiStatus('idle');
      setAiResult(null);
      setAiError(null);
      setPrecomputedTransforms({});
      setUserProfile(null);
      setScreen('scanning');
    },
    [],
  );

  const handleStartGuidedCapture = useCallback(() => {
    // Switch to screen immediately so user sees feedback right away.
    // The useCamera setVideoRef callback will attach the stream to the video element
    // once getUserMedia resolves (state.stream triggers a ref callback re-run).
    setScreen('guided_capture');
    void loadSamModels().catch(() => false);
    void camera.startCamera();
  }, [camera]);

  const handleMultiPhotoComplete = useCallback(
    (captures: AngleCapture[]) => {
      const front = captures.find((c) => c.angle === 'front');
      if (!front) return;
      const left = captures.find((c) => c.angle === 'left');
      const right = captures.find((c) => c.angle === 'right');

      setCapturedCanvas(front.canvas);
      setFrontImageDataUrl(front.canvas.toDataURL('image/png'));
      setProfileImageDataUrls({
        left: left?.canvas.toDataURL('image/png'),
        right: right?.canvas.toDataURL('image/png'),
      });
      setProfileMaskDataUrls({});
      setProfileLandmarks({});
      setProfileLandmarkSource({});
      setProfileLandmarkConfidence({});
      setAnalysisLandmarks(null);
      setInputSource('photo');
      setScanError(null);
      setProfileCaptures(captures.filter((c) => c.angle !== 'front'));
      setAiStatus('idle');
      setAiResult(null);
      setAiError(null);
      setPrecomputedTransforms({});
      setUserProfile(null);
      setScreen('scanning');
    },
    [],
  );

  const handleGuidedCaptureComplete = useCallback(
    (captures: AngleCapture[]) => {
      camera.stopCamera();
      const front = captures.find((c) => c.angle === 'front');
      if (!front) return;
      const left = captures.find((c) => c.angle === 'left');
      const right = captures.find((c) => c.angle === 'right');

      setCapturedCanvas(front.canvas);
      setFrontImageDataUrl(front.canvas.toDataURL('image/png'));
      setProfileImageDataUrls({
        left: left?.canvas.toDataURL('image/png'),
        right: right?.canvas.toDataURL('image/png'),
      });
      setProfileMaskDataUrls({});
      setProfileLandmarks({});
      setProfileLandmarkSource({});
      setProfileLandmarkConfidence({});
      setAnalysisLandmarks(null);
      setInputSource('camera');
      setScanError(null);
      setProfileCaptures(captures.filter((c) => c.angle !== 'front'));
      setAiStatus('idle');
      setAiResult(null);
      setAiError(null);
      setPrecomputedTransforms({});
      setUserProfile(null);
      setScreen('scanning');
    },
    [camera],
  );

  const handleGuidedCaptureCancel = useCallback(() => {
    camera.stopCamera();
    setProfileCaptures([]);
    setScreen('capture');
  }, [camera]);

  const handleScanComplete = useCallback(
    async (
      landmarks: NormalizedLandmark[],
      imageData: ImageData,
      confidence: number,
      bbox: { x: number; y: number; width: number; height: number },
      startedAt: number,
      profileLeft?: ProfileScanResult,
      profileRight?: ProfileScanResult,
    ) => {
      const pl: ProfileData | undefined = profileLeft
        ? { imageData: profileLeft.imageData, landmarks: profileLeft.landmarks, width: profileLeft.width, height: profileLeft.height }
        : undefined;
      const pr: ProfileData | undefined = profileRight
        ? { imageData: profileRight.imageData, landmarks: profileRight.landmarks, width: profileRight.width, height: profileRight.height }
        : undefined;

      // Store profile landmarks for angle visualization in Nose card
      setProfileLandmarks({
        left: profileLeft?.landmarks ?? null,
        right: profileRight?.landmarks ?? null,
      });
      setProfileLandmarkSource({
        left: profileLeft?.landmarkSource,
        right: profileRight?.landmarkSource,
      });
      setProfileLandmarkConfidence({
        left: profileLeft?.contourConfidence,
        right: profileRight?.contourConfidence,
      });
      setProfileMaskDataUrls({
        left: profileLeft?.maskDataUrl,
        right: profileRight?.maskDataUrl,
      });

      const buildReport = (opts?: { disableProfiles?: boolean; disableSkin?: boolean }) =>
        generateReport({
          landmarks,
          imageData: opts?.disableSkin ? null : imageData,
          imageWidth: capturedCanvas?.width ?? 640,
          imageHeight: capturedCanvas?.height ?? 480,
          inputType: inputSource,
          faceConfidence: confidence,
          bbox,
          startTime: startedAt,
          profileLeft: opts?.disableProfiles ? undefined : pl,
          profileRight: opts?.disableProfiles ? undefined : pr,
        });

      let result: AnalysisReport | null = null;
      try {
        try {
          result = buildReport();
        } catch (fullReportError) {
          console.warn('[Report] full report failed, retrying in frontal-only mode:', fullReportError);
          try {
            result = buildReport({ disableProfiles: true });
          } catch (frontOnlyError) {
            console.warn('[Report] frontal-only report failed, retrying without skin pixels:', frontOnlyError);
            result = buildReport({ disableProfiles: true, disableSkin: true });
          }
        }

        setAiStatus('streaming');
        setAiError(null);
        setAiResult(null);
        setPrecomputedTransforms({});

        const featureInput = result.features.map((f) => {
          let proportions: Array<{
            key: string;
            label: string;
            userValue: number;
            idealMin: number;
            idealMax: number;
            status: 'ideal' | 'close' | 'deviation';
            unit: string;
          }> = [];

          try {
            const proportionResult = computeProportions(
              f.name,
              f.measurements,
              userProfile?.gender ?? null,
              userProfile?.population ?? 'default',
            );
            proportions = (proportionResult?.items ?? []).map((item) => ({
              key: item.key,
              label: item.label,
              userValue: item.userValue,
              idealMin: item.idealMin,
              idealMax: item.idealMax,
              status: item.status,
              unit: item.unit,
            }));
          } catch (error) {
            console.warn(`[AI] computeProportions failed for ${f.name}; continuing without proportions.`, error);
          }

          return {
            name: f.name,
            status: f.status,
            observations: f.observations,
            measurements: f.measurements,
            proportions,
            confidence: f.confidence,
          };
        });

        const aiEnhancementPromise = new Promise<{
          status: LLMStatus;
          result: LLMAnalysisResult | null;
          error: string | null;
        }>((resolve) => {
          let settled = false;
          let timer: ReturnType<typeof setTimeout> | null = null;
          let aiAbortController: AbortController | null = null;
          const settle = (value: { status: LLMStatus; result: LLMAnalysisResult | null; error: string | null }) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            if (value.status !== 'done') aiAbortController?.abort();
            resolve(value);
          };

          aiAbortController = enhanceWithAI(
            featureInput,
            () => {
              // Progress is shown in scanning phase label; no extra UI required.
            },
            (ai) => settle({ status: 'done', result: ai, error: null }),
            (err) => {
              if (err === 'unavailable') {
                settle({ status: 'unavailable', result: null, error: null });
              } else {
                settle({ status: 'error', result: null, error: err });
              }
            },
            userProfile?.population,
          );

          // Safety timeout — must exceed the server-side OpenAI timeout (30s) + network.
          // Testing shows the handler takes ~21s for simple data; real data can reach 30s.
          timer = setTimeout(() => {
            aiAbortController?.abort();
            settle({
              status: 'error',
              result: null,
              error: tApp('app.aiTimeout'),
            });
          }, 40000);
        });

        const precomputedTransformsPromise = withTimeout(
          precomputeFeatureVisualizations({
            features: result.features,
            frontImageDataUrl,
            landmarks,
            profileImageDataUrls,
          }),
          45000,
          tApp('app.vizTimeout'),
        );

        // Keep scanning screen until the full package is ready:
        // report + AI recommendations + precomputed visual transforms.
        const [aiEnhancementResult, generatedTransformsResult] = await Promise.allSettled([
          aiEnhancementPromise,
          precomputedTransformsPromise,
        ]);

        const aiEnhancement =
          aiEnhancementResult.status === 'fulfilled'
            ? aiEnhancementResult.value
            : {
                status: 'error' as const,
                result: null,
                error: tApp('app.aiRecsTimeout'),
              };
        if (aiEnhancementResult.status === 'rejected') {
          console.warn('[AI] enhancement failed:', aiEnhancementResult.reason);
        }

        const generatedTransforms =
          generatedTransformsResult.status === 'fulfilled' ? generatedTransformsResult.value : {};
        if (generatedTransformsResult.status === 'rejected') {
          console.warn('[AI-visualization] precompute failed:', generatedTransformsResult.reason);
        }

        setAiStatus(aiEnhancement.status);
        setAiResult(aiEnhancement.result);
        setAiError(aiEnhancement.error);
        setPrecomputedTransforms(generatedTransforms);

        setAnalysisLandmarks(landmarks);
        setReport(result);
        setScreen('report');
        void saveAnalysis(result, frontImageDataUrl);
      } catch (error) {
        console.error('[ScanComplete] pipeline failed, falling back to base report:', error);
        setAiStatus('error');
        setAiResult(null);
        setAiError(tApp('app.aiUnavailable'));
        setPrecomputedTransforms({});

        if (!result) {
          try {
            try {
              result = buildReport({ disableProfiles: true });
            } catch (frontOnlyError) {
              console.warn('[ScanComplete] frontal-only fallback failed, trying without skin pixels:', frontOnlyError);
              result = buildReport({ disableProfiles: true, disableSkin: true });
            }
          } catch (reportError) {
            console.error('[ScanComplete] fallback report failed:', reportError);
          }
        }

        if (result) {
          setAnalysisLandmarks(landmarks);
          setReport(result);
          setScreen('report');
          void saveAnalysis(result, frontImageDataUrl);
          return;
        }

        throw error;
      }
    },
    [capturedCanvas, frontImageDataUrl, inputSource, profileImageDataUrls, userProfile],
  );

  const handleScanFailed = useCallback((error: string) => {
    setScanError(error);
    setProfileMaskDataUrls({});
    setProfileLandmarks({});
    setProfileLandmarkSource({});
    setProfileLandmarkConfidence({});
    setScreen('capture');
  }, []);

  /** Fire-and-forget: save completed analysis via Supabase client. Silently ignored if not authenticated. */
  const saveAnalysis = useCallback(async (
    completedReport: AnalysisReport,
    thumbnailUrl: string | null,
  ) => {
    if (!user) {
      console.info('[Save] Skipped — no authenticated user');
      return;
    }
    const t0 = performance.now();
    try {
      console.info(`[Save] Saving analysis for user=${user.id.slice(0, 8)}…`);
      await saveAnalysisForUser({
        userId: user.id,
        report: completedReport,
        thumbnailUrl,
      });
      const ms = Math.round(performance.now() - t0);
      console.info(`[Save] OK (${ms}ms)`);
    } catch (err) {
      const ms = Math.round(performance.now() - t0);
      console.error(`[Save] Exception (${ms}ms):`, err);
    }
  }, [user]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Error banner */}
      {scanError && screen === 'capture' && (
        <div className="max-w-3xl mx-auto px-4 mt-4">
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex justify-between items-center">
            <span>{scanError}</span>
            <button onClick={() => setScanError(null)} className="text-red-400 hover:text-red-600">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Screens */}
      {screen === 'capture' && (
        <CaptureScreen
          onImageReady={handleImageReady}
          onMultiPhotoReady={handleMultiPhotoComplete}
          cameraError={camera.error}
          onStartGuidedCapture={handleStartGuidedCapture}
        />
      )}

      {screen === 'guided_capture' && (
        <GuidedCaptureScreen
          cameraVideoRef={camera.videoRef}
          captureFrame={camera.captureFrame}
          onAllCaptured={handleGuidedCaptureComplete}
          onCancel={handleGuidedCaptureCancel}
          cameraLoading={!camera.isActive && !camera.error}
        />
      )}

      {screen === 'scanning' && capturedCanvas && (
        <ScanningScreen
          canvas={capturedCanvas}
          profileCaptures={profileCaptures.length > 0 ? profileCaptures : undefined}
          onScanComplete={handleScanComplete}
          onScanFailed={handleScanFailed}
          onSurveyChange={setUserProfile}
          faceMeshDetect={faceMesh.detect}
          faceMeshReady={faceMesh.isReady}
          faceMeshInitialize={faceMesh.initialize}
          faceMeshLoading={faceMesh.isLoading}
          faceMeshError={faceMesh.error}
          faceMeshDelegate={faceMesh.usedDelegate}
        />
      )}

      {screen === 'report' && report && (
        <ReportScreen
          report={report}
          frontImageDataUrl={frontImageDataUrl}
          profileImageDataUrls={profileImageDataUrls}
          profileMaskDataUrls={profileMaskDataUrls}
          profileLandmarks={profileLandmarks}
          profileLandmarkSource={profileLandmarkSource}
          profileLandmarkConfidence={profileLandmarkConfidence}
          landmarks={analysisLandmarks}
          precomputedTransforms={precomputedTransforms}
          aiStatus={aiStatus}
          aiResult={aiResult}
          aiError={aiError}
          userProfile={userProfile}
          onSurveyComplete={setUserProfile}
        />
      )}
    </div>
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function precomputeFeatureVisualizations(params: {
  features: FeatureAnalysis[];
  frontImageDataUrl: string | null;
  landmarks: NormalizedLandmark[];
  profileImageDataUrls: { left?: string; right?: string };
}): Promise<Partial<Record<string, string>>> {
  const { features, frontImageDataUrl, landmarks, profileImageDataUrls } = params;
  if (!frontImageDataUrl || !landmarks.length) return {};

  const allTargets: Array<{ name: FeatureAnalysis['name']; preset: TransformPresetId }> = [];
  for (const feature of features) {
    const preset = FEATURE_TRANSFORM_MAP[feature.name] as TransformPresetId | undefined;
    if (!preset) continue;
    allTargets.push({ name: feature.name, preset });
  }

  // Limit parallel FAL.ai requests: sending 7 at once triggers rate-limiting / queueing
  // (each queued job takes ~60s). Prioritise "attention" features; fall back to first 3.
  const attentionTargets = allTargets.filter(({ name }) => {
    const feature = features.find((f) => f.name === name);
    return feature?.status === 'attention';
  });
  const targets = attentionTargets.length > 0 ? attentionTargets : allTargets.slice(0, 3);

  const out: Partial<Record<string, string>> = {};

  // Run filtered transforms in parallel; each request has abort timeout to prevent hangs.
  const TRANSFORM_TIMEOUT_MS = 40_000;
  const MASK_TIMEOUT_MS = 3_500;
  const BLEND_TIMEOUT_MS = 5_000;
  await Promise.all(
    targets.map(async ({ name, preset }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TRANSFORM_TIMEOUT_MS);
      try {
        const maskDataUrl = await withTimeout(
          buildMaskDataUrl(frontImageDataUrl, landmarks, preset),
          MASK_TIMEOUT_MS,
          `mask timeout on ${name}`,
        );
        const transformed = await requestFaceTransform(
          {
            preset,
            imageDataUrl: frontImageDataUrl,
            maskDataUrl,
            intensity: 'normal',
            profileLeftDataUrl: profileImageDataUrls.left,
            profileRightDataUrl: profileImageDataUrls.right,
          },
          controller.signal,
        );

        const transformedSource = transformed.imageDataUrl ?? transformed.imageUrl;
        let result: string;
        try {
          result = await withTimeout(
            blendTransformedWithOriginal(
              frontImageDataUrl,
              transformedSource,
              maskDataUrl,
              preset,
            ),
            BLEND_TIMEOUT_MS,
            `blend timeout on ${name}`,
          );
        } catch {
          result = transformedSource;
        }
        out[name] = result;
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.warn(`[AI-visualization] ${name} skipped:`, error);
        }
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  return out;
}
