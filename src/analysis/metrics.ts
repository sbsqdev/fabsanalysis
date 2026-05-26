/**
 * Low-level metric extraction from face landmarks.
 * All functions operate on normalized landmarks (0-1 coordinate space).
 */

import type { NormalizedLandmark } from '../types';
import * as L from './landmarks';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Lm = NormalizedLandmark[];

function normalizeAspectRatio(imageAspectRatio: number = 1): number {
  return Number.isFinite(imageAspectRatio) && imageAspectRatio > 0 ? imageAspectRatio : 1;
}

function dist(a: NormalizedLandmark, b: NormalizedLandmark, imageAspectRatio: number = 1): number {
  const asp = normalizeAspectRatio(imageAspectRatio);
  const dx = (a.x - b.x) * asp;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function midpoint(a: NormalizedLandmark, b: NormalizedLandmark): NormalizedLandmark {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function rotatePoint(
  p: NormalizedLandmark,
  center: NormalizedLandmark,
  angleRad: number,
  imageAspectRatio: number = 1,
): NormalizedLandmark {
  if (!Number.isFinite(angleRad)) {
    return { x: p.x, y: p.y, z: p.z };
  }

  const asp = normalizeAspectRatio(imageAspectRatio);
  // Rotate by -angleRad to remove head roll from vertical/horizontal measurements.
  const centerX = center.x * asp;
  const dx = p.x * asp - centerX;
  const dy = p.y - center.y;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    // x is returned in aspect-corrected units (same metric scale as y).
    x: centerX + dx * cos + dy * sin,
    y: center.y - dx * sin + dy * cos,
    z: p.z,
  };
}

function headRollRad(lm: Lm, imageAspectRatio: number = 1): number {
  const asp = normalizeAspectRatio(imageAspectRatio);
  const rightCenter = midpoint(lm[L.RIGHT_EYE.outer], lm[L.RIGHT_EYE.inner]);
  const leftCenter = midpoint(lm[L.LEFT_EYE.outer], lm[L.LEFT_EYE.inner]);
  return Math.atan2(leftCenter.y - rightCenter.y, (leftCenter.x - rightCenter.x) * asp);
}

function alignedY(lm: Lm, idx: number, imageAspectRatio: number = 1): number {
  const roll = headRollRad(lm, imageAspectRatio);
  const anchor = midpoint(
    midpoint(lm[L.RIGHT_EYE.outer], lm[L.RIGHT_EYE.inner]),
    midpoint(lm[L.LEFT_EYE.outer], lm[L.LEFT_EYE.inner]),
  );
  return rotatePoint(lm[idx], anchor, roll, imageAspectRatio).y;
}

function alignedX(lm: Lm, idx: number, imageAspectRatio: number = 1): number {
  const roll = headRollRad(lm, imageAspectRatio);
  const anchor = midpoint(
    midpoint(lm[L.RIGHT_EYE.outer], lm[L.RIGHT_EYE.inner]),
    midpoint(lm[L.LEFT_EYE.outer], lm[L.LEFT_EYE.inner]),
  );
  return rotatePoint(lm[idx], anchor, roll, imageAspectRatio).x;
}

function angleAt(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  c: NormalizedLandmark,
  imageAspectRatio: number = 1,
): number {
  const asp = normalizeAspectRatio(imageAspectRatio);
  const abx = (a.x - b.x) * asp;
  const aby = a.y - b.y;
  const cbx = (c.x - b.x) * asp;
  const cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magAB = Math.hypot(abx, aby);
  const magCB = Math.hypot(cbx, cby);
  if (magAB === 0 || magCB === 0) return 0;
  const cosTheta = Math.max(-1, Math.min(1, dot / (magAB * magCB)));
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

function median(arr: readonly number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function estimateFaceTopAlignedY(lm: Lm, imageAspectRatio: number = 1): number {
  const topCandidateIds = [10, 338, 297, 332, 284, 251, 389, 356, 127, 162, 21, 54, 103, 67, 109];
  const topYs = topCandidateIds
    .map((i) => alignedY(lm, i, imageAspectRatio))
    .filter((v): v is number => Number.isFinite(v));
  const meshTop = topYs.length > 0 ? Math.min(...topYs) : alignedY(lm, L.REFERENCE.faceTop, imageAspectRatio);

  const browMid = (alignedY(lm, L.RIGHT_EYEBROW[2], imageAspectRatio) + alignedY(lm, L.LEFT_EYEBROW[2], imageAspectRatio)) / 2;
  const noseBase = alignedY(lm, L.NOSE.bottom, imageAspectRatio);
  const browToTop = browMid - meshTop;
  const middleThird = noseBase - browMid;

  const extension = Number.isFinite(browToTop) && browToTop > 0
    ? Math.max(0.012, Math.min(0.10, browToTop * 0.60))
    : 0.02;
  const fromMesh = meshTop - extension;

  let fromThirds = fromMesh;
  if (Number.isFinite(middleThird) && middleThird > 0) {
    fromThirds = browMid - middleThird;
    const maxLift = 0.14;
    fromThirds = Math.max(meshTop - maxLift, fromThirds);
  }

  return Math.min(fromMesh, fromThirds);
}

/**
 * Profile-only subnasale estimate.
 * Prefer strict [164,167] (as produced by SAM contour mapping), then
 * fall back to legacy candidate set for compatibility.
 */
function profileSubnasale(profileLm: Lm): NormalizedLandmark {
  const strictIndices = [164, 167] as const;
  if (strictIndices.some((idx) => !!profileLm[idx])) {
    return robustMedian(profileLm, strictIndices);
  }
  return robustMedian(profileLm, L.SUBNASALE_CANDIDATES);
}

/**
 * Profile-only labiale superius estimate.
 * Prefer direct point 13; if absent, use a robust 13/0 median.
 */
function profileLabialeSuperius(profileLm: Lm): NormalizedLandmark {
  const direct = profileLm[L.LIPS.upperCenter];
  if (direct) return direct;
  return robustMedian(profileLm, [L.LIPS.upperCenter, L.LIPS.upperOuter]);
}

/**
 * Profile-only pronasale estimate.
 * Prefer direct tip point (1), then fall back to dense set.
 * This avoids bias on SAM contour landmarks where 2/98/327 are columella.
 */
function profilePronasale(profileLm: Lm): NormalizedLandmark {
  const direct = profileLm[L.NOSE.tip];
  if (direct) return direct;
  return robustMedian(profileLm, L.NOSE_TIP_DENSE);
}

/** Profile-only columella estimate. */
function profileColumella(profileLm: Lm): NormalizedLandmark {
  const direct = profileLm[L.NOSE.bottom];
  if (direct) return direct;
  return robustMedian(profileLm, L.COLUMELLA_CANDIDATES);
}

/**
 * Pseudo-point that represents forehead tangent direction at nasion.
 * Uses faceTop→glabella vector translated to nasion.
 */
function profileForeheadTangentAtNasion(profileLm: Lm): NormalizedLandmark {
  const glabella = robustMedian(profileLm, L.GLABELLA_CANDIDATES);
  const nasion = robustMedian(profileLm, L.NASION_CANDIDATES);
  const faceTop = profileLm[L.REFERENCE.faceTop];
  if (!faceTop) return glabella;
  const vx = glabella.x - faceTop.x;
  const vy = glabella.y - faceTop.y;
  const len = Math.hypot(vx, vy);
  if (len < 1e-6) return glabella;
  return {
    x: nasion.x + vx,
    y: nasion.y + vy,
    z: nasion.z,
  };
}

// ─── Robust point estimation helpers ─────────────────────────────────────────

/**
 * Weighted centroid of a set of landmark indices.
 * Returns a stable average point, less sensitive to any single landmark
 * than a single-point lookup.
 * @param weights  Optional per-index weights (uniform if omitted).
 */
export function weightedCentroid(
  lm: Lm,
  indices: readonly number[],
  weights?: readonly number[],
): NormalizedLandmark {
  if (indices.length === 0) return { x: 0, y: 0, z: 0 };
  let sumX = 0, sumY = 0, sumZ = 0, sumW = 0;
  for (let i = 0; i < indices.length; i++) {
    const pt = lm[indices[i]];
    if (!pt) continue;
    const w = weights?.[i] ?? 1;
    sumX += pt.x * w;
    sumY += pt.y * w;
    sumZ += pt.z * w;
    sumW += w;
  }
  if (sumW === 0) return { x: 0, y: 0, z: 0 };
  return { x: sumX / sumW, y: sumY / sumW, z: sumZ / sumW };
}

/**
 * Coordinate-wise median of a set of landmark indices.
 * Robust to outliers — preferable to centroid when one candidate index
 * may be poorly placed by MediaPipe (e.g. on profile views).
 */
export function robustMedian(
  lm: Lm,
  indices: readonly number[],
): NormalizedLandmark {
  if (indices.length === 0) return { x: 0, y: 0, z: 0 };
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (const idx of indices) {
    const pt = lm[idx];
    if (!pt) continue;
    xs.push(pt.x);
    ys.push(pt.y);
    zs.push(pt.z);
  }
  if (xs.length === 0) return { x: 0, y: 0, z: 0 };
  return { x: median(xs), y: median(ys), z: median(zs) };
}

// ─── Eye Metrics ─────────────────────────────────────────────────────────────

/**
 * Eye Aspect Ratio — proxy for eye openness.
 * Uses full Soukupova & Cech (2016) 6-point formula with 3 vertical pairs.
 * ~0.25 = closed/heavy-lidded, ~0.35-0.45 = normal open
 */
export function eyeAspectRatio(
  lm: Lm,
  side: 'right' | 'left',
  imageAspectRatio: number = 1,
): number {
  const e = side === 'right' ? L.RIGHT_EYE : L.LEFT_EYE;
  const vertical1 = dist(lm[e.p2], lm[e.p6], imageAspectRatio);              // top-medial ↔ bottom-medial
  const vertical2 = dist(lm[e.p3], lm[e.p5], imageAspectRatio);              // top-lateral ↔ bottom-lateral
  const vertical3 = dist(lm[e.p_top_centre], lm[e.p_bot_centre], imageAspectRatio); // top-centre ↔ bottom-centre (Soukupova 3rd pair)
  const horizontal = dist(lm[e.p1], lm[e.p4], imageAspectRatio);
  if (horizontal === 0) return 0;
  // Full 3-pair Soukupova formula: (v1 + v2 + v3) / (2 × horizontal)
  return (vertical1 + vertical2 + vertical3) / (2 * horizontal);
}

/** Symmetry between left and right EAR. 1.0 = perfectly symmetric */
export function eyeSymmetry(lm: Lm, imageAspectRatio: number = 1): number {
  const rEAR = eyeAspectRatio(lm, 'right', imageAspectRatio);
  const lEAR = eyeAspectRatio(lm, 'left', imageAspectRatio);
  const max = Math.max(rEAR, lEAR);
  if (max === 0) return 1;
  return 1 - Math.abs(rEAR - lEAR) / max;
}

/** Eye width (horizontal palpebral fissure) relative to IPD */
export function eyeWidthRatio(lm: Lm, side: 'right' | 'left', imageAspectRatio: number = 1): number {
  const e = side === 'right' ? L.RIGHT_EYE : L.LEFT_EYE;
  const eyeW = dist(lm[e.p1], lm[e.p4], imageAspectRatio);
  const ipd = interpupillaryDistance(lm, imageAspectRatio);
  if (ipd === 0) return 0;
  return eyeW / ipd;
}

/** Interpupillary distance (normalized) */
export function interpupillaryDistance(lm: Lm, imageAspectRatio: number = 1): number {
  return dist(lm[L.RIGHT_IRIS_CENTER], lm[L.LEFT_IRIS_CENTER], imageAspectRatio);
}

// ─── Eyebrow Metrics ────────────────────────────────────────────────────────

/** Eyebrow arch angle (degrees) — angle from inner to peak */
export function eyebrowArchAngle(lm: Lm, side: 'right' | 'left', imageAspectRatio: number = 1): number {
  const brow = side === 'right' ? L.RIGHT_EYEBROW : L.LEFT_EYEBROW;
  const inner = lm[brow[0]];
  const peak = lm[brow[2]];
  const outer = lm[brow[4]];
  return angleAt(inner, peak, outer, imageAspectRatio);
}

/** Eyebrow-to-eye distance (vertical gap) relative to face height */
export function eyebrowEyeDistance(lm: Lm, side: 'right' | 'left', imageAspectRatio: number = 1): number {
  const brow = side === 'right' ? L.RIGHT_EYEBROW : L.LEFT_EYEBROW;
  const eye = side === 'right' ? L.RIGHT_EYE : L.LEFT_EYE;
  const browMidY = alignedY(lm, brow[2], imageAspectRatio);
  const eyeTopY = alignedY(lm, eye.top[0], imageAspectRatio);
  const faceH = faceHeight(lm, imageAspectRatio);
  if (faceH === 0) return 0;
  return Math.abs(browMidY - eyeTopY) / faceH;
}

/** Eyebrow length proxy relative to face height (2D proxy, not true thickness). */
export function eyebrowLengthProxy(lm: Lm, side: 'right' | 'left', imageAspectRatio: number = 1): number {
  const brow = side === 'right' ? L.RIGHT_EYEBROW : L.LEFT_EYEBROW;
  const inner = lm[brow[0]];
  const outer = lm[brow[4]];
  const faceH = faceHeight(lm, imageAspectRatio);
  if (faceH === 0) return 0;
  return dist(inner, outer, imageAspectRatio) / faceH;
}

/** Eyebrow symmetry — comparing arch angles */
export function eyebrowSymmetry(lm: Lm, imageAspectRatio: number = 1): number {
  const rAngle = eyebrowArchAngle(lm, 'right', imageAspectRatio);
  const lAngle = eyebrowArchAngle(lm, 'left', imageAspectRatio);
  const max = Math.max(rAngle, lAngle);
  if (max === 0) return 1;
  return 1 - Math.abs(rAngle - lAngle) / max;
}

// ─── Nose Metrics ───────────────────────────────────────────────────────────

/** Nose width (alar width) relative to IPD. Normal ~0.6-0.8 */
export function noseWidthRatio(lm: Lm, imageAspectRatio: number = 1): number {
  const alarW = dist(lm[L.NOSE.rightAlar], lm[L.NOSE.leftAlar], imageAspectRatio);
  const ipd = interpupillaryDistance(lm, imageAspectRatio);
  if (ipd === 0) return 0;
  return alarW / ipd;
}

/** Nose length relative to face height */
export function noseLengthRatio(lm: Lm, imageAspectRatio: number = 1): number {
  const noseLen = Math.abs(alignedY(lm, L.NOSE.bridge, imageAspectRatio) - alignedY(lm, L.NOSE.bottom, imageAspectRatio));
  const fH = faceHeight(lm, imageAspectRatio);
  if (fH === 0) return 0;
  return noseLen / fH;
}

/** Alar width relative to intercanthal distance (inner canthi). */
export function noseToIntercanthalRatio(lm: Lm, imageAspectRatio: number = 1): number {
  const alarW = dist(lm[L.NOSE.rightAlar], lm[L.NOSE.leftAlar], imageAspectRatio);
  const icd = intercanthalDistance(lm, imageAspectRatio);
  if (icd === 0) return 0;
  return alarW / icd;
}

/** Nose symmetry — comparing left/right alar distances from midline */
export function noseSymmetry(lm: Lm, imageAspectRatio: number = 1): number {
  const midX = (alignedX(lm, L.NOSE.bridge, imageAspectRatio) + alignedX(lm, L.NOSE.tip, imageAspectRatio)) / 2;
  const rDist = Math.abs(alignedX(lm, L.NOSE.rightAlar, imageAspectRatio) - midX);
  const lDist = Math.abs(alignedX(lm, L.NOSE.leftAlar, imageAspectRatio) - midX);
  const max = Math.max(rDist, lDist);
  if (max === 0) return 1;
  return 1 - Math.abs(rDist - lDist) / max;
}

// ─── Lip Metrics ────────────────────────────────────────────────────────────

/** Upper to lower lip height ratio */
export function lipRatio(lm: Lm, imageAspectRatio: number = 1): number {
  const upperTopY = L.LIPS.upperTop.map((i) => alignedY(lm, i, imageAspectRatio)).reduce((a, b) => a + b, 0) / L.LIPS.upperTop.length;
  const upperBottomY = L.LIPS.upperBottom.map((i) => alignedY(lm, i, imageAspectRatio)).reduce((a, b) => a + b, 0) / L.LIPS.upperBottom.length;
  const lowerTopY = L.LIPS.lowerTop.map((i) => alignedY(lm, i, imageAspectRatio)).reduce((a, b) => a + b, 0) / L.LIPS.lowerTop.length;
  const lowerBottomY = L.LIPS.lowerBottom.map((i) => alignedY(lm, i, imageAspectRatio)).reduce((a, b) => a + b, 0) / L.LIPS.lowerBottom.length;
  const upperH = Math.abs(upperBottomY - upperTopY);
  const lowerHPrimary = Math.abs(lowerBottomY - lowerTopY);
  const stomionY = (alignedY(lm, L.LIPS.upperCenter, imageAspectRatio) + alignedY(lm, L.LIPS.lowerCenter, imageAspectRatio)) / 2;
  const lowerHFallback = Math.abs(alignedY(lm, L.LIPS.lowerOuter, imageAspectRatio) - stomionY);
  const lowerH = Math.max(lowerHPrimary, lowerHFallback * 0.9);
  if (lowerH === 0) return 0;
  return upperH / lowerH;
}

/** Mouth width relative to IPD */
export function mouthWidthRatio(lm: Lm, imageAspectRatio: number = 1): number {
  const mouthW = dist(lm[L.LIPS.rightCorner], lm[L.LIPS.leftCorner], imageAspectRatio);
  const ipd = interpupillaryDistance(lm, imageAspectRatio);
  if (ipd === 0) return 0;
  return mouthW / ipd;
}

/** Mouth corner tilt angle (degrees). Positive = right corner appears higher than left in aligned frame. */
export function mouthCornerTilt(lm: Lm, imageAspectRatio: number = 1): number {
  const right = { x: alignedX(lm, L.LIPS.rightCorner, imageAspectRatio), y: alignedY(lm, L.LIPS.rightCorner, imageAspectRatio) };
  const left = { x: alignedX(lm, L.LIPS.leftCorner, imageAspectRatio), y: alignedY(lm, L.LIPS.leftCorner, imageAspectRatio) };
  const [imageLeft, imageRight] = left.x <= right.x ? [left, right] : [right, left];
  const width = imageRight.x - imageLeft.x;
  if (width === 0) return 0;
  // Positive when the right mouth corner is higher (smaller y in image coordinates).
  return Math.atan2(imageLeft.y - imageRight.y, width) * (180 / Math.PI);
}

/** Lip symmetry — comparing corner distances from center */
export function lipSymmetry(lm: Lm, imageAspectRatio: number = 1): number {
  const center = midpoint(lm[L.LIPS.upperCenter], lm[L.LIPS.lowerCenter]);
  const rDist = dist(lm[L.LIPS.rightCorner], center, imageAspectRatio);
  const lDist = dist(lm[L.LIPS.leftCorner], center, imageAspectRatio);
  const max = Math.max(rDist, lDist);
  if (max === 0) return 1;
  return 1 - Math.abs(rDist - lDist) / max;
}

// ─── Jaw / Chin Metrics ─────────────────────────────────────────────────────

/** Jaw width relative to face width at cheekbones */
export function jawWidthRatio(lm: Lm, imageAspectRatio: number = 1): number {
  const jawW = dist(lm[L.JAW.rightBody], lm[L.JAW.leftBody], imageAspectRatio);
  const faceW = faceWidth(lm, imageAspectRatio);
  if (faceW === 0) return 0;
  return jawW / faceW;
}

/**
 * Chin height relative to face height.
 * Measured from menton (chin tip) to stomion (oral fissure midpoint) per Farkas (1994).
 * Falls back to labrale inferius (lm[17]) when mouth is open (lips apart >1.5% face height),
 * as stomion shifts downward in open-mouth poses making the measurement shorter than truth.
 */
export function chinHeightRatio(lm: Lm, imageAspectRatio: number = 1): number {
  const upperY = alignedY(lm, L.LIPS.upperCenter, imageAspectRatio);
  const lowerY = alignedY(lm, L.LIPS.lowerCenter, imageAspectRatio);
  const fH = faceHeight(lm, imageAspectRatio);
  if (fH === 0) return 0;
  const lipGap = Math.abs(lowerY - upperY) / fH;
  // If lips are apart >1.5% of face height, stomion is unreliable — fall back to labrale inferius
  const upperBoundaryY = lipGap > 0.015
    ? alignedY(lm, L.LIPS.lowerOuter, imageAspectRatio)   // lm[17]: open-mouth fallback
    : (upperY + lowerY) / 2;                               // stomion: closed-mouth accurate
  const chinH = Math.abs(alignedY(lm, L.CHIN.tip, imageAspectRatio) - upperBoundaryY);
  return chinH / fH;
}

/** V-shape proxy — ratio of jaw width to forehead width. Lower = more V-shape */
export function vShapeProxy(lm: Lm, imageAspectRatio: number = 1): number {
  const jawW = dist(lm[L.JAW.rightBody], lm[L.JAW.leftBody], imageAspectRatio);
  const foreheadW = dist(lm[L.FOREHEAD.right], lm[L.FOREHEAD.left], imageAspectRatio);
  if (foreheadW === 0) return 0;
  return jawW / foreheadW;
}

/** Face height-to-width ratio */
export function faceHeightWidthRatio(lm: Lm, imageAspectRatio: number = 1): number {
  const fH = faceHeight(lm, imageAspectRatio);
  const fW = faceWidth(lm, imageAspectRatio);
  if (fW === 0) return 0;
  return fH / fW;
}

/** Jaw symmetry */
export function jawSymmetry(lm: Lm, imageAspectRatio: number = 1): number {
  const chin = lm[L.CHIN.tip];
  const rDist = dist(lm[L.JAW.rightAngle], chin, imageAspectRatio);
  const lDist = dist(lm[L.JAW.leftAngle], chin, imageAspectRatio);
  const max = Math.max(rDist, lDist);
  if (max === 0) return 1;
  return 1 - Math.abs(rDist - lDist) / max;
}

// ─── Face Reference ─────────────────────────────────────────────────────────

export function faceHeight(lm: Lm, imageAspectRatio: number = 1): number {
  const top = estimateFaceTopAlignedY(lm, imageAspectRatio);
  const bottom = alignedY(lm, L.REFERENCE.faceBottom, imageAspectRatio);
  return Math.abs(bottom - top);
}

export function faceWidth(lm: Lm, imageAspectRatio: number = 1): number {
  const lateral = dist(lm[L.REFERENCE.rightCheekbone], lm[L.REFERENCE.leftCheekbone], imageAspectRatio);
  const zygomatic = dist(lm[L.ZYGION.right], lm[L.ZYGION.left], imageAspectRatio);
  return (lateral + zygomatic) / 2;
}

/** Estimate face thirds — ideally equal: hairline-to-brow, brow-to-nose, nose-to-chin */
export function faceThirds(lm: Lm, imageAspectRatio: number = 1): { upper: number; middle: number; lower: number } {
  const top = estimateFaceTopAlignedY(lm, imageAspectRatio);
  const browMid = (alignedY(lm, L.RIGHT_EYEBROW[2], imageAspectRatio) + alignedY(lm, L.LEFT_EYEBROW[2], imageAspectRatio)) / 2;
  const noseBase = alignedY(lm, L.NOSE.bottom, imageAspectRatio);
  const chin = alignedY(lm, L.REFERENCE.faceBottom, imageAspectRatio);
  const total = chin - top;
  if (total === 0) return { upper: 0.33, middle: 0.33, lower: 0.33 };
  return {
    upper: (browMid - top) / total,
    middle: (noseBase - browMid) / total,
    lower: (chin - noseBase) / total,
  };
}

/** Lower-face proportion proxy: subnasale->stomion to stomion->menton. */
export function lowerFaceRatio(lm: Lm, imageAspectRatio: number = 1): number {
  const stomion = (alignedY(lm, L.LIPS.upperCenter, imageAspectRatio) + alignedY(lm, L.LIPS.lowerCenter, imageAspectRatio)) / 2;
  const upper = Math.abs(stomion - alignedY(lm, L.NOSE.bottom, imageAspectRatio));
  const lower = Math.abs(alignedY(lm, L.CHIN.tip, imageAspectRatio) - stomion);
  if (lower === 0) return 0;
  return upper / lower;
}

/** Intercanthal distance (inner canthus to inner canthus). */
export function intercanthalDistance(lm: Lm, imageAspectRatio: number = 1): number {
  return dist(lm[L.RIGHT_EYE.inner], lm[L.LEFT_EYE.inner], imageAspectRatio);
}

/** Biocular width (outer canthus to outer canthus). */
export function biocularWidth(lm: Lm, imageAspectRatio: number = 1): number {
  return dist(lm[L.RIGHT_EYE.outer], lm[L.LEFT_EYE.outer], imageAspectRatio);
}

/** Mean eye fissure width. */
export function averageEyeWidth(lm: Lm, imageAspectRatio: number = 1): number {
  return (dist(lm[L.RIGHT_EYE.outer], lm[L.RIGHT_EYE.inner], imageAspectRatio) + dist(lm[L.LEFT_EYE.outer], lm[L.LEFT_EYE.inner], imageAspectRatio)) / 2;
}

/** Facial fifths proxies often used in 2D esthetic analyses. */
export function facialFifthsProxy(lm: Lm, imageAspectRatio: number = 1): {
  intercanthalToEye: number;
  facialWidthToEye: number;
  biocularToFaceWidth: number;
} {
  const icd = intercanthalDistance(lm, imageAspectRatio);
  const eyeW = averageEyeWidth(lm, imageAspectRatio);
  const faceW = faceWidth(lm, imageAspectRatio);
  const biocular = biocularWidth(lm, imageAspectRatio);
  return {
    intercanthalToEye: eyeW > 0 ? icd / eyeW : 0,
    facialWidthToEye: eyeW > 0 ? faceW / eyeW : 0,
    biocularToFaceWidth: faceW > 0 ? biocular / faceW : 0,
  };
}

/** Mouth width relative to nose width (alar base). */
export function mouthToNoseWidthRatio(lm: Lm, imageAspectRatio: number = 1): number {
  const mouthW = dist(lm[L.LIPS.rightCorner], lm[L.LIPS.leftCorner], imageAspectRatio);
  const noseW = dist(lm[L.NOSE.rightAlar], lm[L.NOSE.leftAlar], imageAspectRatio);
  if (noseW === 0) return 0;
  return mouthW / noseW;
}

export function headRollDegrees(lm: Lm, imageAspectRatio: number = 1): number {
  return headRollRad(lm, imageAspectRatio) * (180 / Math.PI);
}

/**
 * Lower face profile angle proxy at menton.
 * Measures angle: nose_base → menton → jaw_angle.
 * NOTE: This is NOT the true cervico-mental angle (which requires the neck/cervical point).
 * Used as a rough 2D proxy for the lower face profile shape only.
 */
export function lowerFaceProfileAngle(lm: Lm, side: 'left' | 'right', imageAspectRatio: number = 1): number {
  // SAM contour mapping stores the near/visible jaw on opposite index:
  // left profile -> JAW.rightAngle, right profile -> JAW.leftAngle.
  const jawNear = side === 'left' ? L.JAW.rightAngle : L.JAW.leftAngle;
  return angleAt(lm[L.NOSE.bottom], lm[L.CHIN.tip], lm[jawNear], imageAspectRatio);
}
/** @deprecated Use lowerFaceProfileAngle */
export const submentalContourAngle = lowerFaceProfileAngle;

// ─── Skin Analysis (pixel-based) ────────────────────────────────────────────

export interface SkinMetrics {
  avgBrightness: number;      // 0-255
  brightnessVariance: number; // higher = more uneven texture
  rednessIndex: number;       // ratio of red channel prominence
  colorUniformity: number;    // 0-1, higher = more uniform
}

/**
 * Analyze skin properties from pixel data in specified regions.
 * Regions are given as face-mesh landmark indices to sample around.
 */
export function analyzeSkinRegion(
  imageData: ImageData,
  landmarks: Lm,
  regionIndices: number[],
  imageWidth: number,
  imageHeight: number,
  sampleRadius: number = 5,
): SkinMetrics {
  const pixels: { r: number; g: number; b: number }[] = [];

  for (const idx of regionIndices) {
    if (idx >= landmarks.length) continue;
    const lm = landmarks[idx];
    const cx = Math.round(lm.x * imageWidth);
    const cy = Math.round(lm.y * imageHeight);

    for (let dy = -sampleRadius; dy <= sampleRadius; dy++) {
      for (let dx = -sampleRadius; dx <= sampleRadius; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (px < 0 || px >= imageWidth || py < 0 || py >= imageHeight) continue;
        const i = (py * imageWidth + px) * 4;
        pixels.push({
          r: imageData.data[i],
          g: imageData.data[i + 1],
          b: imageData.data[i + 2],
        });
      }
    }
  }

  if (pixels.length === 0) {
    return { avgBrightness: 128, brightnessVariance: 0, rednessIndex: 0, colorUniformity: 1 };
  }

  // Brightness (luminance)
  const brightnesses = pixels.map((p) => 0.299 * p.r + 0.587 * p.g + 0.114 * p.b);
  const avgBrightness = brightnesses.reduce((a, b) => a + b, 0) / brightnesses.length;
  const brightnessVariance =
    brightnesses.reduce((sum, b) => sum + (b - avgBrightness) ** 2, 0) / brightnesses.length;

  // Redness index — how dominant is the red channel
  const avgR = pixels.reduce((s, p) => s + p.r, 0) / pixels.length;
  const avgG = pixels.reduce((s, p) => s + p.g, 0) / pixels.length;
  const avgB = pixels.reduce((s, p) => s + p.b, 0) / pixels.length;
  const totalColor = avgR + avgG + avgB;
  const rednessIndex = totalColor > 0 ? avgR / totalColor - 0.333 : 0; // deviation from neutral

  // Color uniformity — inverse of color std dev
  const colorStdDev = Math.sqrt(
    pixels.reduce((sum, p) => {
      return sum + (p.r - avgR) ** 2 + (p.g - avgG) ** 2 + (p.b - avgB) ** 2;
    }, 0) / (pixels.length * 3),
  );
  const colorUniformity = Math.max(0, 1 - colorStdDev / 128);

  return { avgBrightness, brightnessVariance, rednessIndex, colorUniformity };
}

// ─── Lighting Assessment ────────────────────────────────────────────────────

export function assessLighting(
  imageData: ImageData,
  _width: number,
  _height: number,
): 'good' | 'moderate' | 'poor' {
  let totalBrightness = 0;
  const step = 4; // sample every 4th pixel for speed
  let count = 0;

  for (let i = 0; i < imageData.data.length; i += 4 * step) {
    const r = imageData.data[i];
    const g = imageData.data[i + 1];
    const b = imageData.data[i + 2];
    totalBrightness += 0.299 * r + 0.587 * g + 0.114 * b;
    count++;
  }

  const avg = totalBrightness / count;

  if (avg > 80 && avg < 200) return 'good';
  if (avg > 50 && avg < 230) return 'moderate';
  return 'poor';
}

// ─── Profile-based Metrics (Tasks C/D) ──────────────────────────────────────

/**
 * Nose projection ratio from profile view.
 * Measures how far the nose tip (pronasale) projects forward from the face plane,
 * normalized to face height. Uses robust median of nose tip candidates.
 */
export function noseProjectionRatio(profileLm: Lm, imageAspectRatio: number = 1): number {
  const asp = normalizeAspectRatio(imageAspectRatio);
  const noseTip = profilePronasale(profileLm);
  const nasion = robustMedian(profileLm, L.NASION_CANDIDATES);
  const chin = profileLm[L.CHIN.tip];

  // Face depth reference: vertical distance nasion → chin
  const faceH = Math.abs(chin.y - nasion.y);
  if (faceH === 0) return 0;

  // Horizontal projection of nose tip from the nasion-chin line
  // Positive = nose projects forward of the line
  const lineX = nasion.x * asp + (chin.x - nasion.x) * asp * ((noseTip.y - nasion.y) / (chin.y - nasion.y || 1));
  const projection = Math.abs(noseTip.x * asp - lineX);

  return projection / faceH;
}

/**
 * Nasofrontal angle proxy from profile.
 * Uses angle at nasion between:
 *  1) Forehead tangent (approximated by faceTop→glabella direction)
 *  2) Nasal dorsum direction (nasion→pronasale)
 */
export function nasofrontalDepthProxy(profileLm: Lm, imageAspectRatio: number = 1): number {
  const glabella = robustMedian(profileLm, L.GLABELLA_CANDIDATES);
  const nasion = robustMedian(profileLm, L.NASION_CANDIDATES);
  const foreheadTangentPoint = profileForeheadTangentAtNasion(profileLm);
  const noseTip = profilePronasale(profileLm);

  const localNfa = angleAt(glabella, nasion, noseTip, imageAspectRatio);
  const tangentNfa = angleAt(foreheadTangentPoint, nasion, noseTip, imageAspectRatio);
  const foreheadDirDelta = angleAt(glabella, nasion, foreheadTangentPoint, imageAspectRatio);

  let chosen = foreheadDirDelta <= 25 ? tangentNfa : localNfa;
  if ((chosen < 95 || chosen > 170) && localNfa >= 95 && localNfa <= 170) {
    chosen = localNfa;
  }
  // Outside clinical range means degenerate silhouette — unreliable
  if (chosen < 95 || chosen > 170) return NaN;
  return chosen;
}

/**
 * Nasolabial angle proxy from profile.
 * In profile: preferred classical cm→sn→ls; falls back to prn→sn→ls when cm is unstable.
 */
export function nasolabialAngleProxy(profileLm: Lm, imageAspectRatio: number = 1): number {
  const pronasale = profilePronasale(profileLm);
  const columella = profileColumella(profileLm);
  const subnasale = profileSubnasale(profileLm);
  const labialeSuperius = profileLabialeSuperius(profileLm);

  // If cm is too close to sn/prn, it is likely collapsed to alar rim in profile;
  // then prn→sn→ls is a more stable proxy.
  const cmSn = dist(columella, subnasale, imageAspectRatio);
  const cmPrn = dist(columella, pronasale, imageAspectRatio);
  const nlaCm = angleAt(columella, subnasale, labialeSuperius, imageAspectRatio);
  const nlaPrn = angleAt(pronasale, subnasale, labialeSuperius, imageAspectRatio);

  const cmCollapsed = cmSn < 0.01 || cmPrn < 0.006;
  if (cmCollapsed) return nlaPrn;

  const cmPlausible = nlaCm >= 70 && nlaCm <= 155;
  const prnPlausible = nlaPrn >= 70 && nlaPrn <= 155;
  if (cmPlausible && !prnPlausible) return nlaCm;
  if (!cmPlausible && prnPlausible) return nlaPrn;
  if (cmPlausible && prnPlausible) return nlaCm;

  // If both are implausible, prefer the one closer to the physiological center.
  return Math.abs(nlaPrn - 100) < Math.abs(nlaCm - 100) ? nlaPrn : nlaCm;
}

/**
 * Chin projection ratio from profile view.
 * How far the chin (pogonion) projects forward relative to the nasion–subnasale line.
 */
export function chinProjectionRatio(
  profileLm: Lm,
  imageAspectRatio: number = 1,
  side?: 'left' | 'right',
): number {
  const asp = normalizeAspectRatio(imageAspectRatio);
  const nasion = robustMedian(profileLm, L.NASION_CANDIDATES);
  const subnasale = profileSubnasale(profileLm);
  const pogonion = robustMedian(profileLm, L.CHIN_SOFT_TISSUE_DENSE);

  const refDist = dist(nasion, subnasale, imageAspectRatio);
  if (refDist === 0) return 0;

  // Signed horizontal distance of pogonion from nasion-subnasale line
  const lineX = nasion.x * asp + (subnasale.x - nasion.x) * asp * ((pogonion.y - nasion.y) / (subnasale.y - nasion.y || 1));
  const raw = (pogonion.x * asp - lineX) / refDist;
  if (side === 'left') return -raw;
  if (side === 'right') return raw;
  return raw;
}

/**
 * Jaw profile angle proxy (2D approximation only).
 * Measures face_top → jaw_angle → chin. NOTE: this is NOT the true gonial angle.
 * True gonial angle (Ricketts 1981: 121–130°) requires ascending ramus from tragion,
 * not the crown of the head. Published clinical norms are NOT applicable here.
 * Used only for relative comparison between subjects, not absolute clinical assessment.
 */
export function jawProfileAngleProxy(profileLm: Lm, side: 'left' | 'right' = 'left', imageAspectRatio: number = 1): number {
  // SAM contour mapping stores the near/visible jaw on opposite index:
  // left profile -> JAW.rightAngle, right profile -> JAW.leftAngle.
  const gonion = side === 'left' ? profileLm[L.JAW.rightAngle] : profileLm[L.JAW.leftAngle];
  const faceTop = profileLm[L.REFERENCE.faceTop];
  const chin = profileLm[L.CHIN.tip];
  return angleAt(faceTop, gonion, chin, imageAspectRatio);
}
/** @deprecated Use jawProfileAngleProxy */
export const gonialAngleProxy = jawProfileAngleProxy;

/**
 * Canthal tilt: signed height difference between lateral and medial canthus.
 * Positive = lateral canthus higher than medial (upward tilt — associated with youth).
 * Negative = lateral canthus lower (downward tilt).
 * Normalized to face height. Powell & Humphreys (1984): female ideal +2–4mm lateral.
 */
export function canthalTilt(lm: Lm, side: 'right' | 'left', imageAspectRatio: number = 1): number {
  const e = side === 'right' ? L.RIGHT_EYE : L.LEFT_EYE;
  const lateralY = alignedY(lm, e.outer, imageAspectRatio);
  const medialY  = alignedY(lm, e.inner, imageAspectRatio);
  const fH = faceHeight(lm, imageAspectRatio);
  if (fH === 0) return 0;
  // In screen coordinates, smaller y = higher. Positive when lateral is higher.
  return (medialY - lateralY) / fH;
}

/**
 * Lip projection ratio from profile view.
 * Signed distance of labiale superius from the subnasale-pogonion line (Ricketts E-line proxy).
 */
export function lipProjectionRatio(
  profileLm: Lm,
  imageAspectRatio: number = 1,
  side?: 'left' | 'right',
): number {
  const asp = normalizeAspectRatio(imageAspectRatio);
  const subnasale = profileSubnasale(profileLm);
  const pogonion = robustMedian(profileLm, L.CHIN_SOFT_TISSUE_DENSE);
  const ls = profileLabialeSuperius(profileLm);

  const refDist = dist(subnasale, pogonion, imageAspectRatio);
  if (refDist === 0) return 0;

  // Signed perpendicular distance from ls to line(sn, pg)
  const dx = (pogonion.x - subnasale.x) * asp;
  const dy = pogonion.y - subnasale.y;
  const denom = Math.hypot(dx, dy);
  if (denom === 0) return 0;
  const signedDist = (((ls.x - subnasale.x) * asp) * dy - (ls.y - subnasale.y) * dx) / denom;

  const raw = signedDist / refDist;
  if (side === 'left') return -raw;
  if (side === 'right') return raw;
  return raw;
}

/**
 * Malar projection ratio — cheekbone prominence from profile.
 * Measures how far the malar region projects laterally from the face midline.
 */
export function malarProjectionProxy(profileLm: Lm, side: 'left' | 'right' = 'left', imageAspectRatio: number = 1): number {
  const asp = normalizeAspectRatio(imageAspectRatio);
  const malarDense = side === 'left' ? L.MALAR_DENSE_LEFT : L.MALAR_DENSE_RIGHT;
  const malarCenter = robustMedian(profileLm, malarDense);
  const nasion = robustMedian(profileLm, L.NASION_CANDIDATES);
  const chin = profileLm[L.CHIN.tip];

  const faceH = Math.abs(chin.y - nasion.y);
  if (faceH === 0) return 0;

  // Project malar center's x-distance from nasion-chin midline
  const midX = ((nasion.x + chin.x) / 2) * asp;
  return Math.abs(malarCenter.x * asp - midX) / faceH;
}

/**
 * Multi-view metric fusion.
 * Combines up to 3 view measurements with confidence-weighted average.
 */
export function fuseMetric(
  frontValue: number | null,
  leftValue: number | null,
  rightValue: number | null,
  weights: { front: number; left: number; right: number } = { front: 0.5, left: 0.25, right: 0.25 },
): { value: number; confidence: number; sourceViews: ('front' | 'left' | 'right')[] } {
  let sum = 0, wSum = 0;
  const sources: ('front' | 'left' | 'right')[] = [];

  if (frontValue !== null) {
    sum += frontValue * weights.front;
    wSum += weights.front;
    sources.push('front');
  }
  if (leftValue !== null) {
    sum += leftValue * weights.left;
    wSum += weights.left;
    sources.push('left');
  }
  if (rightValue !== null) {
    sum += rightValue * weights.right;
    wSum += weights.right;
    sources.push('right');
  }

  const value = wSum > 0 ? sum / wSum : 0;
  // Confidence scales with how many views were used (3 views = 1.0, 1 view = 0.5)
  const confidence = sources.length === 3 ? 1.0 : sources.length === 2 ? 0.75 : sources.length === 1 ? 0.5 : 0;

  return { value, confidence, sourceViews: sources };
}
