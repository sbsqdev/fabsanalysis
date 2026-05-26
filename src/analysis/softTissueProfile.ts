/**
 * Soft-tissue cephalometric profile analysis.
 *
 * Maps MediaPipe 478-point face mesh landmarks to classical soft-tissue
 * cephalometric points (Glabella, Nasion, Pronasale, Columella, Subnasale,
 * Labiale Superius, Pogonion) and computes scale-invariant profile ratios.
 *
 * IMPORTANT: All profile metrics are *approximations* derived from a 2-D
 * landmark mesh that was NOT designed for cephalometric analysis.
 * Confidence is capped at 0.55 for any single-profile measurement.
 */

import type { NormalizedLandmark } from '../types';
import { robustMedian, weightedCentroid } from './metrics';
import * as L from './landmarks';

// ─── Types ──────────────────────────────────────────────────────────────────

/** A soft-tissue landmark extracted from MediaPipe data. */
export interface SoftTissueLandmark {
  /** The estimated 3-D point (normalized coords). */
  point: NormalizedLandmark;
  /** Estimation confidence 0..1 (function of candidate count & consistency). */
  confidence: number;
  /** Human-readable name for debugging. */
  label: string;
  /** MediaPipe indices used. */
  sourceIndices: readonly number[];
}

/** Full set of 7 soft-tissue profile landmarks. */
export interface SoftTissueProfile {
  /** Glabella — smooth prominence between brows. */
  g: SoftTissueLandmark;
  /** Face top (optional) — used to approximate forehead tangent direction. */
  ft?: SoftTissueLandmark;
  /** Nasion — deepest point of frontonasal suture. */
  n: SoftTissueLandmark;
  /** Pronasale — most anterior point of the nose (tip). */
  prn: SoftTissueLandmark;
  /** Columella — fleshy column between nostrils. */
  cm: SoftTissueLandmark;
  /** Subnasale — junction of columella and upper lip. */
  sn: SoftTissueLandmark;
  /** Labiale Superius — upper lip vermilion border center. */
  ls: SoftTissueLandmark;
  /** Pogonion — most anterior point of the chin. */
  pg: SoftTissueLandmark;

  /** Which side of the face was captured ('left' | 'right'). */
  side: 'left' | 'right';
  /** Overall extraction quality 0..1. */
  overallConfidence: number;
  /** Quality flags for edge cases. */
  qualityFlags: string[];
}

/** Scale-invariant ratios derived from a SoftTissueProfile. */
export interface SoftTissueMetrics {
  /**
   * Reference distance n→pg used for normalization (in normalized coords).
   * All ratios below are divided by this value to be scale-invariant.
   */
  nPgDistance: number;

  /** g→n / n→pg — upper-face depth ratio. */
  gNRatio: number;
  /** n→prn / n→pg — nose projection. */
  nPrnRatio: number;
  /** sn→ls / n→pg — upper-lip height relative to face. */
  snLsRatio: number;
  /** ls→pg / n→pg — lower-face depth (lip-to-chin). */
  lsPgRatio: number;
  /** cm→sn / n→pg — columella length. */
  cmSnRatio: number;
  /** Angle at sn between cm→sn→ls (nasolabial angle). */
  nasolabialAngle: number;
  /** Angle at n between g→n→prn (nasofrontal angle). */
  nasofrontalAngle: number;
  /** Horizontal offset of prn from the n→pg line, / n→pg — nose tip protrusion. */
  noseProtrusion: number;
  /** Horizontal offset of ls from the sn→pg line, / sn→pg — lip protrusion (E-line proxy). */
  lipProtrusion: number;

  /** Per-metric confidence 0..1 */
  confidence: number;
  /** Source views used */
  sourceViews: ('left' | 'right')[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

type Lm = NormalizedLandmark[];

function dist2d(a: NormalizedLandmark, b: NormalizedLandmark, asp = 1): number {
  return Math.hypot((a.x - b.x) * asp, a.y - b.y);
}

function angleAtPoint(
  a: NormalizedLandmark,
  vertex: NormalizedLandmark,
  c: NormalizedLandmark,
  asp = 1,
): number {
  const v1x = (a.x - vertex.x) * asp;
  const v1y = a.y - vertex.y;
  const v2x = (c.x - vertex.x) * asp;
  const v2y = c.y - vertex.y;
  const dot = v1x * v2x + v1y * v2y;
  const cross = v1x * v2y - v1y * v2x;
  const rad = Math.atan2(Math.abs(cross), dot);
  return rad * (180 / Math.PI);
}

/**
 * Compute spread (standard deviation) of candidate points.
 * Low spread → candidates agree → higher confidence.
 * Returns a confidence multiplier 0..1.
 */
function candidateConsistency(lm: Lm, indices: readonly number[]): number {
  if (indices.length <= 1) return 0.5;

  const pts = indices.map((i) => lm[i]).filter(Boolean);
  if (pts.length === 0) return 0;    // no candidates → zero confidence (Bug 4)
  if (pts.length === 1) return 0.5;  // single source → moderate confidence

  const meanX = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const meanY = pts.reduce((s, p) => s + p.y, 0) / pts.length;

  const variance =
    pts.reduce((s, p) => s + (p.x - meanX) ** 2 + (p.y - meanY) ** 2, 0) /
    pts.length;
  const spread = Math.sqrt(variance);

  // If spread < 1e-6 → all identical (SAM duplicate) → cap at 0.65 (Bug 5)
  // If spread < 0.005 → very consistent → 1.0
  // If spread > 0.03  → poor consistency → 0.3
  if (spread < 1e-6) return 0.65;
  if (spread < 0.005) return 1.0;
  if (spread > 0.03) return 0.3;
  return 1.0 - ((spread - 0.005) / 0.025) * 0.7;
}

/**
 * Horizontal offset of a point from a line defined by two points,
 * normalized by a reference distance.
 */
function signedOffsetFromLine(
  point: NormalizedLandmark,
  lineStart: NormalizedLandmark,
  lineEnd: NormalizedLandmark,
  refDist: number,
  asp = 1,
): number {
  if (refDist === 0) return 0;
  // Work in aspect-corrected (y-unit) space throughout
  const dx = (lineEnd.x - lineStart.x) * asp;
  const dy = lineEnd.y - lineStart.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return 0;
  const px = (point.x - lineStart.x) * asp;
  const py = point.y - lineStart.y;
  const signedDist = (dx * py - dy * px) / len;
  return signedDist / refDist;
}

// ─── Extraction ─────────────────────────────────────────────────────────────

/**
 * Extract the 7 soft-tissue cephalometric landmarks from a single profile view.
 *
 * Uses robust median of dense candidate sets (from landmarks.ts) to estimate
 * each anatomical point. Candidate consistency is used to derive per-point
 * confidence.
 *
 * @param profileLm  478-point landmark array for a profile capture
 * @param side       Which profile was captured ('left' | 'right')
 */
export function extractSoftTissueProfile(
  profileLm: Lm,
  side: 'left' | 'right',
  imageAspectRatio = 1,
): SoftTissueProfile {
  const asp = (Number.isFinite(imageAspectRatio) && imageAspectRatio > 0) ? imageAspectRatio : 1;
  const flags: string[] = [];

  // --- Extract each landmark ---

  const g: SoftTissueLandmark = {
    point: robustMedian(profileLm, L.GLABELLA_CANDIDATES),
    confidence: candidateConsistency(profileLm, L.GLABELLA_CANDIDATES) * 0.55,
    label: 'Glabella (g\')',
    sourceIndices: L.GLABELLA_CANDIDATES,
  };

  const faceTopPoint = profileLm[L.REFERENCE.faceTop];
  const ft: SoftTissueLandmark | undefined = faceTopPoint
    ? {
        point: faceTopPoint,
        confidence: 0.45,
        label: 'FaceTop (ft)',
        sourceIndices: [L.REFERENCE.faceTop],
      }
    : undefined;

  const n: SoftTissueLandmark = {
    point: robustMedian(profileLm, L.NASION_CANDIDATES),
    confidence: candidateConsistency(profileLm, L.NASION_CANDIDATES) * 0.55,
    label: 'Nasion (n\')',
    sourceIndices: L.NASION_CANDIDATES,
  };

  const prnDirect = profileLm[L.NOSE.tip];
  const prnSourceIndices: readonly number[] = prnDirect ? [L.NOSE.tip] : L.NOSE_TIP_DENSE;
  const prnConsistency = prnDirect ? 1 : candidateConsistency(profileLm, L.NOSE_TIP_DENSE);

  const prn: SoftTissueLandmark = {
    point: prnDirect ?? robustMedian(profileLm, L.NOSE_TIP_DENSE),
    confidence: prnConsistency * 0.55,
    label: 'Pronasale (prn)',
    sourceIndices: prnSourceIndices,
  };

  const cm: SoftTissueLandmark = {
    point: robustMedian(profileLm, L.COLUMELLA_CANDIDATES),
    confidence: candidateConsistency(profileLm, L.COLUMELLA_CANDIDATES) * 0.50,
    label: 'Columella (cm)',
    sourceIndices: L.COLUMELLA_CANDIDATES,
  };

  const sn: SoftTissueLandmark = {
    point: robustMedian(profileLm, L.SUBNASALE_CANDIDATES),
    confidence: candidateConsistency(profileLm, L.SUBNASALE_CANDIDATES) * 0.50,
    label: 'Subnasale (sn)',
    sourceIndices: L.SUBNASALE_CANDIDATES,
  };

  const ls: SoftTissueLandmark = {
    // Use a short weighted centroid on the vermilion center to reduce jitter.
    point: weightedCentroid(
      profileLm,
      [L.LIPS.upperCenter, L.LIPS.upperOuter],
      [0.65, 0.35],
    ),
    confidence: 0.48,
    label: 'Labiale Superius (ls)',
    sourceIndices: [L.LIPS.upperCenter, L.LIPS.upperOuter],
  };

  const pg: SoftTissueLandmark = {
    point: robustMedian(profileLm, L.CHIN_SOFT_TISSUE_DENSE),
    confidence: candidateConsistency(profileLm, L.CHIN_SOFT_TISSUE_DENSE) * 0.55,
    label: 'Pogonion (pg)',
    sourceIndices: L.CHIN_SOFT_TISSUE_DENSE,
  };

  // --- Quality flags ---

  // Check if key landmarks are suspiciously close (possible collapsed mesh)
  const nPgDist = dist2d(n.point, pg.point, asp);
  if (nPgDist < 0.05) {
    flags.push('n_pg_too_close');
  }

  // Check side consistency: on a left profile, nose tip should be left of jaw center
  const rightJaw = profileLm[L.JAW.rightAngle];
  const leftJaw  = profileLm[L.JAW.leftAngle];
  if (rightJaw && leftJaw) {
    const jawMidX = (rightJaw.x + leftJaw.x) / 2;
    const noseTipX = prn.point.x;
    // Left profile → nose tip should be LEFT of jaw midpoint (offset < 0)
    // Right profile → nose tip should be RIGHT of jaw midpoint (offset > 0)
    const offset = noseTipX - jawMidX;
    const mismatch = side === 'left' ? offset > 0 : offset < 0;
    if (mismatch) {
      flags.push('direction_mismatch');
    }
  }

  // Check for edge landmarks (very close to 0 or 1 in x)
  const allPoints = [g, n, prn, cm, sn, ls, pg];
  for (const lmk of allPoints) {
    if (lmk.point.x < 0.02 || lmk.point.x > 0.98) {
      flags.push(`edge_landmark_${lmk.label.split(' ')[0].toLowerCase()}`);
    }
  }

  // Overall confidence: geometric mean of per-landmark confidences,
  // penalized by quality flags
  const confProduct = allPoints.reduce((p, l) => p * l.confidence, 1);
  let overallConfidence = Math.pow(confProduct, 1 / allPoints.length);
  if (flags.includes('n_pg_too_close')) overallConfidence *= 0.5;
  if (flags.includes('direction_mismatch')) overallConfidence *= 0.6;
  if (flags.some((f) => f.startsWith('edge_landmark_')))
    overallConfidence *= 0.85;

  return { g, ft, n, prn, cm, sn, ls, pg, side, overallConfidence, qualityFlags: flags };
}

// ─── Metrics computation ────────────────────────────────────────────────────

/**
 * Compute scale-invariant cephalometric ratios from an extracted profile.
 *
 * All distances are normalized to dist(n, pg) — the mid-face height
 * from nasion to pogonion — making them independent of image resolution
 * and face-to-camera distance.
 */
export function computeSoftTissueMetrics(
  profile: SoftTissueProfile,
  imageAspectRatio = 1,
): SoftTissueMetrics {
  const asp = (Number.isFinite(imageAspectRatio) && imageAspectRatio > 0) ? imageAspectRatio : 1;
  const { g, ft, n, prn, cm, sn, ls, pg } = profile;

  const nPgDistance = dist2d(n.point, pg.point, asp);

  // Avoid division by zero
  const safe = nPgDistance > 0.01 ? nPgDistance : 0.01;
  const snPgDist = dist2d(sn.point, pg.point, asp);
  const safeSn = snPgDist > 0.005 ? snPgDist : 0.005;

  // --- Ratios ---
  const gNRatio = dist2d(g.point, n.point, asp) / safe;
  const nPrnRatio = dist2d(n.point, prn.point, asp) / safe;
  const snLsRatio = dist2d(sn.point, ls.point, asp) / safe;
  const lsPgRatio = dist2d(ls.point, pg.point, asp) / safe;
  const cmSnRatio = dist2d(cm.point, sn.point, asp) / safe;

  // --- Angles ---
  // NFA: tangent of forehead (ft→g translated to n) vs dorsum n→prn.
  const foreheadTangentAtN = (() => {
    if (!ft) return g.point;
    const vx = g.point.x - ft.point.x;
    const vy = g.point.y - ft.point.y;
    const len = Math.hypot(vx, vy);
    if (len < 1e-6) return g.point;
    return { x: n.point.x + vx, y: n.point.y + vy, z: n.point.z };
  })();
  const localNasofrontal = angleAtPoint(g.point, n.point, prn.point, asp);
  const tangentNasofrontal = angleAtPoint(foreheadTangentAtN, n.point, prn.point, asp);
  const foreheadDirDelta = angleAtPoint(g.point, n.point, foreheadTangentAtN, asp);
  let nasofrontalAngle = foreheadDirDelta <= 25 ? tangentNasofrontal : localNasofrontal;
  if ((nasofrontalAngle < 95 || nasofrontalAngle > 170) && localNasofrontal >= 95 && localNasofrontal <= 170) {
    nasofrontalAngle = localNasofrontal;
  }

  // NLA: preferred cm→sn→ls; robust fallback to prn→sn→ls when cm is unstable/implausible.
  const cmSnDist = dist2d(cm.point, sn.point, asp);
  const cmPrnDist = dist2d(cm.point, prn.point, asp);
  const nlaCm = angleAtPoint(cm.point, sn.point, ls.point, asp);
  const nlaPrn = angleAtPoint(prn.point, sn.point, ls.point, asp);
  const cmCollapsed = cmSnDist < 0.01 || cmPrnDist < 0.006;
  let nasolabialAngle: number;
  if (cmCollapsed) {
    nasolabialAngle = nlaPrn;
  } else {
    const cmPlausible = nlaCm >= 70 && nlaCm <= 155;
    const prnPlausible = nlaPrn >= 70 && nlaPrn <= 155;
    if (cmPlausible && !prnPlausible) nasolabialAngle = nlaCm;
    else if (!cmPlausible && prnPlausible) nasolabialAngle = nlaPrn;
    else if (cmPlausible && prnPlausible) nasolabialAngle = nlaCm;
    else nasolabialAngle = Math.abs(nlaPrn - 100) < Math.abs(nlaCm - 100) ? nlaPrn : nlaCm;
  }

  // --- Protrusions ---
  const noseProtrusion = signedOffsetFromLine(prn.point, n.point, pg.point, safe, asp);
  const lipProtrusion = signedOffsetFromLine(ls.point, sn.point, pg.point, safeSn, asp);

  // Confidence: combine profile overall with metric-specific checks
  let confidence = profile.overallConfidence;
  // Sanity: nasolabial angle (prn→sn→ls) clinical range 70–155°
  if (nasolabialAngle < 70 || nasolabialAngle > 155) confidence *= 0.7;
  // Sanity: nasofrontal angle clinical range 100–165° (Powell & Humphreys 1984)
  if (nasofrontalAngle < 100 || nasofrontalAngle > 165) confidence *= 0.7;

  return {
    nPgDistance,
    gNRatio: round4(gNRatio),
    nPrnRatio: round4(nPrnRatio),
    snLsRatio: round4(snLsRatio),
    lsPgRatio: round4(lsPgRatio),
    cmSnRatio: round4(cmSnRatio),
    nasolabialAngle: round1(nasolabialAngle),
    nasofrontalAngle: round1(nasofrontalAngle),
    noseProtrusion: round4(noseProtrusion),
    lipProtrusion: round4(lipProtrusion),
    confidence: round4(Math.max(0, Math.min(1, confidence))),
    sourceViews: [profile.side],
  };
}

// ─── Multi-view fusion ──────────────────────────────────────────────────────

/**
 * Fuse soft-tissue metrics from left and right profiles.
 * Returns averaged ratios with combined confidence.
 */
export function fuseSoftTissueMetrics(
  left: SoftTissueMetrics | null,
  right: SoftTissueMetrics | null,
): SoftTissueMetrics | null {
  if (!left && !right) return null;
  if (!left) return right;
  if (!right) return left;

  const stronger = left.confidence >= right.confidence ? left : right;
  const weaker = stronger === left ? right : left;
  const confidenceGap = stronger.confidence - weaker.confidence;
  const confidenceRatio = weaker.confidence > 1e-6 ? stronger.confidence / weaker.confidence : Number.POSITIVE_INFINITY;

  // Side-disagreement score (0..1): higher means profiles disagree noticeably.
  const disagreement = (() => {
    const angleDelta = (
      Math.abs(left.nasolabialAngle - right.nasolabialAngle) / 25 +
      Math.abs(left.nasofrontalAngle - right.nasofrontalAngle) / 20
    ) / 2;
    const ratioDelta = (
      Math.abs(left.snLsRatio - right.snLsRatio) / 0.08 +
      Math.abs(left.lsPgRatio - right.lsPgRatio) / 0.10 +
      Math.abs(left.cmSnRatio - right.cmSnRatio) / 0.06 +
      Math.abs(left.nPrnRatio - right.nPrnRatio) / 0.08
    ) / 4;
    return Math.max(0, Math.min(1, 0.55 * angleDelta + 0.45 * ratioDelta));
  })();

  // Prefer the best side when confidence is clearly better, or when two sides
  // disagree and one side is substantially more reliable.
  const shouldUseDominantSide =
    (stronger.confidence >= 0.50 && weaker.confidence <= 0.32) ||
    (confidenceGap >= 0.12 && confidenceRatio >= 1.35) ||
    (disagreement >= 0.55 && confidenceGap >= 0.08 && confidenceRatio >= 1.22);
  if (shouldUseDominantSide) {
    return {
      ...stronger,
      sourceViews: [...stronger.sourceViews],
      confidence: round4(Math.max(0, Math.min(1, stronger.confidence))),
    };
  }

  // Weighted average based on individual confidences
  const wL = left.confidence;
  const wR = right.confidence;
  const wTotal = wL + wR || 1;

  const avg = (a: number, b: number) => (a * wL + b * wR) / wTotal;

  return {
    nPgDistance: avg(left.nPgDistance, right.nPgDistance),
    gNRatio: round4(avg(left.gNRatio, right.gNRatio)),
    nPrnRatio: round4(avg(left.nPrnRatio, right.nPrnRatio)),
    snLsRatio: round4(avg(left.snLsRatio, right.snLsRatio)),
    lsPgRatio: round4(avg(left.lsPgRatio, right.lsPgRatio)),
    cmSnRatio: round4(avg(left.cmSnRatio, right.cmSnRatio)),
    nasolabialAngle: round1(avg(left.nasolabialAngle, right.nasolabialAngle)),
    nasofrontalAngle: round1(avg(left.nasofrontalAngle, right.nasofrontalAngle)),
    noseProtrusion: round4(avg(left.noseProtrusion, right.noseProtrusion)),
    lipProtrusion: round4(avg(left.lipProtrusion, right.lipProtrusion)),
    // Combined confidence: slightly boosted when both views agree
    confidence: round4(
      Math.min(1, ((wL + wR) / 2) * 1.15),
    ),
    sourceViews: ['left', 'right'],
  };
}

// ─── Rounding helpers ───────────────────────────────────────────────────────

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
