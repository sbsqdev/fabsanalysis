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
  /** Called when user taps "upload different photo" — cancels scan and returns to capture */
  onRetake?: () => void;
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
  onRetake,
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

  /**
   * Renders the SAM segmentation mask as an aesthetic glowing overlay:
   *   • violet-300 → indigo-400 gradient top-to-bottom
   *   • natural edge glow: blurring a filled shape concentrates light at the boundary
   *   • very subtle interior tint so the face is still clearly visible
   *
   * The returned PNG is meant to be displayed with mix-blend-mode:screen so the
   * dark/transparent interior disappears and the bright edge adds a neon aura.
   */
  function renderMaskToDataUrl(mask: Uint8Array, w: number, h: number): string {
    // ── Step 1: rasterise binary mask into a white opaque shape ──────────────
    const shape = document.createElement('canvas');
    shape.width = w; shape.height = h;
    const sCtx = shape.getContext('2d')!;
    const imgData = sCtx.createImageData(w, h);
    const md = imgData.data;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const p = i * 4;
      md[p] = md[p + 1] = md[p + 2] = md[p + 3] = 255;
    }
    sCtx.putImageData(imgData, 0, 0);

    // ── Step 2: create gradient-coloured version of the mask ─────────────────
    //    violet-300 (#c4b5fd) at top → indigo-400 (#818cf8) at bottom
    const colored = document.createElement('canvas');
    colored.width = w; colored.height = h;
    const cCtx = colored.getContext('2d')!;
    const grad = cCtx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0,    '#e9d5ff'); // violet-200 — brighter top edge
    grad.addColorStop(0.35, '#c4b5fd'); // violet-300
    grad.addColorStop(0.7,  '#a78bfa'); // violet-400
    grad.addColorStop(1,    '#818cf8'); // indigo-400
    cCtx.fillStyle = grad;
    cCtx.fillRect(0, 0, w, h);
    // Clip gradient to mask shape
    cCtx.globalCompositeOperation = 'destination-in';
    cCtx.drawImage(shape, 0, 0);

    // ── Step 3: composite — blurred layers create natural edge glow ──────────
    //    Blurring a filled shape produces a corona that is brightest at the edge.
    //    Two blur passes (wide + tight) give a rich depth to the glow.
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d')!;

    // Scale glow radius to image size so it renders correctly at any display scale
    const glow = Math.max(20, Math.round(w / 22));

    // Wide outer glow
    ctx.filter = `blur(${glow}px)`;
    ctx.globalAlpha = 0.70;
    ctx.drawImage(colored, 0, 0);

    // Tight inner glow (sharper edge highlight)
    ctx.filter = `blur(${Math.round(glow * 0.35)}px)`;
    ctx.globalAlpha = 0.55;
    ctx.drawImage(colored, 0, 0);

    // Near-invisible interior tint — just enough to show face region
    ctx.filter = 'none';
    ctx.globalAlpha = 0.07;
    ctx.drawImage(colored, 0, 0);

    ctx.globalAlpha = 1;
    return out.toDataURL('image/png');
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

  // ── Phase stepper helpers ───────────────────────────────────────────────────
  const phaseToGroup = (p: Phase): string => {
    if (p === 'loading_model') return 'init';
    if (p === 'detecting_front' || p === 'drawing') return 'scan';
    if (p === 'detecting_left' || p === 'detecting_right') return 'profile';
    return 'ai'; // waiting_survey | ai_enhancing | done | error
  };
  const groupOrder = hasProfiles
    ? ['init', 'scan', 'profile', 'ai']
    : ['init', 'scan', 'ai'];
  const currentGroup = phaseToGroup(phase);
  const currentGroupIdx = groupOrder.indexOf(currentGroup);
  const groupMeta: Record<string, { icon: string; label: string }> = {
    init:    { icon: '⚙️', label: 'Загрузка' },
    scan:    { icon: '🔍', label: 'Скан' },
    profile: { icon: '📐', label: 'Профили' },
    ai:      { icon: '✨', label: 'ИИ-анализ' },
  };

  return (
    <div className="flex flex-col items-center justify-start min-h-[90vh] px-4 pt-4 pb-6">

      {/* ── Phase stepper ─────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 mb-5 justify-center w-full">
        {groupOrder.map((gId, gi) => {
          const meta = groupMeta[gId];
          const isDone = currentGroupIdx > gi;
          const isActive = currentGroupIdx === gi;
          return (
            <div key={gId} className="flex items-center">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-300 ${
                isDone
                  ? 'bg-emerald-100 text-emerald-700'
                  : isActive
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                    : 'bg-gray-100 text-gray-400'
              }`}>
                <span>{isDone ? '✓' : meta.icon}</span>
                <span className="hidden sm:inline">{meta.label}</span>
              </div>
              {gi < groupOrder.length - 1 && (
                <div className={`w-4 h-px mx-1 transition-colors duration-300 ${isDone ? 'bg-emerald-300' : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Main scan area ────────────────────────────────────────── */}
      <div
        className="relative w-full max-w-sm rounded-3xl overflow-hidden mb-4"
        style={{
          height: '58vh',
          boxShadow: phase === 'done'
            ? '0 0 0 2px rgba(52,211,153,0.4), 0 8px 40px rgba(0,0,0,0.15)'
            : phase === 'error'
              ? '0 0 0 2px rgba(239,68,68,0.3), 0 8px 40px rgba(0,0,0,0.12)'
              : '0 0 0 1.5px rgba(99,102,241,0.25), 0 8px 40px rgba(0,0,0,0.12)',
        }}
      >
        {/* Face image */}
        <img
          src={canvas.toDataURL()}
          alt={t('scanning.capturedAlt')}
          className="absolute inset-0 w-full h-full object-cover object-center block"
        />

        {/* Subtle vignette while scanning */}
        {phase !== 'done' && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(ellipse at 50% 38%, transparent 28%, rgba(0,0,0,0.22) 100%)' }}
          />
        )}

        {/* Landmark overlay canvas */}
        <canvas
          ref={overlayRef}
          className={`absolute inset-0 w-full h-full ${phase !== 'done' ? 'animate-hue-shift' : ''}`}
          style={{ pointerEvents: 'none' }}
        />

        {/* Glowing scan line */}
        {(phase === 'detecting_front' || phase === 'loading_model' || phase === 'ai_enhancing') && (
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div
              className="absolute left-0 right-0 h-px animate-scan"
              style={{
                background:
                  'linear-gradient(90deg, transparent, rgba(99,102,241,0) 5%, rgba(99,102,241,0.9) 35%, rgba(168,85,247,1) 50%, rgba(99,102,241,0.9) 65%, rgba(99,102,241,0) 95%, transparent)',
                boxShadow: '0 0 14px 5px rgba(99,102,241,0.5), 0 0 1px rgba(255,255,255,0.6)',
              }}
            />
          </div>
        )}

        {/* HUD corner brackets */}
        {(['top-3 left-3 border-t-2 border-l-2', 'top-3 right-3 border-t-2 border-r-2', 'bottom-3 left-3 border-b-2 border-l-2', 'bottom-3 right-3 border-b-2 border-r-2']).map((cls, i) => (
          <div
            key={i}
            className={`absolute w-7 h-7 pointer-events-none transition-colors duration-500 ${cls} ${
              phase === 'done' ? 'border-emerald-400/70' : phase === 'error' ? 'border-red-400/60' : 'border-indigo-400/55'
            }`}
          />
        ))}

        {/* Live status badge */}
        {phase !== 'done' && phase !== 'error' && (
          <div className="absolute top-3.5 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
            <div className="flex items-center gap-1.5 bg-black/55 backdrop-blur-md rounded-full px-3 py-1.5 border border-white/10">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse flex-shrink-0" />
              <span className="text-white/90 text-[11px] font-semibold tracking-wide whitespace-nowrap">
                {phaseLabels[phase]}
              </span>
            </div>
          </div>
        )}

        {/* Done overlay */}
        {phase === 'done' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center"
              style={{
                background: 'rgba(16,185,129,0.18)',
                border: '2px solid rgba(52,211,153,0.75)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                boxShadow: '0 0 30px rgba(16,185,129,0.4)',
              }}
            >
              <svg className="w-10 h-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* ── Profile thumbnails during profile scan ─────────────────── */}
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
                className={`relative w-24 h-28 sm:w-28 sm:h-32 rounded-2xl overflow-hidden border-2 transition-all duration-300 ${
                  isActive
                    ? 'border-indigo-400 shadow-lg shadow-indigo-100/60'
                    : phase === 'done'
                      ? 'border-emerald-300'
                      : 'border-gray-200'
                }`}
              >
                <img src={c.canvas.toDataURL()} alt={c.angle} className="w-full h-full object-cover" />

                {maskUrl && (
                  <img
                    src={maskUrl}
                    alt=""
                    aria-hidden
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                    style={{ mixBlendMode: 'screen' }}
                  />
                )}
                {contourUrl && (
                  <img src={contourUrl} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
                )}

                {isActive && !maskUrl && (
                  <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div
                      className="absolute left-0 right-0 h-px animate-scan"
                      style={{
                        background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.9), transparent)',
                        boxShadow: '0 0 8px rgba(99,102,241,0.5)',
                      }}
                    />
                  </div>
                )}

                {maskUrl && phase !== 'done' && (
                  <div className="absolute top-1 left-1">
                    <span className="bg-indigo-600/80 text-white text-[8px] font-semibold px-1.5 py-0.5 rounded-full leading-tight">
                      {t('scanning.mask')}
                    </span>
                  </div>
                )}

                {contourUrl && phase !== 'done' && (
                  <div className="absolute bottom-1 left-1 right-1 flex justify-center">
                    <span className="bg-black/50 text-white text-[8px] font-medium px-1.5 py-0.5 rounded-full leading-tight">
                      {t('scanning.contour')}
                    </span>
                  </div>
                )}

                {phase === 'done' && (
                  <div className="absolute inset-0 bg-emerald-500/10 flex items-end justify-center pb-1.5">
                    <svg className="w-4 h-4 text-emerald-500 drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Survey modal ──────────────────────────────────────────── */}
      {phase === 'waiting_survey' && !surveyDone && onSurveyChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
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

      {/* ── Progress bar ──────────────────────────────────────────── */}
      <div className="w-full max-w-sm mt-1 mb-2">
        <div className="flex justify-between items-center mb-2">
          <TextShimmer duration={2.2} spread={3} className="text-sm font-semibold text-gray-800">
            {phaseLabels[phase]}
          </TextShimmer>
          <span className="text-xs font-mono text-gray-400 tabular-nums">{progress}%</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
          <div
            className="h-1.5 rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${progress}%`,
              background: phase === 'done'
                ? 'linear-gradient(90deg, #10b981, #34d399)'
                : phase === 'error'
                  ? '#ef4444'
                  : 'linear-gradient(90deg, #6366f1, #a855f7)',
              boxShadow: phase === 'done'
                ? '0 0 8px rgba(16,185,129,0.5)'
                : phase !== 'error'
                  ? '0 0 10px rgba(99,102,241,0.5)'
                  : 'none',
            }}
          />
        </div>
      </div>

      {surveyDone && phase !== 'done' && (
        <div className="mt-3 w-full max-w-sm">
          <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {t('scanning.surveyDone')}
          </div>
        </div>
      )}

      {faceMeshError && (
        <div className="mt-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm max-w-sm w-full">
          {faceMeshError}
        </div>
      )}

      {faceMeshLoading && (
        <p className="text-sm text-gray-400 mt-2">{t('scanning.modelLoading')}</p>
      )}

      {faceMeshDelegate === 'CPU' && (
        <p className="text-xs text-amber-500 mt-2">{t('scanning.cpuFallback')}</p>
      )}

      {/* Retake button — always visible so user can escape if photo is wrong */}
      {onRetake && phase !== 'done' && (
        <button
          onClick={onRetake}
          className="mt-5 flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          Загрузить другое фото
        </button>
      )}
    </div>
  );
}
