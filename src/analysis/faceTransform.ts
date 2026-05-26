import type { NormalizedLandmark } from '../types';
import {
  RIGHT_EYEBROW_UPPER, RIGHT_EYEBROW_LOWER,
  LEFT_EYEBROW_UPPER, LEFT_EYEBROW_LOWER,
  LIPS_OUTER_UPPER, LIPS_OUTER_LOWER,
  RIGHT_EYE, LEFT_EYE,
  RIGHT_IRIS_CENTER, LEFT_IRIS_CENTER,
  NOSE, CHEEKS, CHIN, CHIN_LOWER_CONTOUR, FACE_CONTOUR,
  REFERENCE,
} from './landmarks';

export type TransformPresetId =
  | 'eyebrows_natural_boost'
  | 'lips_soft_volume'
  | 'eyes_bright_open'
  | 'nose_refine'
  | 'cheeks_glow'
  | 'chin_define'
  | 'skin_smooth';

export interface TransformPreset {
  id: TransformPresetId;
  title: string;
  subtitle: string;
}

export const TRANSFORM_PRESETS: TransformPreset[] = [
  { id: 'eyebrows_natural_boost', title: 'Брови: к идеалу', subtitle: 'Коррекция пропорций бровей' },
  { id: 'lips_soft_volume', title: 'Губы: к идеалу', subtitle: 'Коррекция пропорций губ' },
  { id: 'eyes_bright_open', title: 'Глаза: к идеалу', subtitle: 'Коррекция пропорций глаз' },
  { id: 'nose_refine', title: 'Нос: к идеалу', subtitle: 'Коррекция пропорций носа' },
  { id: 'cheeks_glow', title: 'Щёки: к идеалу', subtitle: 'Коррекция пропорций щёк' },
  { id: 'chin_define', title: 'Подбородок: к идеалу', subtitle: 'Коррекция пропорций подбородка' },
  { id: 'skin_smooth', title: 'Кожа: выравнивание', subtitle: 'Мягкое выравнивание тона' },
];

/** Maps feature.name (from features.ts) to the relevant transform preset */
export const FEATURE_TRANSFORM_MAP: Partial<Record<string, TransformPresetId>> = {
  Eyebrows: 'eyebrows_natural_boost',
  Lips: 'lips_soft_volume',
  Eyes: 'eyes_bright_open',
  Nose: 'nose_refine',
  Cheeks: 'cheeks_glow',
  Chin: 'chin_define',
  Skin: 'skin_smooth',
};

/** Describes how one proportion deviates from the ideal range */
export interface ProportionDeviation {
  /** Measurement key (e.g. "eyeOpenRatioRight") */
  key: string;
  /** Russian display label */
  label: string;
  /** User's measured value */
  userValue: number;
  /** Center of ideal range */
  idealCenter: number;
  idealMin: number;
  idealMax: number;
  unit: string;
  /** Direction of deviation */
  direction: 'too_low' | 'too_high' | 'ideal';
  /** How far the value is from the ideal center (absolute) */
  deviationAmount: number;
  status: 'ideal' | 'close' | 'deviation';
}

export interface TransformRequest {
  preset: TransformPresetId;
  imageDataUrl: string;
  maskDataUrl: string;
  intensity?: 'normal' | 'strong';
  profileLeftDataUrl?: string;
  profileRightDataUrl?: string;
  /** Proportion deviations for data-driven prompt generation */
  proportionDeviations?: ProportionDeviation[];
}

export interface TransformResponse {
  imageUrl: string;
  imageDataUrl?: string;
  preset: TransformPresetId;
  model: string;
}

export async function requestFaceTransform(
  payload: TransformRequest,
  signal?: AbortSignal,
): Promise<TransformResponse> {
  const response = await fetch('/api/transform', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    let message = `Ошибка трансформации: HTTP ${response.status}`;
    try {
      const json = (await response.json()) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return (await response.json()) as TransformResponse;
}

// ─── Mask Generation ─────────────────────────────────────────────────────────

export async function buildMaskDataUrl(
  imageDataUrl: string,
  landmarks: NormalizedLandmark[],
  preset: TransformPresetId,
): Promise<string> {
  const image = await loadImage(imageDataUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  const rawMask = document.createElement('canvas');
  rawMask.width = width;
  rawMask.height = height;
  const ctx = rawMask.getContext('2d');
  if (!ctx) throw new Error('Не удалось создать контекст маски');

  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'white';
  ctx.strokeStyle = 'white';

  const faceWidth =
    distancePx(landmarks, REFERENCE.rightCheekbone, REFERENCE.leftCheekbone, width, height) ||
    Math.max(width, height) * 0.45;

  switch (preset) {
    case 'eyebrows_natural_boost': {
      const pad = faceWidth * 0.012;
      drawEyebrowMask(ctx, landmarks, RIGHT_EYEBROW_UPPER, RIGHT_EYEBROW_LOWER, width, height, pad);
      drawEyebrowMask(ctx, landmarks, LEFT_EYEBROW_UPPER, LEFT_EYEBROW_LOWER, width, height, pad);
      const strokeW = Math.max(4, faceWidth * 0.02);
      drawPolylineStroke(ctx, landmarks, RIGHT_EYEBROW_UPPER, width, height, strokeW);
      drawPolylineStroke(ctx, landmarks, LEFT_EYEBROW_UPPER, width, height, strokeW);
      drawPolylineStroke(ctx, landmarks, RIGHT_EYEBROW_LOWER, width, height, strokeW);
      drawPolylineStroke(ctx, landmarks, LEFT_EYEBROW_LOWER, width, height, strokeW);
      break;
    }

    case 'lips_soft_volume': {
      const pad = faceWidth * 0.010;
      drawLipMask(ctx, landmarks, LIPS_OUTER_UPPER, LIPS_OUTER_LOWER, width, height, pad);
      const strokeW = Math.max(4, faceWidth * 0.018);
      const lipStrokeContour = [
        ...LIPS_OUTER_UPPER,
        ...[...LIPS_OUTER_LOWER].slice(1, -1).reverse(),
      ] as readonly number[];
      drawPolylineStroke(ctx, landmarks, lipStrokeContour, width, height, strokeW, true);
      break;
    }

    case 'eyes_bright_open': {
      // Tight periocular mask to avoid repainting large skin areas
      const upperPad = faceWidth * 0.007;
      const lowerPad = faceWidth * 0.005;
      drawEyeMask(
        ctx,
        landmarks,
        RIGHT_EYE.outer,
        RIGHT_EYE.inner,
        RIGHT_EYE.top,
        RIGHT_EYE.bottom,
        width,
        height,
        upperPad,
        lowerPad,
      );
      drawEyeMask(
        ctx,
        landmarks,
        LEFT_EYE.outer,
        LEFT_EYE.inner,
        LEFT_EYE.top,
        LEFT_EYE.bottom,
        width,
        height,
        upperPad,
        lowerPad,
      );
      const eyeStrokeW = Math.max(2, faceWidth * 0.010);
      const rightEyeContour = [RIGHT_EYE.outer, ...RIGHT_EYE.top, RIGHT_EYE.inner, ...[...RIGHT_EYE.bottom].reverse()] as readonly number[];
      const leftEyeContour = [LEFT_EYE.outer, ...LEFT_EYE.top, LEFT_EYE.inner, ...[...LEFT_EYE.bottom].reverse()] as readonly number[];
      drawPolylineStroke(ctx, landmarks, rightEyeContour, width, height, eyeStrokeW, true);
      drawPolylineStroke(ctx, landmarks, leftEyeContour, width, height, eyeStrokeW, true);
      const rightIrisCutout = Math.max(2, distancePx(landmarks, RIGHT_EYE.outer, RIGHT_EYE.inner, width, height) * 0.12);
      const leftIrisCutout = Math.max(2, distancePx(landmarks, LEFT_EYE.outer, LEFT_EYE.inner, width, height) * 0.12);
      cutoutCircleByIndex(ctx, landmarks, RIGHT_IRIS_CENTER, width, height, rightIrisCutout);
      cutoutCircleByIndex(ctx, landmarks, LEFT_IRIS_CENTER, width, height, leftIrisCutout);
      break;
    }

    case 'nose_refine': {
      const noseContour = [NOSE.bridge, NOSE.rightAlar, NOSE.rightNostril, NOSE.bottom, NOSE.leftNostril, NOSE.leftAlar] as const;
      fillPolygon(ctx, pointsFromIndices(landmarks, noseContour, width, height));
      const noseStrokeW = Math.max(4, faceWidth * 0.016);
      drawPolylineStroke(ctx, landmarks, noseContour, width, height, noseStrokeW, true);
      const bridgeStrokeW = Math.max(4, faceWidth * 0.015);
      drawPolylineStroke(ctx, landmarks, [NOSE.bridge, NOSE.tip, NOSE.bottom], width, height, bridgeStrokeW, false);
      const nostrilCutout = Math.max(2, faceWidth * 0.012);
      cutoutCircleByIndex(ctx, landmarks, NOSE.rightNostril, width, height, nostrilCutout);
      cutoutCircleByIndex(ctx, landmarks, NOSE.leftNostril, width, height, nostrilCutout);
      break;
    }

    case 'cheeks_glow': {
      // Elliptical cheeks look more anatomical than simple circles
      drawCheekMask(ctx, landmarks, CHEEKS.rightCenter, CHEEKS.rightOuter, NOSE.rightAlar, width, height, faceWidth);
      drawCheekMask(ctx, landmarks, CHEEKS.leftCenter, CHEEKS.leftOuter, NOSE.leftAlar, width, height, faceWidth);
      const noseCutout = Math.max(3, faceWidth * 0.030);
      cutoutCircleByIndex(ctx, landmarks, NOSE.rightAlar, width, height, noseCutout);
      cutoutCircleByIndex(ctx, landmarks, NOSE.leftAlar, width, height, noseCutout);
      break;
    }

    case 'chin_define': {
      const chinStrokeW = Math.max(4, faceWidth * 0.016);
      drawPolylineStroke(ctx, landmarks, CHIN_LOWER_CONTOUR, width, height, chinStrokeW, false);
      const chin = landmarks[CHIN.tip];
      if (chin) {
        const cx = chin.x * width;
        const cy = chin.y * height - faceWidth * 0.015;
        drawEllipse(ctx, cx, cy, faceWidth * 0.11, faceWidth * 0.070);
        ctx.fill();
      }
      break;
    }

    case 'skin_smooth': {
      fillPolygon(ctx, pointsFromIndices(landmarks, FACE_CONTOUR, width, height));
      withComposite(ctx, 'destination-out', () => {
        const eyePadUp = faceWidth * 0.017;
        const eyePadDown = faceWidth * 0.014;
        const browPad = faceWidth * 0.014;
        const lipPad = faceWidth * 0.013;

        drawEyeMask(
          ctx,
          landmarks,
          RIGHT_EYE.outer,
          RIGHT_EYE.inner,
          RIGHT_EYE.top,
          RIGHT_EYE.bottom,
          width,
          height,
          eyePadUp,
          eyePadDown,
        );
        drawEyeMask(
          ctx,
          landmarks,
          LEFT_EYE.outer,
          LEFT_EYE.inner,
          LEFT_EYE.top,
          LEFT_EYE.bottom,
          width,
          height,
          eyePadUp,
          eyePadDown,
        );
        drawEyebrowMask(ctx, landmarks, RIGHT_EYEBROW_UPPER, RIGHT_EYEBROW_LOWER, width, height, browPad);
        drawEyebrowMask(ctx, landmarks, LEFT_EYEBROW_UPPER, LEFT_EYEBROW_LOWER, width, height, browPad);
        drawLipMask(ctx, landmarks, LIPS_OUTER_UPPER, LIPS_OUTER_LOWER, width, height, lipPad);
        const nostrilCutout = Math.max(2, faceWidth * 0.011);
        cutoutCircleByIndex(ctx, landmarks, NOSE.rightNostril, width, height, nostrilCutout);
        cutoutCircleByIndex(ctx, landmarks, NOSE.leftNostril, width, height, nostrilCutout);
      });
      break;
    }
  }

  // Blur edges for natural inpaint transition
  const isLargeArea = preset === 'skin_smooth' || preset === 'cheeks_glow';
  const blurRadius = isLargeArea
    ? Math.max(5, Math.round(faceWidth * 0.022))
    : Math.max(3, Math.round(faceWidth * 0.014));

  const blurred = document.createElement('canvas');
  blurred.width = width;
  blurred.height = height;
  const bctx = blurred.getContext('2d');
  if (!bctx) throw new Error('Не удалось создать контекст размытой маски');
  bctx.fillStyle = 'black';
  bctx.fillRect(0, 0, width, height);
  bctx.filter = `blur(${blurRadius}px)`;
  bctx.drawImage(rawMask, 0, 0);
  bctx.filter = 'none';

  return blurred.toDataURL('image/png');
}

// ─── Mask helpers ─────────────────────────────────────────────────────────────

/** Eyebrow: filled polygon from upper + lower contour with vertical padding */
function drawEyebrowMask(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  upperIndices: readonly number[],
  lowerIndices: readonly number[],
  width: number,
  height: number,
  pad: number,
) {
  const upper = [...upperIndices]
    .map((idx) => {
      const p = landmarks[idx];
      return p ? { x: p.x * width, y: p.y * height - pad } : null;
    })
    .filter((p): p is { x: number; y: number } => p !== null);
  const lower = [...lowerIndices]
    .reverse()
    .map((idx) => {
      const p = landmarks[idx];
      return p ? { x: p.x * width, y: p.y * height + pad } : null;
    })
    .filter((p): p is { x: number; y: number } => p !== null);
  fillPolygon(ctx, [...upper, ...lower]);
}

/** Lips: dense 21-point outer contour with slight outward padding */
function drawLipMask(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  upperIndices: readonly number[],
  lowerIndices: readonly number[],
  width: number,
  height: number,
  pad: number,
) {
  const upper = [...upperIndices]
    .map((idx) => {
      const p = landmarks[idx];
      return p ? { x: p.x * width, y: p.y * height - pad } : null;
    })
    .filter((p): p is { x: number; y: number } => p !== null);
  const lower = [...lowerIndices]
    .slice(1, -1)
    .reverse()
    .map((idx) => {
      const p = landmarks[idx];
      return p ? { x: p.x * width, y: p.y * height + pad } : null;
    })
    .filter((p): p is { x: number; y: number } => p !== null);
  fillPolygon(ctx, [...upper, ...lower]);
}

/** Eye: padded polygon from outer/inner corners + top/bottom arcs */
function drawEyeMask(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  outerIdx: number,
  innerIdx: number,
  topIndices: readonly number[],
  bottomIndices: readonly number[],
  width: number,
  height: number,
  upperPad: number,
  lowerPad: number,
) {
  const upper = [outerIdx, ...topIndices, innerIdx]
    .map((idx) => {
      const p = landmarks[idx];
      return p ? { x: p.x * width, y: p.y * height - upperPad } : null;
    })
    .filter((p): p is { x: number; y: number } => p !== null);
  const lower = [...bottomIndices]
    .reverse()
    .map((idx) => {
      const p = landmarks[idx];
      return p ? { x: p.x * width, y: p.y * height + lowerPad } : null;
    })
    .filter((p): p is { x: number; y: number } => p !== null);
  fillPolygon(ctx, [...upper, ...lower]);
}

function drawCheekMask(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  centerIdx: number,
  outerIdx: number,
  noseSideIdx: number,
  width: number,
  height: number,
  faceWidth: number,
) {
  const center = landmarks[centerIdx];
  const outer = landmarks[outerIdx];
  const noseSide = landmarks[noseSideIdx];
  if (!center || !outer || !noseSide) return;

  const nx = noseSide.x * width;
  const ny = noseSide.y * height;
  const ox = outer.x * width;
  const oy = outer.y * height;
  const vx = ox - nx;
  const vy = oy - ny;
  const span = Math.hypot(vx, vy);

  const cx = nx + vx * 0.56;
  const cy = center.y * height + faceWidth * 0.015;
  const rx = clamp(span * 0.36, faceWidth * 0.09, faceWidth * 0.14);
  const ry = clamp(rx * 0.78, faceWidth * 0.07, faceWidth * 0.11);
  const angle = Math.atan2(vy, vx) * 0.30;

  drawEllipse(ctx, cx, cy, rx, ry, angle);
  ctx.fill();

  ctx.lineWidth = Math.max(3, faceWidth * 0.012);
  drawEllipse(ctx, cx, cy, rx * 0.86, ry * 0.86, angle);
  ctx.stroke();
}

// ─── Blend ───────────────────────────────────────────────────────────────────

export async function blendTransformedWithOriginal(
  originalDataUrl: string,
  transformedImageUrl: string,
  maskDataUrl: string,
  preset: TransformPresetId,
): Promise<string> {
  const [original, transformed, mask] = await Promise.all([
    loadImage(originalDataUrl),
    loadImage(transformedImageUrl),
    loadImage(maskDataUrl),
  ]);

  const width = original.naturalWidth || original.width;
  const height = original.naturalHeight || original.height;
  if (!width || !height) throw new Error('Некорректный размер исходного изображения');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Не удалось создать контекст для смешивания');

  const maxMixMap: Record<TransformPresetId, number> = {
    eyebrows_natural_boost: 0.85,
    lips_soft_volume:       0.85,
    eyes_bright_open:       0.88,
    nose_refine:            0.85,
    cheeks_glow:            0.80,
    chin_define:            0.85,
    skin_smooth:            0.75,
  };
  const maxMix = maxMixMap[preset];

  ctx.drawImage(original, 0, 0, width, height);
  const originalData = ctx.getImageData(0, 0, width, height);

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(transformed, 0, 0, width, height);
  const transformedData = ctx.getImageData(0, 0, width, height);

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(mask, 0, 0, width, height);
  const maskData = ctx.getImageData(0, 0, width, height);

  // Measure how much the AI actually changed within the mask
  let maskedDiffSum = 0;
  let maskedCount = 0;
  for (let i = 0; i < maskData.data.length; i += 4) {
    const mAlpha = maskData.data[i] / 255;
    if (mAlpha > 0.05) {
      const d =
        Math.abs(transformedData.data[i]     - originalData.data[i])     +
        Math.abs(transformedData.data[i + 1] - originalData.data[i + 1]) +
        Math.abs(transformedData.data[i + 2] - originalData.data[i + 2]);
      maskedDiffSum += d / 3;
      maskedCount++;
    }
  }
  const meanMaskDiff = maskedCount > 0 ? maskedDiffSum / maskedCount : 0;
  const isTooSubtle = meanMaskDiff < 6;

  const out = ctx.createImageData(width, height);
  for (let i = 0; i < out.data.length; i += 4) {
    const maskAlpha = maskData.data[i] / 255;
    const mix = maskAlpha * maxMix;

    let r = Math.round(originalData.data[i]     * (1 - mix) + transformedData.data[i]     * mix);
    let g = Math.round(originalData.data[i + 1] * (1 - mix) + transformedData.data[i + 1] * mix);
    let b = Math.round(originalData.data[i + 2] * (1 - mix) + transformedData.data[i + 2] * mix);

    // Gentle manual fallback only for specific presets if AI was too subtle
    if (isTooSubtle && maskAlpha > 0.15) {
      if (preset === 'eyebrows_natural_boost') {
        const k = Math.min(0.14, maskAlpha * 0.16);
        r = Math.round(r * (1 - k));
        g = Math.round(g * (1 - k));
        b = Math.round(b * (1 - k));
      } else if (preset === 'lips_soft_volume') {
        const k = Math.min(0.12, maskAlpha * 0.14);
        r = Math.round(Math.min(255, r * (1 + k * 0.15)));
        g = Math.round(g * (1 - k * 0.08));
        b = Math.round(b * (1 - k * 0.05));
      } else if (preset === 'cheeks_glow') {
        const k = Math.min(0.10, maskAlpha * 0.12);
        r = Math.round(Math.min(255, r * (1 + k * 0.20)));
        g = Math.round(g * (1 - k * 0.05));
        b = Math.round(b * (1 - k * 0.04));
      } else if (preset === 'eyes_bright_open') {
        const k = Math.min(0.08, maskAlpha * 0.10);
        r = Math.round(Math.min(255, r + 255 * k * 0.16));
        g = Math.round(Math.min(255, g + 255 * k * 0.14));
        b = Math.round(Math.min(255, b + 255 * k * 0.13));
      } else if (preset === 'skin_smooth') {
        const k = Math.min(0.06, maskAlpha * 0.08);
        const mean = (r + g + b) / 3;
        r = Math.round(r * (1 - k) + mean * k);
        g = Math.round(g * (1 - k) + mean * k);
        b = Math.round(b * (1 - k) + mean * k);
      }
      // For nose and chin we still rely only on AI output
    }

    out.data[i]     = Math.max(0, Math.min(255, r));
    out.data[i + 1] = Math.max(0, Math.min(255, g));
    out.data[i + 2] = Math.max(0, Math.min(255, b));
    out.data[i + 3] = 255;
  }

  ctx.putImageData(out, 0, 0);
  return canvas.toDataURL('image/png');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось загрузить изображение для маски'));
    img.src = dataUrl;
  });
}

function drawPolylineStroke(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  indices: readonly number[],
  width: number,
  height: number,
  lineWidth: number,
  close = false,
) {
  const points = indices
    .map((idx) => landmarks[idx])
    .filter((p): p is NormalizedLandmark => Boolean(p));
  if (points.length < 2) return;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  const p0 = points[0];
  ctx.moveTo(p0.x * width, p0.y * height);
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    ctx.lineTo(p.x * width, p.y * height);
  }
  if (close) ctx.closePath();
  ctx.stroke();
}

function fillPolygon(ctx: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>) {
  if (points.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotation = 0,
) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), rotation, 0, Math.PI * 2);
}

function withComposite(
  ctx: CanvasRenderingContext2D,
  mode: GlobalCompositeOperation,
  draw: () => void,
) {
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = mode;
  draw();
  ctx.globalCompositeOperation = prev;
}

function cutoutCircleByIndex(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  idx: number,
  width: number,
  height: number,
  radius: number,
) {
  const p = landmarks[idx];
  if (!p) return;
  withComposite(ctx, 'destination-out', () => {
    ctx.beginPath();
    ctx.arc(p.x * width, p.y * height, Math.max(1, radius), 0, Math.PI * 2);
    ctx.fill();
  });
}

function pointsFromIndices(
  landmarks: NormalizedLandmark[],
  indices: readonly number[],
  width: number,
  height: number,
): Array<{ x: number; y: number }> {
  return indices
    .map((idx) => landmarks[idx])
    .filter(Boolean)
    .map((p) => ({ x: p.x * width, y: p.y * height }));
}

function distancePx(
  landmarks: NormalizedLandmark[],
  a: number,
  b: number,
  width: number,
  height: number,
) {
  const p1 = landmarks[a];
  const p2 = landmarks[b];
  if (!p1 || !p2) return 0;
  const dx = (p1.x - p2.x) * width;
  const dy = (p1.y - p2.y) * height;
  return Math.hypot(dx, dy);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
