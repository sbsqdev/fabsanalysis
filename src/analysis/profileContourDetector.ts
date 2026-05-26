/**
 * Profile Contour Landmark Detector
 *
 * Detects 7 cephalometric landmarks on 90-degree profile face photos using
 * Canvas-based edge detection and contour tracing. This replaces MediaPipe
 * for profile images, where FaceLandmarker produces unreliable results.
 *
 * Pipeline:
 *   1. Preprocessing: grayscale + Gaussian blur
 *   2. Edge detection: Sobel + non-maximum suppression + hysteresis (BFS, O(n))
 *   3. Silhouette contour extraction with ROI guard
 *   4. Cephalometric landmark identification via 1D projection curve
 *
 * Zero external dependencies — uses only Canvas API and typed arrays.
 */

import type { NormalizedLandmark } from '../types';
import * as L from './landmarks';

// ─── Public types ───────────────────────────────────────────────────────────

export interface ProfileContourResult {
  /**
   * Truly sparse 478-element array: only detected indices are set,
   * undetected indices are `undefined`. Downstream code uses .filter(Boolean)
   * so undefined values are safely ignored by robustMedian/weightedCentroid.
   */
  landmarks: NormalizedLandmark[];
  /** Overall detection confidence 0..1 */
  confidence: number;
  /** Raw contour points for debugging/visualization */
  contourPoints: { x: number; y: number }[];
  /** Per-landmark details (normalized coords) */
  landmarkDetails: Record<string, { point: NormalizedLandmark; confidence: number }>;
  /** Source identifier */
  source: 'contour';
}

// ─── Stage 1: Preprocessing ─────────────────────────────────────────────────

function toGrayscale(imageData: ImageData): Float32Array {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const j = i * 4;
    gray[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  }
  return gray;
}

function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const radius = Math.ceil(sigma * 3);
  const kernel: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(v);
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let val = 0;
      for (let k = -radius; k <= radius; k++) {
        val += src[y * w + Math.min(w - 1, Math.max(0, x + k))] * kernel[k + radius];
      }
      tmp[y * w + x] = val;
    }
  }
  const dst = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let val = 0;
      for (let k = -radius; k <= radius; k++) {
        val += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x] * kernel[k + radius];
      }
      dst[y * w + x] = val;
    }
  }
  return dst;
}

// ─── Stage 2: Edge Detection ─────────────────────────────────────────────────

interface EdgeResult {
  magnitude: Float32Array;
  direction: Float32Array;
  width: number;
  height: number;
}

function sobelEdge(gray: Float32Array, w: number, h: number): EdgeResult {
  const mag = new Float32Array(w * h);
  const dir = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -gray[(y - 1) * w + (x - 1)] + gray[(y - 1) * w + (x + 1)] +
        -2 * gray[y * w + (x - 1)] + 2 * gray[y * w + (x + 1)] +
        -gray[(y + 1) * w + (x - 1)] + gray[(y + 1) * w + (x + 1)];
      const gy =
        -gray[(y - 1) * w + (x - 1)] - 2 * gray[(y - 1) * w + x] - gray[(y - 1) * w + (x + 1)] +
        gray[(y + 1) * w + (x - 1)] + 2 * gray[(y + 1) * w + x] + gray[(y + 1) * w + (x + 1)];
      mag[y * w + x] = Math.hypot(gx, gy);
      dir[y * w + x] = Math.atan2(gy, gx);
    }
  }
  return { magnitude: mag, direction: dir, width: w, height: h };
}

function nonMaxSuppression(edge: EdgeResult): Float32Array {
  const { magnitude: mag, direction: dir, width: w, height: h } = edge;
  const result = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const m = mag[idx];
      if (m === 0) continue;
      let angle = dir[idx] * (180 / Math.PI);
      if (angle < 0) angle += 180;
      let n1 = 0, n2 = 0;
      if (angle < 22.5 || angle >= 157.5) {
        n1 = mag[y * w + (x - 1)]; n2 = mag[y * w + (x + 1)];
      } else if (angle < 67.5) {
        n1 = mag[(y - 1) * w + (x + 1)]; n2 = mag[(y + 1) * w + (x - 1)];
      } else if (angle < 112.5) {
        n1 = mag[(y - 1) * w + x]; n2 = mag[(y + 1) * w + x];
      } else {
        n1 = mag[(y - 1) * w + (x - 1)]; n2 = mag[(y + 1) * w + (x + 1)];
      }
      result[idx] = (m >= n1 && m >= n2) ? m : 0;
    }
  }
  return result;
}

/**
 * Hysteresis thresholding using BFS (O(n)) instead of naive while-loop (O(n²)).
 * Prevents CPU freeze on large images.
 */
function hysteresisThreshold(nms: Float32Array, w: number, h: number): Uint8Array {
  const nonZero: number[] = [];
  for (let i = 0; i < nms.length; i++) {
    if (nms[i] > 0) nonZero.push(nms[i]);
  }
  if (nonZero.length === 0) return new Uint8Array(w * h);

  nonZero.sort((a, b) => a - b);
  const highThresh = nonZero[Math.floor(nonZero.length * 0.85)];
  const lowThresh = nonZero[Math.floor(nonZero.length * 0.40)];

  // 0=none, 1=weak, 2=strong
  const edges = new Uint8Array(w * h);
  const stack: number[] = [];

  for (let i = 0; i < nms.length; i++) {
    if (nms[i] >= highThresh) {
      edges[i] = 2;
      stack.push(i);
    } else if (nms[i] >= lowThresh) {
      edges[i] = 1;
    }
  }

  // BFS: propagate strong edges to adjacent weak edges — O(n), no re-scanning
  while (stack.length > 0) {
    const curr = stack.pop()!;
    const cy = Math.floor(curr / w);
    const cx = curr % w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ny = cy + dy, nx = cx + dx;
        if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
        const ni = ny * w + nx;
        if (edges[ni] === 1) {
          edges[ni] = 2;
          stack.push(ni);
        }
      }
    }
  }

  const binary = new Uint8Array(w * h);
  for (let i = 0; i < edges.length; i++) binary[i] = edges[i] === 2 ? 1 : 0;
  return binary;
}

// ─── Stage 3: Silhouette Contour Extraction ─────────────────────────────────

export interface ContourPoint { x: number; y: number }

/**
 * Extract the face silhouette contour from an edge map.
 *
 * ROI guard: skip top 5% and bottom 5% (likely background/clothing).
 * For each row, scan from the face side and take the first edge pixel
 * that is within the expected 65% of image width (guards against background walls).
 */
function extractSilhouetteContour(
  edgeMap: Uint8Array,
  w: number,
  h: number,
  side: 'left' | 'right',
): ContourPoint[] {
  // ROI: skip extreme top/bottom rows
  const yStart = Math.floor(h * 0.05);
  const yEnd = Math.floor(h * 0.95);

  // For left profile (face on left): scan left→right, accept x < 0.65*w
  // For right profile (face on right): scan right→left, accept x > 0.35*w
  const xLimit = side === 'left' ? Math.floor(w * 0.65) : Math.floor(w * 0.35);

  const raw: (number | null)[] = new Array(h).fill(null);
  for (let y = yStart; y < yEnd; y++) {
    if (side === 'left') {
      for (let x = 0; x < xLimit; x++) {
        if (edgeMap[y * w + x]) { raw[y] = x; break; }
      }
    } else {
      for (let x = w - 1; x >= xLimit; x--) {
        if (edgeMap[y * w + x]) { raw[y] = x; break; }
      }
    }
  }

  // Median filter (window=7) to smooth noise
  const halfWin = 3;
  const smoothed: (number | null)[] = new Array(h).fill(null);
  for (let y = yStart; y < yEnd; y++) {
    const vals: number[] = [];
    for (let k = -halfWin; k <= halfWin; k++) {
      const sy = y + k;
      if (sy >= yStart && sy < yEnd && raw[sy] !== null) vals.push(raw[sy]!);
    }
    if (vals.length >= 2) {
      vals.sort((a, b) => a - b);
      smoothed[y] = vals[Math.floor(vals.length / 2)];
    }
  }

  // Find longest contiguous run of rows with valid contour
  let bestStart = yStart, bestEnd = yStart, bestLen = 0, curStart = -1;
  for (let y = yStart; y < yEnd; y++) {
    if (smoothed[y] !== null) {
      if (curStart === -1) curStart = y;
    } else if (curStart !== -1) {
      const len = y - curStart;
      if (len > bestLen) { bestLen = len; bestStart = curStart; bestEnd = y; }
      curStart = -1;
    }
  }
  if (curStart !== -1) {
    const len = yEnd - curStart;
    if (len > bestLen) { bestLen = len; bestStart = curStart; bestEnd = yEnd; }
  }

  if (bestLen < h * 0.25) return [];

  // Build contour, filtering jumps >12% of image width
  const maxJump = w * 0.12;
  const contour: ContourPoint[] = [];
  let prevX: number | null = null;
  for (let y = bestStart; y < bestEnd; y++) {
    const x = smoothed[y];
    if (x === null) continue;
    if (prevX !== null && Math.abs(x - prevX) > maxJump) continue;
    contour.push({ x, y });
    prevX = x;
  }
  return contour;
}

// ─── Stage 4: Cephalometric Landmark Identification ─────────────────────────

interface LandmarkCandidate {
  name: string;
  point: ContourPoint;
  confidence: number;
  contourIndex: number;
}

function buildProjectionCurve(contour: ContourPoint[], w: number, side: 'left' | 'right'): number[] {
  // Projection must be measured from the far edge so protrusions become peaks.
  return contour.map((p) => side === 'left' ? (w - 1 - p.x) : p.x);
}

// ─── Phase 2: Savitzky-Golay + feature-based landmark scoring ───────────────

// SG smoothing coefficients (cubic polynomial, symmetric windows)
const SG_COEFFS: Record<number, { c: number[]; norm: number }> = {
  7:  { c: [-2, 3, 6, 7, 6, 3, -2], norm: 21 },
  9:  { c: [-21, 14, 39, 54, 59, 54, 39, 14, -21], norm: 231 },
  11: { c: [-36, 9, 44, 69, 84, 89, 84, 69, 44, 9, -36], norm: 429 },
  13: { c: [-11, 0, 9, 16, 21, 24, 25, 24, 21, 16, 9, 0, -11], norm: 143 },
  15: { c: [-78, -13, 42, 87, 122, 147, 162, 167, 162, 147, 122, 87, 42, -13, -78], norm: 1105 },
};

// SG first derivative coefficients: c_k = k, norm = 2·Σ_{k=1}^{m}(k²)
const SG_D1_COEFFS: Record<number, { c: number[]; norm: number }> = {
  7:  { c: [-3, -2, -1, 0, 1, 2, 3], norm: 28 },
  9:  { c: [-4, -3, -2, -1, 0, 1, 2, 3, 4], norm: 60 },
  11: { c: [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5], norm: 110 },
  13: { c: [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6], norm: 182 },
  15: { c: [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7], norm: 280 },
};

function chooseSgWindow(N: number): number {
  const raw = Math.round(N / 45) | 1;
  const clamped = Math.max(7, Math.min(15, raw));
  const opts = [7, 9, 11, 13, 15] as const;
  return opts.reduce((a, b) => Math.abs(b - clamped) < Math.abs(a - clamped) ? b : a);
}

function savitzkyGolay(signal: number[], win: number): number[] {
  const e = SG_COEFFS[win];
  if (!e) return smooth1D(signal, win);
  const { c, norm } = e;
  const half = (win - 1) / 2;
  const N = signal.length;
  const out = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    if (i < half || i >= N - half) {
      let s = 0, cnt = 0;
      for (let k = -half; k <= half; k++) { s += signal[Math.max(0, Math.min(N - 1, i + k))]; cnt++; }
      out[i] = s / cnt;
    } else {
      let v = 0;
      for (let k = 0; k < win; k++) v += c[k] * signal[i - half + k];
      out[i] = v / norm;
    }
  }
  return out;
}

function savitzkyGolayD1(signal: number[], win: number): number[] {
  const e = SG_D1_COEFFS[win];
  if (!e) return derivative(signal);
  const { c, norm } = e;
  const half = (win - 1) / 2;
  const N = signal.length;
  const out = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    if (i < half || i >= N - half) {
      if (i === 0) out[i] = signal[1] - signal[0];
      else if (i === N - 1) out[i] = signal[N - 1] - signal[N - 2];
      else out[i] = (signal[i + 1] - signal[i - 1]) / 2;
    } else {
      let v = 0;
      for (let k = 0; k < win; k++) v += c[k] * signal[i - half + k];
      out[i] = v / norm;
    }
  }
  return out;
}

function smooth1D(signal: number[], windowSize: number): number[] {
  const half = Math.floor(windowSize / 2);
  return signal.map((_, i) => {
    let sum = 0, count = 0;
    for (let k = -half; k <= half; k++) {
      const idx = i + k;
      if (idx >= 0 && idx < signal.length) { sum += signal[idx]; count++; }
    }
    return sum / count;
  });
}

function derivative(signal: number[]): number[] {
  return signal.map((_, i) => {
    if (i === 0) return signal[1] - signal[0];
    if (i === signal.length - 1) return signal[i] - signal[i - 1];
    return (signal[i + 1] - signal[i - 1]) / 2;
  });
}

function clamp01v(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

/** Walk outward from global-max at 35% threshold to find face bounding box */
function computeFaceBBox(smoothed: number[]): { topIdx: number; bottomIdx: number; faceH: number; globalMax: number } {
  const N = smoothed.length;
  let globalMax = -Infinity, gmIdx = 0;
  for (let i = 0; i < N; i++) if (smoothed[i] > globalMax) { globalMax = smoothed[i]; gmIdx = i; }
  const thr = globalMax * 0.35;
  let topIdx = gmIdx;
  for (let i = gmIdx - 1; i >= 0; i--) { if (smoothed[i] < thr) break; topIdx = i; }
  let bottomIdx = gmIdx;
  for (let i = gmIdx + 1; i < N; i++) { if (smoothed[i] < thr) break; bottomIdx = i; }
  const faceH = bottomIdx - topIdx;
  if (faceH < N * 0.25) {
    const p10 = Math.floor(N * 0.10), p90 = Math.floor(N * 0.90);
    return { topIdx: p10, bottomIdx: p90, faceH: p90 - p10, globalMax };
  }
  return { topIdx, bottomIdx, faceH, globalMax };
}

/** Topographic prominence within bounded walk */
function computeProminence(smoothed: number[], idx: number, isPeak: boolean): number {
  const N = smoothed.length;
  const walk = Math.min(50, Math.floor(N * 0.15));
  const val = smoothed[idx];
  let le = val;
  for (let j = idx - 1; j >= Math.max(0, idx - walk); j--) {
    if (isPeak) { le = Math.min(le, smoothed[j]); if (smoothed[j] > val) break; }
    else         { le = Math.max(le, smoothed[j]); if (smoothed[j] < val) break; }
  }
  let re = val;
  for (let j = idx + 1; j <= Math.min(N - 1, idx + walk); j++) {
    if (isPeak) { re = Math.min(re, smoothed[j]); if (smoothed[j] > val) break; }
    else         { re = Math.max(re, smoothed[j]); if (smoothed[j] < val) break; }
  }
  return isPeak ? val - Math.max(le, re) : Math.min(le, re) - val;
}

type LmKey = 'g' | 'n' | 'prn' | 'sn' | 'ls' | 'pg' | 'li';

const LM_IS_PEAK: Record<LmKey, boolean> = {
  g: true, n: false, prn: true, sn: false, ls: true, pg: true, li: false,
};

// n.center corrected 0.165→0.285: nasion sits at ~27-29% faceH, not 16.5%
const LM_YNORM_CENTER: Record<LmKey, number> = {
  g: 0.190, n: 0.285, prn: 0.465, sn: 0.600, ls: 0.740, pg: 0.890, li: 0.790,
};
const LM_YNORM_HALF: Record<LmKey, number> = {
  g: 0.100, n: 0.120, prn: 0.115, sn: 0.080, ls: 0.070, pg: 0.110, li: 0.045,
};

/** True normal curvature κ = Pd2 / (1 + Pd1²)^1.5 */
function computeKappa(Pd1: number[], Pd2: number[]): number[] {
  const N = Math.min(Pd1.length, Pd2.length);
  const out = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    const p1 = Pd1[i] ?? 0;
    const p2 = Pd2[i] ?? 0;
    out[i] = p2 / Math.max(1e-6, Math.pow(1 + p1 * p1, 1.5));
  }
  return out;
}

function isLocalExtremum(smoothed: number[], i: number, isPeak: boolean): boolean {
  if (i <= 0 || i >= smoothed.length - 1) return false;
  return isPeak
    ? smoothed[i] >= smoothed[i - 1] && smoothed[i] >= smoothed[i + 1]
    : smoothed[i] <= smoothed[i - 1] && smoothed[i] <= smoothed[i + 1];
}

function getZoneBounds(N: number, zoneS: number, zoneE: number): { start: number; end: number } {
  return {
    start: Math.max(0, Math.min(N - 1, zoneS)),
    end:   Math.max(0, Math.min(N - 1, zoneE)),
  };
}

function getZoneStats(
  smoothed: number[], promArr: number[], kappa: number[], start: number, end: number,
): { zMin: number; zRange: number; promMax: number; kappaAbsMax: number } {
  let zMin = Infinity, zMax = -Infinity, promMax = 0, kappaAbsMax = 0;
  for (let i = start; i <= end; i++) {
    if (smoothed[i] < zMin) zMin = smoothed[i];
    if (smoothed[i] > zMax) zMax = smoothed[i];
    if (promArr[i] > promMax) promMax = promArr[i];
    const ka = Math.abs(kappa[i] ?? 0);
    if (ka > kappaAbsMax) kappaAbsMax = ka;
  }
  return { zMin, zRange: (zMax - zMin) || 1, promMax, kappaAbsMax };
}

/** Feature score for a single contour index as landmark lm — uses true κ + kappaMagNorm */
function scorePoint(
  i: number,
  smoothed: number[], Pd1: number[], kappa: number[], yNorm: number[],
  promPeak: number[], promValley: number[],
  zMin: number, zRange: number, promMax: number, kappaAbsMax: number,
  lm: LmKey,
): number {
  const isPeak = LM_IS_PEAK[lm];
  const Ps_norm   = (smoothed[i] - zMin) / zRange;
  const promArr   = isPeak ? promPeak : promValley;
  const prom_norm = promMax > 0 ? clamp01v(promArr[i] / promMax) : 0;
  const kappaVal  = kappa[i] ?? 0;
  const kappaSign = isPeak ? (kappaVal < 0 ? 1.0 : 0.1) : (kappaVal > 0 ? 1.0 : 0.1);
  const kappaMagNorm = kappaAbsMax > 0 ? clamp01v(Math.abs(kappaVal) / kappaAbsMax) : 0;
  const N = smoothed.length;
  let derivOk = 0.5;
  if (i > 0 && i < N - 1) {
    if (isPeak  && Pd1[i - 1] > 0 && Pd1[i + 1] < 0) derivOk = 1.0;
    else if (!isPeak && Pd1[i - 1] < 0 && Pd1[i + 1] > 0) derivOk = 1.0;
    else derivOk = 0.2;
  }
  const yn     = yNorm[i] ?? 0.5;
  const yScore = clamp01v(1 - Math.abs(yn - LM_YNORM_CENTER[lm]) / (LM_YNORM_HALF[lm] || 0.1));
  switch (lm) {
    case 'prn': return clamp01v(0.40 * Ps_norm + 0.20 * prom_norm + 0.12 * kappaSign + 0.08 * kappaMagNorm + 0.10 * derivOk + 0.10 * yScore);
    case 'n':   return clamp01v(0.25 * (1 - Ps_norm) + 0.25 * prom_norm + 0.15 * kappaSign + 0.10 * kappaMagNorm + 0.15 * derivOk + 0.10 * yScore);
    case 'sn':  return clamp01v(0.25 * (1 - Ps_norm) + 0.25 * prom_norm + 0.15 * kappaSign + 0.10 * kappaMagNorm + 0.15 * derivOk + 0.10 * yScore);
    case 'g':   return clamp01v(0.30 * Ps_norm + 0.25 * prom_norm + 0.12 * kappaSign + 0.08 * kappaMagNorm + 0.15 * derivOk + 0.10 * yScore);
    case 'ls':  return clamp01v(0.30 * Ps_norm + 0.25 * prom_norm + 0.12 * kappaSign + 0.08 * kappaMagNorm + 0.15 * derivOk + 0.10 * yScore);
    case 'pg':  return clamp01v(0.35 * Ps_norm + 0.25 * prom_norm + 0.12 * kappaSign + 0.08 * kappaMagNorm + 0.10 * derivOk + 0.10 * yScore);
    case 'li':  return clamp01v(0.25 * (1 - Ps_norm) + 0.25 * prom_norm + 0.15 * kappaSign + 0.10 * kappaMagNorm + 0.15 * derivOk + 0.10 * yScore);
    default:    return 0;
  }
}

/** Collect top-K candidate indices for landmark lm in zone [zoneS, zoneE] */
function collectZoneCandidates(
  smoothed: number[], kappa: number[], promPeak: number[], promValley: number[],
  zoneS: number, zoneE: number, lm: LmKey, topK = 5,
): number[] {
  const N = smoothed.length;
  const { start, end } = getZoneBounds(N, zoneS, zoneE);
  if (end <= start) return [];
  const isPeak  = LM_IS_PEAK[lm];
  const promArr = isPeak ? promPeak : promValley;
  const { promMax, kappaAbsMax } = getZoneStats(smoothed, promArr, kappa, start, end);
  const minProm = promMax * 0.10;
  const zoneLen = end - start + 1;
  const minSep  = Math.max(2, Math.round(zoneLen * 0.06));

  const raw: { idx: number; preScore: number }[] = [];
  for (let i = start + 1; i <= end - 1; i++) {
    if (!isLocalExtremum(smoothed, i, isPeak)) continue;
    const prom = promArr[i] ?? 0;
    if (prom < minProm) continue;
    const kappaVal    = kappa[i] ?? 0;
    const kappaSignOk = isPeak ? (kappaVal < 0) : (kappaVal > 0);
    const promNorm    = promMax > 0 ? clamp01v(prom / promMax) : 0;
    const kMagNorm    = kappaAbsMax > 0 ? clamp01v(Math.abs(kappaVal) / kappaAbsMax) : 0;
    const preScore    = 0.55 * promNorm + 0.30 * (kappaSignOk ? 1.0 : 0.1) + 0.15 * kMagNorm;
    raw.push({ idx: i, preScore });
  }
  raw.sort((a, b) => b.preScore - a.preScore);

  const selected: { idx: number; preScore: number }[] = [];
  for (const cand of raw) {
    if (selected.some((k) => Math.abs(cand.idx - k.idx) < minSep)) continue;
    selected.push(cand);
    if (selected.length >= topK) break;
  }
  return selected.map((c) => c.idx);
}

/** Legacy full-zone selector (fallback when candidate count < 2) */
function bestInZoneLegacy(
  smoothed: number[], Pd1: number[], kappa: number[], yNorm: number[],
  promPeak: number[], promValley: number[],
  zoneS: number, zoneE: number, lm: LmKey,
): { idx: number; score: number; margin: number; method: string; candidateCount: number } {
  const N = smoothed.length;
  const { start, end } = getZoneBounds(N, zoneS, zoneE);
  if (end <= start) return { idx: Math.round((start + end) / 2), score: 0.3, margin: 0, method: 'fallback', candidateCount: 0 };
  const isPeak  = LM_IS_PEAK[lm];
  const promArr = isPeak ? promPeak : promValley;
  const { zMin, zRange, promMax, kappaAbsMax } = getZoneStats(smoothed, promArr, kappa, start, end);
  let bestIdx = start, bestScore = -Infinity, secondScore = -Infinity;
  for (let i = start; i <= end; i++) {
    const s = scorePoint(i, smoothed, Pd1, kappa, yNorm, promPeak, promValley, zMin, zRange, promMax, kappaAbsMax, lm);
    if (s > bestScore) { secondScore = bestScore; bestScore = s; bestIdx = i; }
    else if (s > secondScore) secondScore = s;
  }
  const margin = clamp01v(bestScore - Math.max(0, secondScore));
  return { idx: bestIdx, score: Math.max(0, bestScore), margin, method: 'fallback', candidateCount: 0 };
}

/** Candidate-based selector — uses collectZoneCandidates, falls back to legacy scan */
function bestInZone(
  smoothed: number[], Pd1: number[], kappa: number[], yNorm: number[],
  promPeak: number[], promValley: number[],
  zoneS: number, zoneE: number, lm: LmKey,
): { idx: number; score: number; margin: number; method: string; candidateCount: number } {
  const candidates = collectZoneCandidates(smoothed, kappa, promPeak, promValley, zoneS, zoneE, lm, 5);
  if (candidates.length < 2) {
    const fb = bestInZoneLegacy(smoothed, Pd1, kappa, yNorm, promPeak, promValley, zoneS, zoneE, lm);
    return { ...fb, candidateCount: candidates.length };
  }
  const N = smoothed.length;
  const { start, end } = getZoneBounds(N, zoneS, zoneE);
  const isPeak  = LM_IS_PEAK[lm];
  const promArr = isPeak ? promPeak : promValley;
  const { zMin, zRange, promMax, kappaAbsMax } = getZoneStats(smoothed, promArr, kappa, start, end);
  let bestIdx = candidates[0], bestScore = -Infinity, secondScore = -Infinity;
  for (const i of candidates) {
    const s = scorePoint(i, smoothed, Pd1, kappa, yNorm, promPeak, promValley, zMin, zRange, promMax, kappaAbsMax, lm);
    if (s > bestScore) { secondScore = bestScore; bestScore = s; bestIdx = i; }
    else if (s > secondScore) secondScore = s;
  }
  const margin = clamp01v(bestScore - Math.max(0, secondScore));
  return { idx: bestIdx, score: Math.max(0, bestScore), margin, method: 'candidate', candidateCount: candidates.length };
}

/** Hybrid columella detection: valley candidate in prn..sn with anatomical interpolation fallback */
function inferColumellaIndex(
  prnIdx: number, snIdx: number,
  smoothed: number[], kappa: number[], promValley: number[],
): { idx: number; score: number; source: string; candidateCount: number } {
  const span = snIdx - prnIdx;
  if (span < 3) {
    return { idx: Math.max(prnIdx + 1, Math.min(snIdx - 1, prnIdx + 1)), score: 0.28, source: 'fallback', candidateCount: 0 };
  }
  const innerPad = Math.max(1, Math.round(span * 0.12));
  const s = Math.max(prnIdx + 1, prnIdx + innerPad);
  const e = Math.min(snIdx - 1, snIdx - innerPad);

  let segMin = Infinity, segMax = -Infinity, kappaAbsMax = 0;
  for (let i = s; i <= e; i++) {
    if (smoothed[i] < segMin) segMin = smoothed[i];
    if (smoothed[i] > segMax) segMax = smoothed[i];
    const ka = Math.abs(kappa[i] ?? 0);
    if (ka > kappaAbsMax) kappaAbsMax = ka;
  }
  const segRange  = (segMax - segMin) || 1;
  const minProm   = segRange * 0.10;
  const zoneLen   = e - s + 1;
  const minSep    = Math.max(2, Math.round(zoneLen * 0.06));

  const raw: { idx: number; prom: number; quality: number; kappaSignOk: boolean }[] = [];
  for (let i = s + 1; i <= e - 1; i++) {
    if (!isLocalExtremum(smoothed, i, false)) continue;
    const prom = promValley[i] ?? 0;
    if (prom < minProm) continue;
    const kappaVal    = kappa[i] ?? 0;
    const kappaSignOk = kappaVal > 0;
    const promNorm    = clamp01v(prom / segRange);
    const kMagNorm    = kappaAbsMax > 0 ? clamp01v(Math.abs(kappaVal) / kappaAbsMax) : 0;
    const quality     = 0.55 * promNorm + 0.30 * (kappaSignOk ? 1.0 : 0.1) + 0.15 * kMagNorm;
    raw.push({ idx: i, prom, quality, kappaSignOk });
  }
  raw.sort((a, b) => b.quality - a.quality);

  const selected: typeof raw = [];
  for (const cand of raw) {
    if (selected.some((k) => Math.abs(cand.idx - k.idx) < minSep)) continue;
    selected.push(cand);
    if (selected.length >= 5) break;
  }

  const best        = selected.length > 0 ? selected[0] : null;
  const valleyStrong = !!(best && best.prom >= minProm && best.kappaSignOk);
  const fallbackIdx = prnIdx + Math.round(span * 0.46);
  const maxAllowed  = prnIdx + Math.round(span * 0.72);
  let idx = valleyStrong ? best!.idx : fallbackIdx;
  idx = Math.max(prnIdx + 1, Math.min(snIdx - 1, Math.min(idx, maxAllowed)));

  if (valleyStrong) {
    return { idx, score: clamp01v(0.45 + 0.40 * best!.quality), source: 'candidate', candidateCount: selected.length };
  }
  const center = prnIdx + Math.round(span * 0.47);
  const rel    = Math.abs(idx - center) / Math.max(2, span * 0.35);
  const aScore = 1 - clamp01v(rel);
  return { idx, score: clamp01v(0.45 * (0.65 + 0.35 * aScore)), source: 'fallback', candidateCount: selected.length };
}

// ─── Pairwise gap refs + penalties (Farkas 1994 / Powell 1984) ───────────────
// [slotA, slotB, refGap, tolerance, lambda] — scrArr indices: g=0 n=1 prn=2 cm=3 sn=4 ls=5 pg=6
const GAP_REFS: [number, number, number, number, number][] = [
  [0, 1, 0.035, 0.040, 0.25], // g→n
  [1, 2, 0.300, 0.080, 0.20], // n→prn
  [2, 4, 0.100, 0.030, 0.60], // prn→sn: tight nose cluster
  [4, 5, 0.140, 0.050, 0.50], // sn→ls: critical
  [5, 6, 0.150, 0.060, 0.25], // ls→pg
];
const PG_MAX_GAP_RATIO = 0.22;

function applyGapPenalties(idxArr: number[], scrArr: number[], faceH: number): void {
  if (faceH <= 0) return;
  for (const [a, b, ref, tol, lambda] of GAP_REFS) {
    const gapObs = (idxArr[b] - idxArr[a]) / faceH;
    const excess = Math.max(0, Math.abs(gapObs - ref) - tol);
    if (excess === 0) continue;
    const penalty = lambda * excess * excess;
    if (scrArr[a] <= scrArr[b]) scrArr[a] = clamp01v(scrArr[a] - penalty);
    else                         scrArr[b] = clamp01v(scrArr[b] - penalty);
  }
}

// ─── DP joint scoring ─────────────────────────────────────────────────────────
// Order: g(0) → n(1) → prn(2) → sn(3) → ls(4) → pg(5)  [cm/li inferred separately]
const DP_LM_ORDER: LmKey[] = ['g', 'n', 'prn', 'sn', 'ls', 'pg'];
const DP_SLOTS    = [0, 1, 2, 4, 5, 6]; // scrArr positions, skipping cm(3)

function computePairScore(prevIdx: number, curIdx: number, prevSlot: number, curSlot: number, faceH: number): number {
  if (curIdx <= prevIdx) return -Infinity;
  if (faceH <= 0) return 0;
  const ref = GAP_REFS.find(([a, b]) => a === prevSlot && b === curSlot);
  if (!ref) return 0;
  const [,, gapRef, tol, lambda] = ref;
  const excess = Math.max(0, Math.abs((curIdx - prevIdx) / faceH - gapRef) - tol);
  return -(lambda * excess * excess);
}

function collectAllCandidates(
  smoothed: number[], Pd1: number[], kappa: number[], yNorm: number[],
  promPeak: number[], promValley: number[],
  faceH: number, yn2i: (yn: number) => number, globalMax: number, N: number,
): { idx: number; localScore: number }[][] {
  const TOP_K = 3;
  const zones: Record<LmKey, [number, number]> = {
    g:   [yn2i(0.04), yn2i(0.22)],
    n:   [yn2i(0.14), yn2i(0.38)],
    prn: [yn2i(0.35), yn2i(0.58)],
    sn:  [yn2i(0.52), yn2i(0.61)],
    ls:  [yn2i(0.68), yn2i(0.84)],
    pg:  [yn2i(0.78), Math.min(N - 1, yn2i(0.74) + Math.round(faceH * PG_MAX_GAP_RATIO))],
    li:  [0, 0], // not used in DP
  };

  return DP_LM_ORDER.map((lm) => {
    const [zS, zE] = zones[lm];
    let candIndices = collectZoneCandidates(smoothed, kappa, promPeak, promValley, zS, zE, lm, TOP_K);

    if (lm === 'prn') {
      const bestP = candIndices.length > 0 ? Math.max(...candIndices.map((i) => smoothed[i])) : 0;
      if (bestP < globalMax * 0.60) {
        let gmIdx = 0;
        for (let i = 1; i < N; i++) if (smoothed[i] > smoothed[gmIdx]) gmIdx = i;
        if (!candIndices.includes(gmIdx)) candIndices = [...candIndices, gmIdx];
      }
    }
    if (candIndices.length === 0) {
      const fb = bestInZoneLegacy(smoothed, Pd1, kappa, yNorm, promPeak, promValley, zS, zE, lm);
      candIndices = [fb.idx];
    }
    if (candIndices.length < 2) {
      const fb = bestInZoneLegacy(smoothed, Pd1, kappa, yNorm, promPeak, promValley, zS, zE, lm);
      if (!candIndices.includes(fb.idx)) candIndices = [...candIndices, fb.idx];
    }

    const isPeak  = LM_IS_PEAK[lm];
    const promArr = isPeak ? promPeak : promValley;
    const { start, end } = getZoneBounds(N, zS, zE);
    const { zMin, zRange, promMax, kappaAbsMax } = getZoneStats(smoothed, promArr, kappa, start, end);
    return candIndices.map((idx) => ({
      idx,
      localScore: scorePoint(idx, smoothed, Pd1, kappa, yNorm, promPeak, promValley, zMin, zRange, promMax, kappaAbsMax, lm),
    }));
  });
}

function dpJointSelect(
  allCandidates: { idx: number; localScore: number }[][], faceH: number,
): { idxArr: number[]; scrArr: number[]; marginArr: number[]; fallbackArr: boolean[] } | null {
  const L = allCandidates.length;
  const dp:  number[][] = Array.from({ length: L }, () => []);
  const par: number[][] = Array.from({ length: L }, () => []);

  for (let j = 0; j < allCandidates[0].length; j++) {
    dp[0][j]  = allCandidates[0][j].localScore;
    par[0][j] = -1;
  }
  for (let s = 1; s < L; s++) {
    const prevSlot = DP_SLOTS[s - 1];
    const curSlot  = DP_SLOTS[s];
    for (let j = 0; j < allCandidates[s].length; j++) {
      const cur = allCandidates[s][j];
      let bestPrev = -Infinity, bestPrevIdx = -1;
      for (let i = 0; i < allCandidates[s - 1].length; i++) {
        const prev  = allCandidates[s - 1][i];
        const pair  = computePairScore(prev.idx, cur.idx, prevSlot, curSlot, faceH);
        if (pair === -Infinity) continue;
        const total = dp[s - 1][i] + cur.localScore + pair;
        if (total > bestPrev) { bestPrev = total; bestPrevIdx = i; }
      }
      dp[s][j]  = bestPrev;
      par[s][j] = bestPrevIdx;
    }
  }

  let bestFinal = -Infinity, bestFinalJ = -1;
  for (let j = 0; j < dp[L - 1].length; j++) {
    if (dp[L - 1][j] > bestFinal) { bestFinal = dp[L - 1][j]; bestFinalJ = j; }
  }
  if (bestFinalJ === -1 || bestFinal === -Infinity) return null;

  const chosen = new Array<number>(L);
  chosen[L - 1] = bestFinalJ;
  for (let s = L - 2; s >= 0; s--) {
    chosen[s] = par[s + 1][chosen[s + 1]];
    if (chosen[s] === -1) return null;
  }

  const idxArr    = chosen.map((ci, s) => allCandidates[s][ci].idx);
  const scrArr    = chosen.map((ci, s) => allCandidates[s][ci].localScore);
  const marginArr = allCandidates.map((cands) => {
    const sorted = cands.map((c) => c.localScore).sort((a, b) => b - a);
    return sorted.length >= 2 ? clamp01v(sorted[0] - sorted[1]) : 0;
  });
  const fallbackArr = new Array<boolean>(L).fill(false);
  return { idxArr, scrArr, marginArr, fallbackArr };
}

function findCephalometricLandmarks(
  contour: ContourPoint[], w: number, _h: number, side: 'left' | 'right',
): LandmarkCandidate[] {
  if (contour.length < 30) return [];

  const projection = buildProjectionCurve(contour, w, side);
  const N   = projection.length;
  const win = chooseSgWindow(N);
  const smoothed = savitzkyGolay(projection, win);
  const Pd1      = savitzkyGolayD1(projection, win);
  const Pd2      = derivative(Pd1);
  const kappa    = computeKappa(Pd1, Pd2);

  const { topIdx, bottomIdx, faceH, globalMax } = computeFaceBBox(smoothed);
  const yn2i  = (yn: number) => Math.max(0, Math.min(N - 1, Math.round(topIdx + yn * faceH)));
  const yNorm = Array.from({ length: N }, (_, i) => (i - topIdx) / (faceH || 1));

  const promPeak   = Array.from({ length: N }, (_, i) => computeProminence(smoothed, i, true));
  const promValley = Array.from({ length: N }, (_, i) => computeProminence(smoothed, i, false));

  console.log(`[ProfileContour] SG win=${win} bbox top=${topIdx} bot=${bottomIdx} faceH=${faceH} N=${N}`);

  const DP_MIN_N = 350;
  let idxArr: number[], scrArr: number[], usedDP = false;
  let cmR: { idx: number; score: number; source: string; candidateCount: number };

  // ─── Primary path: DP joint scoring ──────────────────────────────────────
  try {
    const dpCandidates = N >= DP_MIN_N
      ? collectAllCandidates(smoothed, Pd1, kappa, yNorm, promPeak, promValley, faceH, yn2i, globalMax, N)
      : null;
    const dpResult = dpCandidates ? dpJointSelect(dpCandidates, faceH) : null;

    if (dpResult) {
      const [gIdx, dpNIdx, prnIdx, snIdx, lsIdx, dpPgIdx] = dpResult.idxArr;

      // Re-score n in targeted zone between g and prn
      const nReZS = Math.max(gIdx + 1, yn2i(0.12));
      const nReZE = Math.min(prnIdx - 2, yn2i(0.42));
      const nReR  = bestInZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, nReZS, nReZE, 'n');
      const nIdx  = nReR.idx;

      // Hard pg cap: pg must be within PG_MAX_GAP_RATIO of faceH below ls
      const pgHardMax = Math.min(N - 1, lsIdx + Math.round(faceH * PG_MAX_GAP_RATIO));
      let pgIdx = dpPgIdx, pgScore = dpResult.scrArr[5];
      if (pgIdx > pgHardMax) {
        const pgReZS = Math.max(lsIdx + 2, yn2i(0.78));
        const pgReZE = pgHardMax;
        if (pgReZE > pgReZS) {
          const pgReR = bestInZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, pgReZS, pgReZE, 'pg');
          pgIdx = pgReR.idx; pgScore = pgReR.score;
        }
      }

      cmR = inferColumellaIndex(prnIdx, snIdx, smoothed, kappa, promValley);
      const cmScore = clamp01v(Math.min(dpResult.scrArr[2], dpResult.scrArr[3]) * 0.45 + cmR.score * 0.55);

      idxArr = [gIdx, nIdx, prnIdx, cmR.idx, snIdx, lsIdx, pgIdx];
      scrArr = [dpResult.scrArr[0] * 0.70, nReR.score, dpResult.scrArr[2], cmScore,
                dpResult.scrArr[3], dpResult.scrArr[4], pgScore];
      usedDP = true;
    }
  } catch (e) {
    console.warn('[ProfileContour] DP failed, using sequential:', (e as Error).message);
  }

  // ─── Fallback: sequential detection ──────────────────────────────────────
  if (!usedDP) {
    // prn
    const prnZS = yn2i(0.35), prnZE = yn2i(0.58);
    let prnR = bestInZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, prnZS, prnZE, 'prn');
    if (smoothed[prnR.idx] < globalMax * 0.60) {
      let gmIdx = 0;
      for (let i = 1; i < N; i++) if (smoothed[i] > smoothed[gmIdx]) gmIdx = i;
      prnR = { idx: gmIdx, score: prnR.score, margin: 0, method: 'fallback', candidateCount: 0 };
    }
    const prnIdx = prnR.idx;

    // n
    const nZS = Math.max(0, yn2i(0.12));
    const nZE = Math.min(prnIdx - 2, yn2i(0.42));
    const nR  = bestInZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, nZS, nZE, 'n');
    const nIdx = nR.idx;

    // g
    const gZS = Math.max(0, topIdx);
    const gZE = Math.max(gZS + 2, nIdx - 2);
    const gR  = bestInZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, gZS, gZE, 'g');
    const gIdx = gR.idx;

    // sn — hard cap at prnIdx + 15% faceH
    const snHardMax = Math.min(N - 1, prnIdx + Math.round(faceH * 0.15));
    const snZS = Math.max(prnIdx + 2, yn2i(0.52));
    const snZE = Math.min(snHardMax, yn2i(0.64));
    const snR  = bestInZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, snZS, snZE, 'sn');
    const snIdx = snR.idx;

    // cm
    cmR = inferColumellaIndex(prnIdx, snIdx, smoothed, kappa, promValley);
    const cmScore = clamp01v(Math.min(prnR.score, snR.score) * 0.45 + cmR.score * 0.55);

    // ls
    const lsMinGap = Math.max(2, Math.round(faceH * 0.10));
    const lsMaxGap = Math.max(lsMinGap + 2, Math.round(faceH * 0.24));
    let lsZS = Math.max(snIdx + lsMinGap, yn2i(0.67));
    let lsZE = Math.min(yn2i(0.84), snIdx + lsMaxGap);
    if (lsZE <= lsZS) { lsZS = Math.max(snIdx + Math.max(2, Math.round(faceH * 0.08)), yn2i(0.65)); lsZE = yn2i(0.80); }
    const lsR  = bestInZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, lsZS, lsZE, 'ls');
    const lsIdx = lsR.idx;

    // pg — hard cap at ls + PG_MAX_GAP_RATIO*faceH
    const pgHardMax = Math.min(N - 1, lsIdx + Math.round(faceH * PG_MAX_GAP_RATIO));
    const pgZS = Math.max(lsIdx + 2, yn2i(0.78));
    const pgZE = Math.min(pgHardMax, yn2i(1.00));
    const pgR  = bestInZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, pgZS, pgZE, 'pg');
    const pgIdx = pgR.idx;

    idxArr = [gIdx, nIdx, prnIdx, cmR.idx, snIdx, lsIdx, pgIdx];
    scrArr = [gR.score * 0.70, nR.score, prnR.score, cmScore, snR.score, lsR.score, pgR.score];

    console.log(`[ProfileContour] seq g=${gR.method}:${gR.candidateCount} sn=${snR.method}:${snR.candidateCount} ls=${lsR.method}:${lsR.candidateCount} cm=${cmR.source}:${cmR.candidateCount}`);

    // Ordering repair (up to 3 iters)
    const lmKeys: (LmKey | null)[] = ['g', 'n', 'prn', null, 'sn', 'ls', 'pg'];
    for (let iter = 0; iter < 3; iter++) {
      let ok = true;
      for (let k = 1; k < idxArr.length; k++) {
        if (idxArr[k] <= idxArr[k - 1]) {
          ok = false;
          if (k === 3) {
            const cmRepair = inferColumellaIndex(idxArr[2], idxArr[4], smoothed, kappa, promValley);
            idxArr[3] = cmRepair.idx; scrArr[3] = cmRepair.score;
            continue;
          }
          const key = lmKeys[k];
          const repairS = idxArr[k - 1] + 1;
          const repairE = k + 1 < idxArr.length ? idxArr[k + 1] - 1 : N - 1;
          if (key && repairE > repairS) {
            const re = bestInZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, repairS, repairE, key);
            idxArr[k] = re.idx; scrArr[k] = re.score;
          }
        }
      }
      if (ok) break;
    }

    // Soft gap penalties (DP handles this intrinsically via pairScore)
    applyGapPenalties(idxArr, scrArr, faceH);
  }

  // Final strict ordering check
  for (let i = 1; i < idxArr!.length; i++) {
    if (idxArr![i] <= idxArr![i - 1]) {
      console.warn('[ProfileContour] ordering violation after repair, aborting');
      return [];
    }
  }

  const lmNames = ['glabella', 'nasion', 'pronasale', 'columella', 'subnasale', 'labiale_superius', 'pogonion'] as const;
  const result: LandmarkCandidate[] = lmNames.map((name, k) => ({
    name,
    point: contour[Math.min(idxArr![k], contour.length - 1)],
    confidence: clamp01v(scrArr![k]),
    contourIndex: Math.min(idxArr![k], contour.length - 1),
  }));

  // Step 8: li (labiale inferius) — optional valley between ls and pg
  const liMinGap = Math.max(2, Math.round(faceH * 0.03));
  const liZS = idxArr![5] + liMinGap;
  const liZE = Math.max(liZS + 1, idxArr![6] - liMinGap);
  if (liZE > liZS + 2) {
    const liR = bestInZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, liZS, liZE, 'li');
    result.push({
      name: 'labiale_inferius',
      point: contour[Math.min(liR.idx, contour.length - 1)],
      confidence: clamp01v(liR.score),
      contourIndex: Math.min(liR.idx, contour.length - 1),
    });
  }

  console.log(`[ProfileContour] path=${usedDP ? 'DP' : 'seq'} landmarks:`, result.map((l) => `${l.name}(c=${l.confidence.toFixed(2)})`).join(' '));
  return result;
}

// ─── Mapping to MediaPipe 478-index array ───────────────────────────────────

/**
 * Deduplicated landmark → MediaPipe index mapping.
 *
 * Each MediaPipe index appears in EXACTLY ONE landmark set to prevent
 * overwrite conflicts. The assignment is:
 *   glabella   → [9, 8]          (NOT 168 — 168 belongs to nasion)
 *   nasion     → [168, 6]        (unique: bridge root + bridge mid)
 *   pronasale  → [1]             (canonical tip only; columella owns 2/98/327)
 *   columella  → [2, 98, 327]    (columella base + nostril margins)
 *   subnasale  → [164, 167]      (NOT 0 — 0 belongs to labiale_superius)
 *   ls         → [13, 0]         (upperCenter + upperOuter)
 *   pogonion   → [152, 148, 176, 149, 150, 136, 377, 400, 378, 379]
 */
const LANDMARK_INDEX_MAP: Record<string, readonly number[]> = {
  glabella:         [9, 8],
  nasion:           [168, 6],
  pronasale:        [1],
  columella:        [2, 98, 327],
  subnasale:        [164, 167],
  labiale_superius: [L.LIPS.upperCenter, L.LIPS.upperOuter],   // [13, 0]
  labiale_inferius: [L.LIPS.lowerCenter, L.LIPS.lowerOuter],   // detected valley between ls and pg
  pogonion:         [...L.CHIN_SOFT_TISSUE_DENSE],
};

function buildSparse478(
  cephLandmarks: LandmarkCandidate[],
  contour: ContourPoint[],
  w: number,
  h: number,
  side: 'left' | 'right',
): NormalizedLandmark[] {
  // Truly sparse array: unset slots are `undefined` at runtime.
  // Downstream robustMedian/weightedCentroid use .filter(Boolean) so they
  // naturally skip missing entries. This prevents 0.5/0.5 from poisoning metrics.
  const lm = new Array<NormalizedLandmark>(478);

  const pt = (p: ContourPoint): NormalizedLandmark => ({ x: p.x / w, y: p.y / h, z: 0 });

  // Write each cephalometric landmark to its deduplicated indices
  for (const ceph of cephLandmarks) {
    const indices = LANDMARK_INDEX_MAP[ceph.name];
    if (!indices) continue;
    const norm = pt(ceph.point);
    for (const idx of indices) {
      if (idx < 478) lm[idx] = { ...norm };
    }
  }

  // Nose bridge/dorsum: interpolate nasion→pronasale for dorsum-only indices.
  // Index 6 is already written by nasion above. Only interpolate 197, 195, 5, 4.
  const nasion = cephLandmarks.find((l) => l.name === 'nasion');
  const pronasale = cephLandmarks.find((l) => l.name === 'pronasale');
  if (nasion && pronasale) {
    // NOSE_DORSUM_DENSE = [6, 197, 195, 5, 4]; skip 6 (owned by nasion)
    const dorsumOnly = [197, 195, 5, 4] as const;
    for (let i = 0; i < dorsumOnly.length; i++) {
      const t = (i + 1) / (dorsumOnly.length + 1);
      lm[dorsumOnly[i]] = {
        x: (nasion.point.x + t * (pronasale.point.x - nasion.point.x)) / w,
        y: (nasion.point.y + t * (pronasale.point.y - nasion.point.y)) / h,
        z: 0,
      };
    }
  }

  // Nose alar points: slightly offset from pronasale laterally
  if (pronasale) {
    const nx = pronasale.point.x / w, ny = pronasale.point.y / h;
    const off = 0.025;
    lm[L.NOSE.rightAlar] = { x: nx - off, y: ny + 0.01, z: 0 };
    lm[L.NOSE.leftAlar]  = { x: nx + off, y: ny + 0.01, z: 0 };
  }

  // Lower lip: use detected labiale_inferius if available, else interpolate ls→pg
  const ls = cephLandmarks.find((l) => l.name === 'labiale_superius');
  const pg = cephLandmarks.find((l) => l.name === 'pogonion');
  const li = cephLandmarks.find((l) => l.name === 'labiale_inferius');
  if (!li && ls && pg) {
    lm[L.LIPS.lowerCenter] = {
      x: (ls.point.x + 0.30 * (pg.point.x - ls.point.x)) / w,
      y: (ls.point.y + 0.30 * (pg.point.y - ls.point.y)) / h, z: 0,
    };
    lm[L.LIPS.lowerOuter] = {
      x: (ls.point.x + 0.40 * (pg.point.x - ls.point.x)) / w,
      y: (ls.point.y + 0.40 * (pg.point.y - ls.point.y)) / h, z: 0,
    };
  }

  // faceTop: top of contour
  if (contour.length > 0) {
    lm[L.REFERENCE.faceTop] = { x: contour[0].x / w, y: contour[0].y / h, z: 0 };
  }

  // Jaw angles: place near jaw at detected contour position (~70% height).
  // Place far jaw at estimated back-of-head position so jawMidX is meaningful
  // for the direction-consistency check in softTissueProfile.
  const jawContourIdx = Math.floor(contour.length * 0.70);
  if (jawContourIdx < contour.length) {
    const nearJawPt = { x: contour[jawContourIdx].x / w, y: contour[jawContourIdx].y / h, z: 0 };
    // Far jaw: opposite edge of image at same y (back of head estimate)
    const farJawX = side === 'left' ? 0.82 : 0.18;
    const farJawPt = { x: farJawX, y: nearJawPt.y, z: 0 };
    // For left profile: camera sees subject's LEFT side → visible gonion = JAW.leftAngle (454)
    // For right profile: camera sees subject's RIGHT side → visible gonion = JAW.rightAngle (234)
    // jawProfileAngleProxy(lm, 'left') reads JAW.leftAngle, so near jaw must be at 454 for left profile.
    if (side === 'left') {
      lm[L.JAW.leftAngle]  = nearJawPt;  // 454 = visible left gonion
      lm[L.JAW.rightAngle] = farJawPt;   // 234 = synthetic far-side estimate
    } else {
      lm[L.JAW.rightAngle] = nearJawPt;  // 234 = visible right gonion
      lm[L.JAW.leftAngle]  = farJawPt;   // 454 = synthetic far-side estimate
    }
  }

  // Malar points: contour at ~38% height (cheekbone zone)
  const malarContourIdx = Math.floor(contour.length * 0.38);
  if (malarContourIdx < contour.length) {
    const malarPt = { x: contour[malarContourIdx].x / w, y: contour[malarContourIdx].y / h, z: 0 };
    const malarIndices = side === 'left' ? L.MALAR_DENSE_LEFT : L.MALAR_DENSE_RIGHT;
    for (const idx of malarIndices) lm[idx] = { ...malarPt };
  }

  return lm;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate geometric plausibility of detected landmarks for the given profile side.
 * Returns false if basic anatomy is violated (e.g. nose on wrong side of image).
 */
function validateGeometry(
  cephLandmarks: LandmarkCandidate[],
  w: number,
  side: 'left' | 'right',
): boolean {
  const prn = cephLandmarks.find((l) => l.name === 'pronasale');
  const pg = cephLandmarks.find((l) => l.name === 'pogonion');
  const nasion = cephLandmarks.find((l) => l.name === 'nasion');
  if (!prn) return false;

  const prnXFrac = prn.point.x / w;
  // Pronasale must be on the correct half of the image
  if (side === 'left' && prnXFrac > 0.60) return false;
  if (side === 'right' && prnXFrac < 0.40) return false;

  // Nasion must be above pronasale (lower y value)
  if (nasion && nasion.point.y >= prn.point.y) return false;

  // Pogonion must be below pronasale (higher y value)
  if (pg && pg.point.y <= prn.point.y) return false;

  return true;
}

// ─── SAM mask-based contour extraction ───────────────────────────────────────

/**
 * Extract profile silhouette contour directly from a SAM binary mask.
 * Much cleaner than Canny: no blur/edge-detection artefacts, no hair confusion.
 *
 * For each row, find the outermost mask pixel from the face side.
 * Then run the same cephalometric landmark pipeline on the resulting contour.
 */
function extractContourFromMask(
  mask: Uint8Array,
  mW: number,
  mH: number,
  side: 'left' | 'right',
): ContourPoint[] {
  const yStart = Math.floor(mH * 0.04);
  const yEnd   = Math.ceil(mH * 0.96);

  const raw: (number | null)[] = new Array(mH).fill(null);
  for (let y = yStart; y < yEnd; y++) {
    if (side === 'left') {
      // Face pointing left → nose protrudes left → scan left→right, take rightmost mask edge
      // Actually for a "left" profile: subject faces left in image,
      // so nose is on the left side of image. The visible contour is the left boundary.
      // We want the leftmost occupied pixel = left silhouette edge.
      for (let x = 0; x < mW; x++) {
        if (mask[y * mW + x]) { raw[y] = x; break; }
      }
    } else {
      // "right" profile: subject faces right, nose on right side
      for (let x = mW - 1; x >= 0; x--) {
        if (mask[y * mW + x]) { raw[y] = x; break; }
      }
    }
  }

  // Median filter (window=9)
  const halfWin = 4;
  const smoothed: (number | null)[] = new Array(mH).fill(null);
  for (let y = yStart; y < yEnd; y++) {
    const vals: number[] = [];
    for (let k = -halfWin; k <= halfWin; k++) {
      const sy = y + k;
      if (sy >= yStart && sy < yEnd && raw[sy] !== null) vals.push(raw[sy]!);
    }
    if (vals.length >= 3) {
      vals.sort((a, b) => a - b);
      smoothed[y] = vals[Math.floor(vals.length / 2)];
    }
  }

  // Longest contiguous valid run
  let bestStart = yStart, bestEnd = yStart, bestLen = 0, curStart = -1;
  for (let y = yStart; y < yEnd; y++) {
    if (smoothed[y] !== null) {
      if (curStart === -1) curStart = y;
    } else if (curStart !== -1) {
      const len = y - curStart;
      if (len > bestLen) { bestLen = len; bestStart = curStart; bestEnd = y; }
      curStart = -1;
    }
  }
  if (curStart !== -1) {
    const len = yEnd - curStart;
    if (len > bestLen) { bestLen = len; bestStart = curStart; bestEnd = yEnd; }
  }

  if (bestLen < mH * 0.20) return [];

  // Build contour, drop rows with jumps > 8% of image width
  const maxJump = mW * 0.08;
  const contour: ContourPoint[] = [];
  let prevX: number | null = null;
  for (let y = bestStart; y < bestEnd; y++) {
    const x = smoothed[y];
    if (x === null) continue;
    if (prevX !== null && Math.abs(x - prevX) > maxJump) continue;
    contour.push({ x, y });
    prevX = x;
  }
  return contour;
}

/**
 * Extract face-side contour points from a SAM binary mask.
 * Returned points are ordered top → bottom and can be sent to backend AI locator.
 */
export function extractProfileContourFromMask(
  mask: Uint8Array,
  maskW: number,
  maskH: number,
  side: 'left' | 'right',
): ContourPoint[] {
  return extractContourFromMask(mask, maskW, maskH, side);
}

/**
 * Detect profile landmarks from a SAM binary mask.
 * Primary entry point when MobileSAM is available.
 *
 * @param mask    Binary mask (1=face, 0=background) at original image dimensions
 * @param maskW   Mask width (== canvas.width)
 * @param maskH   Mask height (== canvas.height)
 * @param side    Profile orientation
 * @returns ProfileContourResult or null if detection failed
 */
export function detectProfileContourFromMask(
  mask: Uint8Array,
  maskW: number,
  maskH: number,
  side: 'left' | 'right',
): ProfileContourResult | null {
  if (maskW < 50 || maskH < 50) return null;

  // Count mask pixels to verify SAM produced a meaningful segmentation
  let maskCount = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) maskCount++;
  const maskFrac = maskCount / (maskW * maskH);
  if (maskFrac < 0.04 || maskFrac > 0.96) {
    console.warn(`[SAMContour] Mask coverage ${(maskFrac * 100).toFixed(1)}% — invalid segmentation`);
    return null;
  }

  console.log(`[SAMContour] ${maskW}x${maskH} mask=${(maskFrac * 100).toFixed(1)}%`);

  // Extract profile contour from mask boundary
  const contour = extractContourFromMask(mask, maskW, maskH, side);
  console.log(`[SAMContour] contour=${contour.length} pts`);
  if (contour.length < 30) {
    console.warn('[SAMContour] Contour too short, aborting');
    return null;
  }

  // Run cephalometric landmark detection on the clean contour
  const cephLandmarks = findCephalometricLandmarks(contour, maskW, maskH, side);
  if (cephLandmarks.length < 5) {
    console.warn(`[SAMContour] Only ${cephLandmarks.length} landmarks found, aborting`);
    return null;
  }

  if (!validateGeometry(cephLandmarks, maskW, side)) {
    console.warn('[SAMContour] Geometry validation failed');
    return null;
  }

  const landmarks = buildSparse478(cephLandmarks, contour, maskW, maskH, side);

  const avgConf = cephLandmarks.reduce((s, l) => s + l.confidence, 0) / cephLandmarks.length;
  const strongCount = cephLandmarks.filter((l) => l.confidence > 0.40).length;
  const completeness = cephLandmarks.length / 7;
  const strengthPenalty = strongCount >= 3 ? 1 : strongCount / 3;
  // SAM mask is cleaner → give slight confidence boost vs Canny
  const confidence = Math.min(1, avgConf * completeness * strengthPenalty * 1.25);

  const landmarkDetails: Record<string, { point: NormalizedLandmark; confidence: number }> = {};
  for (const lm of cephLandmarks) {
    landmarkDetails[lm.name] = {
      point: { x: lm.point.x / maskW, y: lm.point.y / maskH, z: 0 },
      confidence: lm.confidence,
    };
  }

  console.log(
    `[SAMContour] done conf=${confidence.toFixed(3)} strong=${strongCount}/7`,
    cephLandmarks.map((l) => `${l.name}(c=${l.confidence.toFixed(2)})`).join(' '),
  );

  return { landmarks, confidence, contourPoints: contour, landmarkDetails, source: 'contour' };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Detect profile face contour and extract cephalometric landmarks.
 *
 * @param canvas  The profile photo canvas
 * @param side    'left' = face pointing left in image, 'right' = face pointing right
 * @returns ProfileContourResult with sparse 478-element landmarks, or null if failed
 */
export function detectProfileContour(
  canvas: HTMLCanvasElement,
  side: 'left' | 'right',
): ProfileContourResult | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const w = canvas.width, h = canvas.height;
  if (w < 50 || h < 50) return null;

  const imageData = ctx.getImageData(0, 0, w, h);

  // Stage 1
  const gray = toGrayscale(imageData);
  const sigma = Math.max(1.5, Math.min(4, w / 200));
  const blurred = gaussianBlur(gray, w, h, sigma);
  console.log(`[ProfileContour] ${w}x${h} sigma=${sigma.toFixed(1)}`);

  // Stage 2
  const edges = sobelEdge(blurred, w, h);
  const nms = nonMaxSuppression(edges);
  const edgeMap = hysteresisThreshold(nms, w, h);

  let edgeCount = 0;
  for (let i = 0; i < edgeMap.length; i++) if (edgeMap[i]) edgeCount++;
  if (edgeCount < 100) {
    console.warn('[ProfileContour] Too few edges, aborting');
    return null;
  }

  // Stage 3
  const contour = extractSilhouetteContour(edgeMap, w, h, side);
  console.log(`[ProfileContour] contour=${contour.length} pts, edges=${edgeCount}`);
  if (contour.length < 30) {
    console.warn('[ProfileContour] Contour too short, aborting');
    return null;
  }

  // Stage 4
  const cephLandmarks = findCephalometricLandmarks(contour, w, h, side);
  if (cephLandmarks.length < 5) {
    console.warn(`[ProfileContour] Only ${cephLandmarks.length} landmarks found, aborting`);
    return null;
  }

  // Geometry validation (P1: threshold guard)
  if (!validateGeometry(cephLandmarks, w, side)) {
    console.warn('[ProfileContour] Geometry validation failed (nose on wrong side or anatomy violated)');
    return null;
  }

  const landmarks = buildSparse478(cephLandmarks, contour, w, h, side);

  // Confidence: requires majority of landmarks to be individually strong
  const avgConf = cephLandmarks.reduce((s, l) => s + l.confidence, 0) / cephLandmarks.length;
  const strongCount = cephLandmarks.filter((l) => l.confidence > 0.40).length;
  const completeness = cephLandmarks.length / 7;
  // Require at least 3 strong landmarks; penalize if fewer
  const strengthPenalty = strongCount >= 3 ? 1 : strongCount / 3;
  const confidence = Math.min(1, avgConf * completeness * strengthPenalty * 1.1);

  const landmarkDetails: Record<string, { point: NormalizedLandmark; confidence: number }> = {};
  for (const lm of cephLandmarks) {
    landmarkDetails[lm.name] = {
      point: { x: lm.point.x / w, y: lm.point.y / h, z: 0 },
      confidence: lm.confidence,
    };
  }

  console.log(
    `[ProfileContour] done conf=${confidence.toFixed(3)} strong=${strongCount}/7`,
    cephLandmarks.map((l) => `${l.name}(c=${l.confidence.toFixed(2)})`).join(' '),
  );

  return { landmarks, confidence, contourPoints: contour, landmarkDetails, source: 'contour' };
}
