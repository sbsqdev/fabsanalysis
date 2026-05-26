import OpenAI from 'openai';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const REQUIRED_KEYS = ['g', 'n', 'prn', 'cm', 'sn', 'ls', 'pg'];
const AI_TIMEOUT_MS = 8_000;
const AI_MIN_CONFIDENCE = 0.45;

const SYSTEM_PROMPT_CANDIDATE = `You select cephalometric landmarks from pre-computed candidates on a lateral face contour.

INPUT: For each of 7 landmarks you get a "candidates" array of [index, P_value] pairs and a "type" ("peak" or "valley").

TASK: For each landmark, pick ONE index from its "candidates" array. You MUST pick an index that appears in the candidates list — do NOT invent new indices.

Landmarks (strict order g < n < prn < cm < sn < ls < pg):
  g   (peak)   — forehead bump, pick highest P_value from candidates
  n   (valley) — nose bridge depression, pick lowest P_value from candidates
  prn (peak)   — nose tip, pick highest P_value from candidates
  cm  (valley) — columella point between prn and sn, usually closer to sn
  sn  (valley) — base of nose, pick lowest P_value from candidates
  ls  (peak)   — upper lip (closest lip peak after sn), prefer earlier index over lower-lip peaks
  pg  (peak)   — chin, pick highest P_value from candidates

Rules:
- ONLY pick indices that exist in the "candidates" array for that landmark
- For peaks: highest P_value wins. For valleys: lowest P_value wins.
- Ties within 5%: prefer index closest to "det"
- cm must satisfy: prn < cm < sn, and cm should be in the lower half of (prn..sn), typically close to sn
- ls should be the first stable lip peak after sn (upper lip), not the lower-lip/chin region
- Confidence: 0.85 = clearly best, 0.65 = plausible, 0.40 = uncertain

Return ONLY this JSON (no markdown, no explanation):
{"profiles":[{"side":"<left|right>","overallConfidence":<0-1>,"landmarks":{"g":{"index":<int>,"confidence":<0-1>},"n":{"index":<int>,"confidence":<0-1>},"prn":{"index":<int>,"confidence":<0-1>},"cm":{"index":<int>,"confidence":<0-1>},"sn":{"index":<int>,"confidence":<0-1>},"ls":{"index":<int>,"confidence":<0-1>},"pg":{"index":<int>,"confidence":<0-1>}}}]}`;

function readEnvValueFromFiles(key) {
  const files = [path.resolve(process.cwd(), '.env.local'), path.resolve(process.cwd(), '.env')];
  for (const filePath of files) {
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, 'utf8');
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      if (line.slice(0, eq).trim() !== key) continue;
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      const clean = value.trim();
      if (clean) return clean;
    }
  }
  return undefined;
}

function resolveOpenAIKey() {
  const candidates = [
    process.env.OPENAI_API_KEY,
    process.env.VITE_OPENAI_API_KEY,
    process.env.OPENAI_KEY,
    readEnvValueFromFiles('OPENAI_API_KEY'),
    readEnvValueFromFiles('VITE_OPENAI_API_KEY'),
  ];
  for (const candidate of candidates) {
    const clean = candidate?.trim();
    if (clean) return clean;
  }
  return undefined;
}

function resolveProfileModel() {
  return (
    process.env.OPENAI_PROFILE_MODEL?.trim() ||
    readEnvValueFromFiles('OPENAI_PROFILE_MODEL') ||
    'gpt-4.1-mini'
  );
}

function jsonReply(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk.toString();
      if (data.length > 8 * 1024 * 1024) reject(new Error('Payload too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function stripJsonFences(text) {
  return String(text || '').replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
}

function extractBalancedJsonObject(text) {
  const source = stripJsonFences(text);
  const start = source.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

function parseJsonLoose(text) {
  const candidates = [];
  const stripped = stripJsonFences(text);
  if (stripped) candidates.push(stripped);
  const balanced = extractBalancedJsonObject(stripped);
  if (balanced) candidates.push(balanced);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // next
    }
  }
  return null;
}

function normalizeContourPoints(profile) {
  const tuples = Array.isArray(profile?.contourPointsTopToBottom)
    ? profile.contourPointsTopToBottom
    : [];
  const parsed = [];
  for (const t of tuples) {
    if (!Array.isArray(t) || t.length < 3) continue;
    const idx = Number(t[0]);
    const x = Number(t[1]);
    const y = Number(t[2]);
    if (!Number.isFinite(idx) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    parsed.push({ idx: Math.trunc(idx), x, y });
  }
  parsed.sort((a, b) => a.idx - b.idx);
  const points = parsed.map((p, i) => ({ x: p.x, y: p.y, idx: i }));
  return points;
}

function buildProjectionCurve(contour, width, side) {
  return contour.map((p) => (side === 'left' ? (width - 1 - p.x) : p.x));
}

// Savitzky-Golay smoothing coefficients (cubic, symmetric windows)
// Source: standard SG tables for polynomial order 3
const SG_COEFFS = {
  7:  { c: [-2, 3, 6, 7, 6, 3, -2], norm: 21 },
  9:  { c: [-21, 14, 39, 54, 59, 54, 39, 14, -21], norm: 231 },
  11: { c: [-36, 9, 44, 69, 84, 89, 84, 69, 44, 9, -36], norm: 429 },
  13: { c: [-11, 0, 9, 16, 21, 24, 25, 24, 21, 16, 9, 0, -11], norm: 143 },
  15: { c: [-78, -13, 42, 87, 122, 147, 162, 167, 162, 147, 122, 87, 42, -13, -78], norm: 1105 },
};

function chooseSgWindow(N) {
  const raw = Math.round(N / 45) | 1; // ensure odd
  const clamped = Math.max(7, Math.min(15, raw));
  const options = [7, 9, 11, 13, 15];
  return options.reduce((a, b) => Math.abs(b - clamped) < Math.abs(a - clamped) ? b : a);
}

function savitzkyGolay(signal, windowSize) {
  const entry = SG_COEFFS[windowSize];
  if (!entry) {
    // Fallback: simple MA
    const half = Math.floor(windowSize / 2);
    return signal.map((_, i) => {
      let sum = 0, cnt = 0;
      for (let k = -half; k <= half; k++) {
        const j = Math.max(0, Math.min(signal.length - 1, i + k));
        sum += signal[j]; cnt++;
      }
      return sum / cnt;
    });
  }
  const { c, norm } = entry;
  const half = Math.floor(windowSize / 2);
  const N = signal.length;
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    if (i < half || i >= N - half) {
      // Edge: mirror clamp
      let sum = 0, cnt = 0;
      for (let k = -half; k <= half; k++) {
        sum += signal[Math.max(0, Math.min(N - 1, i + k))];
        cnt++;
      }
      out[i] = sum / cnt;
    } else {
      let val = 0;
      for (let k = 0; k < windowSize; k++) val += c[k] * signal[i - half + k];
      out[i] = val / norm;
    }
  }
  return out;
}

function smooth1D(signal, windowSize) {
  const half = Math.floor(windowSize / 2);
  return signal.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let k = -half; k <= half; k++) {
      const idx = i + k;
      if (idx >= 0 && idx < signal.length) {
        sum += signal[idx];
        count += 1;
      }
    }
    return count > 0 ? sum / count : signal[i];
  });
}

function derivative(signal) {
  return signal.map((_, i) => {
    if (i === 0) return signal[1] - signal[0];
    if (i === signal.length - 1) return signal[i] - signal[i - 1];
    return (signal[i + 1] - signal[i - 1]) / 2;
  });
}

/**
 * Compute face bounding box from the smoothed projection curve.
 * Walks outward from the global max (prn candidate) using a 35% threshold.
 */
function computeFaceBBox(smoothed) {
  const N = smoothed.length;
  let globalMax = -Infinity;
  let globalMaxIdx = 0;
  for (let i = 0; i < N; i++) {
    if (smoothed[i] > globalMax) { globalMax = smoothed[i]; globalMaxIdx = i; }
  }
  // Top: walk upward from nose tip until projection drops below 35%
  let topIdx = globalMaxIdx;
  for (let i = globalMaxIdx - 1; i >= 0; i--) {
    if (smoothed[i] < globalMax * 0.35) break;
    topIdx = i;
  }
  let bottomIdx = globalMaxIdx;
  for (let i = globalMaxIdx + 1; i < N; i++) {
    if (smoothed[i] < globalMax * 0.35) break;
    bottomIdx = i;
  }
  const faceH = bottomIdx - topIdx;
  if (faceH < N * 0.25) {
    const p10 = Math.floor(N * 0.10);
    const p90 = Math.floor(N * 0.90);
    return { topIdx: p10, bottomIdx: p90, faceH: p90 - p10, globalMax, globalMaxIdx };
  }
  return { topIdx, bottomIdx, faceH, globalMax, globalMaxIdx };
}

/**
 * Topographic prominence of a peak/valley within a bounded walk distance.
 */
function computeProminence(smoothed, idx, isPeak) {
  const N = smoothed.length;
  const walkDist = Math.min(50, Math.floor(N * 0.15));
  const val = smoothed[idx];
  let leftExtreme = val;
  for (let j = idx - 1; j >= Math.max(0, idx - walkDist); j--) {
    if (isPeak) {
      leftExtreme = Math.min(leftExtreme, smoothed[j]);
      if (smoothed[j] > val) break;
    } else {
      leftExtreme = Math.max(leftExtreme, smoothed[j]);
      if (smoothed[j] < val) break;
    }
  }
  let rightExtreme = val;
  for (let j = idx + 1; j <= Math.min(N - 1, idx + walkDist); j++) {
    if (isPeak) {
      rightExtreme = Math.min(rightExtreme, smoothed[j]);
      if (smoothed[j] > val) break;
    } else {
      rightExtreme = Math.max(rightExtreme, smoothed[j]);
      if (smoothed[j] < val) break;
    }
  }
  if (isPeak) return val - Math.max(leftExtreme, rightExtreme);
  return Math.min(leftExtreme, rightExtreme) - val;
}

// SG first derivative coefficients: c_k = k, norm = 2·Σ_{k=1}^{m}(k²)
const SG_D1_COEFFS = {
  7:  { c: [-3, -2, -1, 0, 1, 2, 3], norm: 28 },
  9:  { c: [-4, -3, -2, -1, 0, 1, 2, 3, 4], norm: 60 },
  11: { c: [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5], norm: 110 },
  13: { c: [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6], norm: 182 },
  15: { c: [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7], norm: 280 },
};

function savitzkyGolayD1(signal, win) {
  const e = SG_D1_COEFFS[win];
  if (!e) return derivative(signal);
  const { c, norm } = e;
  const half = (win - 1) / 2;
  const N = signal.length;
  const out = new Array(N);
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

// Per-landmark anatomical priors (y_norm relative to face bbox)
const LM_IS_PEAK   = { g: true,  n: false, prn: true,  sn: false, ls: true,  li: false, pg: true  };
// LM_YN_CENTER / LM_YN_HALF: expected yNorm position (0=forehead, 1=chin) and tolerance half-width.
// n prior corrected from 0.165→0.285 based on real detections (nasion sits at ~27-29% of faceH,
// not 16.5% — the old value was mis-calibrated and penalised the correct anatomical position).
const LM_YN_CENTER = { g: 0.190, n: 0.285, prn: 0.465, sn: 0.585, ls: 0.700, li: 0.790, pg: 0.900 };
const LM_YN_HALF   = { g: 0.100, n: 0.120, prn: 0.115, sn: 0.070, ls: 0.060, li: 0.050, pg: 0.095 };

// Pairwise anatomical gap references (y_norm ratios, Farkas 1994 / Powell 1984)
// [idxA, idxB, refGap, tolerance, lambda] — scrArr indices: g=0 n=1 prn=2 cm=3 sn=4 ls=5 pg=6
const GAP_REFS = [
  [0, 1, 0.035, 0.040, 0.25], // g→n
  [1, 2, 0.300, 0.080, 0.20], // n→prn
  [2, 4, 0.095, 0.025, 0.80], // prn→sn: tight cluster in nose area
  [4, 5, 0.110, 0.035, 0.70], // sn→ls: upper lip must remain near subnasale
  [5, 6, 0.170, 0.050, 0.35], // ls→pg
];

// Hard anatomical constraint: pg cannot be more than this fraction of faceH below ls.
// Typical ls→pg span is ~15% faceH; 22% gives margin for variation without neck drift.
const PG_MAX_GAP_RATIO = 0.22;
const SN_MIN_GAP_RATIO = 0.06;
const SN_MAX_GAP_RATIO = 0.14;
const LS_MIN_GAP_RATIO = 0.03;
const LS_MAX_GAP_RATIO = 0.13;
const LS_HARD_MAX_GAP_RATIO = 0.145;
const PG_MIN_GAP_RATIO = 0.08;

/**
 * Apply quadratic pairwise gap penalties to scrArr in-place.
 * Penalty = lambda * max(0, |gap_obs/faceH - gap_ref| - tol)^2
 * Applied to the weaker-scoring landmark in each pair.
 */
function applyGapPenalties(idxArr, scrArr, faceH) {
  if (faceH <= 0) return;
  for (const [a, b, ref, tol, lambda] of GAP_REFS) {
    const gapObs = (idxArr[b] - idxArr[a]) / faceH;
    const excess = Math.max(0, Math.abs(gapObs - ref) - tol);
    if (excess === 0) continue;
    const penalty = lambda * excess * excess;
    // Penalise the weaker landmark (more likely to be wrongly placed)
    if (scrArr[a] <= scrArr[b]) {
      scrArr[a] = clamp01(scrArr[a] - penalty);
    } else {
      scrArr[b] = clamp01(scrArr[b] - penalty);
    }
  }
}

function computeKappa(Pd1, Pd2) {
  const N = Math.min(Pd1.length, Pd2.length);
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    const p1 = Pd1[i] ?? 0;
    const p2 = Pd2[i] ?? 0;
    const denom = Math.max(1e-6, Math.pow(1 + p1 * p1, 1.5));
    out[i] = p2 / denom;
  }
  return out;
}

function getZoneBounds(N, zoneS, zoneE) {
  const start = Math.max(0, Math.min(N - 1, zoneS));
  const end   = Math.max(0, Math.min(N - 1, zoneE));
  return { start, end };
}

function isLocalExtremum(smoothed, i, isPeak) {
  if (i <= 0 || i >= smoothed.length - 1) return false;
  if (isPeak) return smoothed[i] >= smoothed[i - 1] && smoothed[i] >= smoothed[i + 1];
  return smoothed[i] <= smoothed[i - 1] && smoothed[i] <= smoothed[i + 1];
}

function getZoneStats(smoothed, promArr, kappa, start, end) {
  let zMin = Infinity;
  let zMax = -Infinity;
  let promMax = 0;
  let kappaAbsMax = 0;
  for (let i = start; i <= end; i++) {
    if (smoothed[i] < zMin) zMin = smoothed[i];
    if (smoothed[i] > zMax) zMax = smoothed[i];
    if (promArr[i] > promMax) promMax = promArr[i];
    const ka = Math.abs(kappa[i] ?? 0);
    if (ka > kappaAbsMax) kappaAbsMax = ka;
  }
  return {
    zMin,
    zRange: (zMax - zMin) || 1,
    promMax,
    kappaAbsMax,
  };
}

/**
 * Feature-based score for contour index i as landmark lm.
 * Zone-local normalization; features: P-value, prominence, κ sign+magnitude, deriv, y_norm prior.
 */
function scorePoint(i, smoothed, Pd1, kappa, yNorm, promPeak, promValley, zMin, zRange, promMax, kappaAbsMax, lm) {
  const isPeak = LM_IS_PEAK[lm];
  const Ps_norm  = (smoothed[i] - zMin) / zRange;
  const promArr  = isPeak ? promPeak : promValley;
  const prom_norm = promMax > 0 ? clamp01(promArr[i] / promMax) : 0;
  const kappaVal = kappa[i] ?? 0;
  const kappaSign = isPeak ? (kappaVal < 0 ? 1.0 : 0.1) : (kappaVal > 0 ? 1.0 : 0.1);
  const kappaMagNorm = kappaAbsMax > 0 ? clamp01(Math.abs(kappaVal) / kappaAbsMax) : 0;
  const N = smoothed.length;
  let derivOk = 0.5;
  if (i > 0 && i < N - 1) {
    if (isPeak  && Pd1[i - 1] > 0 && Pd1[i + 1] < 0) derivOk = 1.0;
    else if (!isPeak && Pd1[i - 1] < 0 && Pd1[i + 1] > 0) derivOk = 1.0;
    else derivOk = 0.2;
  }
  const yn = yNorm[i] ?? 0.5;
  const yScore = clamp01(1 - Math.abs(yn - LM_YN_CENTER[lm]) / (LM_YN_HALF[lm] || 0.1));

  switch (lm) {
    case 'prn': return clamp01(0.40 * Ps_norm + 0.20 * prom_norm + 0.12 * kappaSign + 0.08 * kappaMagNorm + 0.10 * derivOk + 0.10 * yScore);
    case 'n':   return clamp01(0.25 * (1 - Ps_norm) + 0.25 * prom_norm + 0.15 * kappaSign + 0.10 * kappaMagNorm + 0.15 * derivOk + 0.10 * yScore);
    case 'sn':  return clamp01(0.25 * (1 - Ps_norm) + 0.25 * prom_norm + 0.15 * kappaSign + 0.10 * kappaMagNorm + 0.15 * derivOk + 0.10 * yScore);
    case 'g':   return clamp01(0.30 * Ps_norm + 0.25 * prom_norm + 0.12 * kappaSign + 0.08 * kappaMagNorm + 0.15 * derivOk + 0.10 * yScore);
    case 'ls':  return clamp01(0.30 * Ps_norm + 0.25 * prom_norm + 0.12 * kappaSign + 0.08 * kappaMagNorm + 0.15 * derivOk + 0.10 * yScore);
    case 'pg':  return clamp01(0.35 * Ps_norm + 0.25 * prom_norm + 0.12 * kappaSign + 0.08 * kappaMagNorm + 0.10 * derivOk + 0.10 * yScore);
    case 'li':  return clamp01(0.25 * (1 - Ps_norm) + 0.25 * prom_norm + 0.15 * kappaSign + 0.10 * kappaMagNorm + 0.15 * derivOk + 0.10 * yScore);
    default:    return 0;
  }
}

function collectZoneCandidates(smoothed, kappa, promPeak, promValley, zoneS, zoneE, lm, topK = 5) {
  const N = smoothed.length;
  const { start, end } = getZoneBounds(N, zoneS, zoneE);
  if (end <= start) return [];

  const isPeak = LM_IS_PEAK[lm];
  const promArr = isPeak ? promPeak : promValley;
  const { promMax, kappaAbsMax } = getZoneStats(smoothed, promArr, kappa, start, end);
  const minProm = promMax * 0.10;
  const zoneLen = end - start + 1;
  const minSeparation = Math.max(2, Math.round(zoneLen * 0.06));

  const raw = [];
  for (let i = start + 1; i <= end - 1; i++) {
    if (!isLocalExtremum(smoothed, i, isPeak)) continue;
    const prom = promArr[i] ?? 0;
    if (prom < minProm) continue;
    const kappaVal = kappa[i] ?? 0;
    const kappaSignOk = isPeak ? (kappaVal < 0) : (kappaVal > 0);
    const promNorm = promMax > 0 ? clamp01(prom / promMax) : 0;
    const kappaMagNorm = kappaAbsMax > 0 ? clamp01(Math.abs(kappaVal) / kappaAbsMax) : 0;
    const preScore = 0.55 * promNorm + 0.30 * (kappaSignOk ? 1.0 : 0.1) + 0.15 * kappaMagNorm;
    raw.push({ idx: i, preScore });
  }
  raw.sort((a, b) => b.preScore - a.preScore);

  const selected = [];
  for (const cand of raw) {
    let tooClose = false;
    for (const kept of selected) {
      if (Math.abs(cand.idx - kept.idx) < minSeparation) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    selected.push(cand);
    if (selected.length >= topK) break;
  }
  return selected.map((c) => c.idx);
}

/** Legacy full-zone selector (fallback only) */
function bestInZoneLegacy(smoothed, Pd1, kappa, yNorm, promPeak, promValley, zoneS, zoneE, lm) {
  const N = smoothed.length;
  const { start, end } = getZoneBounds(N, zoneS, zoneE);
  if (end <= start) return { idx: Math.round((start + end) / 2), score: 0.3, margin: 0, method: 'fallback', candidateCount: 0 };

  const isPeak = LM_IS_PEAK[lm];
  const promArr = isPeak ? promPeak : promValley;
  const { zMin, zRange, promMax, kappaAbsMax } = getZoneStats(smoothed, promArr, kappa, start, end);

  let bestIdx = start, bestScore = -Infinity, secondScore = -Infinity;
  for (let i = start; i <= end; i++) {
    const s = scorePoint(i, smoothed, Pd1, kappa, yNorm, promPeak, promValley, zMin, zRange, promMax, kappaAbsMax, lm);
    if (s > bestScore) { secondScore = bestScore; bestScore = s; bestIdx = i; }
    else if (s > secondScore) { secondScore = s; }
  }
  const margin = clamp01(bestScore - Math.max(0, secondScore));
  return { idx: bestIdx, score: Math.max(0, bestScore), margin, method: 'fallback', candidateCount: 0 };
}

/** Candidate-based selector with legacy fallback */
function bestInZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, zoneS, zoneE, lm) {
  const candidates = collectZoneCandidates(smoothed, kappa, promPeak, promValley, zoneS, zoneE, lm, 5);
  if (candidates.length < 2) {
    const fallback = bestInZoneLegacy(smoothed, Pd1, kappa, yNorm, promPeak, promValley, zoneS, zoneE, lm);
    return { ...fallback, candidateCount: candidates.length };
  }

  const N = smoothed.length;
  const { start, end } = getZoneBounds(N, zoneS, zoneE);
  const isPeak = LM_IS_PEAK[lm];
  const promArr = isPeak ? promPeak : promValley;
  const { zMin, zRange, promMax, kappaAbsMax } = getZoneStats(smoothed, promArr, kappa, start, end);

  let bestIdx = candidates[0], bestScore = -Infinity, secondScore = -Infinity;
  for (const i of candidates) {
    const s = scorePoint(i, smoothed, Pd1, kappa, yNorm, promPeak, promValley, zMin, zRange, promMax, kappaAbsMax, lm);
    if (s > bestScore) { secondScore = bestScore; bestScore = s; bestIdx = i; }
    else if (s > secondScore) { secondScore = s; }
  }
  const margin = clamp01(bestScore - Math.max(0, secondScore));
  return { idx: bestIdx, score: Math.max(0, bestScore), margin, method: 'candidate', candidateCount: candidates.length };
}

/**
 * Anatomical transition selector for sequential landmarks:
 * - sn: first strong valley after prn
 * - ls: first strong peak after sn
 * - pg: strongest peak in lower-face zone
 */
function bestInTransitionZone(
  smoothed,
  Pd1,
  kappa,
  yNorm,
  promPeak,
  promValley,
  zoneS,
  zoneE,
  lm,
  prefer = 'earliest', // 'earliest' | 'strongest'
) {
  const N = smoothed.length;
  const { start, end } = getZoneBounds(N, zoneS, zoneE);
  if (end <= start) {
    return bestInZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, zoneS, zoneE, lm);
  }

  const candidates = collectZoneCandidates(smoothed, kappa, promPeak, promValley, start, end, lm, 8);
  if (candidates.length < 2) {
    return bestInZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, start, end, lm);
  }

  const isPeak = LM_IS_PEAK[lm];
  const promArr = isPeak ? promPeak : promValley;
  const { zMin, zRange, promMax, kappaAbsMax } = getZoneStats(smoothed, promArr, kappa, start, end);
  const scored = candidates.map((idx) => ({
    idx,
    score: scorePoint(idx, smoothed, Pd1, kappa, yNorm, promPeak, promValley, zMin, zRange, promMax, kappaAbsMax, lm),
  }));

  const byScore = [...scored].sort((a, b) => b.score - a.score);
  const bestScore = byScore[0]?.score ?? 0;
  const secondScore = byScore[1]?.score ?? 0;
  const margin = clamp01(bestScore - secondScore);

  let pick = byScore[0];
  if (prefer === 'earliest') {
    const floor = Math.max(0.35, bestScore * 0.82);
    const flow = scored
      .filter((c) => c.score >= floor)
      .sort((a, b) => a.idx - b.idx);
    if (flow.length > 0) pick = flow[0];
  }

  if (!pick) {
    return bestInZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, start, end, lm);
  }
  return {
    idx: pick.idx,
    score: Math.max(0, pick.score),
    margin,
    method: 'transition',
    candidateCount: candidates.length,
  };
}

function inferColumellaIndex(prnIdx, snIdx, smoothed, kappa, promValley) {
  const span = snIdx - prnIdx;
  if (span < 3) {
    return { idx: Math.max(prnIdx + 1, Math.min(snIdx - 1, prnIdx + 1)), score: 0.28, source: 'fallback', candidateCount: 0 };
  }

  const innerPad = Math.max(1, Math.round(span * 0.12));
  const s = Math.max(prnIdx + 1, prnIdx + innerPad);
  const e = Math.min(snIdx - 1, snIdx - innerPad);

  let segMin = Infinity;
  let segMax = -Infinity;
  let kappaAbsMax = 0;
  for (let i = s; i <= e; i++) {
    segMin = Math.min(segMin, smoothed[i]);
    segMax = Math.max(segMax, smoothed[i]);
    const ka = Math.abs(kappa[i] ?? 0);
    if (ka > kappaAbsMax) kappaAbsMax = ka;
  }

  const segRange = (segMax - segMin) || 1;
  const minProm = segRange * 0.10;
  const zoneLen = e - s + 1;
  const minSeparation = Math.max(2, Math.round(zoneLen * 0.06));

  const raw = [];
  for (let i = s + 1; i <= e - 1; i++) {
    if (!isLocalExtremum(smoothed, i, false)) continue;
    const prom = promValley[i] ?? 0;
    if (prom < minProm) continue;
    const kappaVal = kappa[i] ?? 0;
    const kappaSignOk = kappaVal > 0;
    const promNorm = clamp01(prom / segRange);
    const kappaMagNorm = kappaAbsMax > 0 ? clamp01(Math.abs(kappaVal) / kappaAbsMax) : 0;
    const quality = 0.55 * promNorm + 0.30 * (kappaSignOk ? 1.0 : 0.1) + 0.15 * kappaMagNorm;
    raw.push({ idx: i, prom, quality, kappaSignOk });
  }
  raw.sort((a, b) => b.quality - a.quality);

  const selected = [];
  for (const cand of raw) {
    let tooClose = false;
    for (const kept of selected) {
      if (Math.abs(cand.idx - kept.idx) < minSeparation) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    selected.push(cand);
    if (selected.length >= 5) break;
  }

  const bestCandidate = selected.length > 0 ? selected[0] : null;
  const valleyStrong = !!(bestCandidate && bestCandidate.prom >= minProm && bestCandidate.kappaSignOk);

  // Columella sits in the short segment just above subnasale; keep it in the lower part of prn..sn.
  const fallbackIdx = prnIdx + Math.round(span * 0.72);
  const minAllowed = prnIdx + Math.round(span * 0.52);
  const maxAllowed = prnIdx + Math.round(span * 0.92);
  let idx = valleyStrong ? bestCandidate.idx : fallbackIdx;
  idx = Math.max(prnIdx + 1, Math.min(snIdx - 1, Math.max(minAllowed, Math.min(idx, maxAllowed))));

  if (valleyStrong) {
    const score = clamp01(0.45 + 0.40 * bestCandidate.quality);
    return { idx, score, source: 'candidate', candidateCount: selected.length };
  }

  const center = prnIdx + Math.round(span * 0.72);
  const rel = Math.abs(idx - center) / Math.max(2, span * 0.22);
  const anatomicalScore = 1 - clamp01(rel);
  const score = clamp01(0.45 * (0.65 + 0.35 * anatomicalScore));
  return { idx, score, source: 'fallback', candidateCount: selected.length };
}

function inferLabialeInferiusIndex(lsIdx, pgIdx, smoothed, Pd1, kappa, yNorm, promPeak, promValley, faceH) {
  const liMinGap = Math.max(2, Math.round(faceH * 0.03));
  const liMaxGap = Math.max(liMinGap + 2, Math.round(faceH * 0.14));
  const liZS = lsIdx + liMinGap;
  const liZE = Math.min(pgIdx - liMinGap, lsIdx + liMaxGap);

  if (liZE <= liZS + 2) {
    const idx = Math.max(lsIdx + 1, Math.min(pgIdx - 1, lsIdx + Math.round((pgIdx - lsIdx) * 0.40)));
    return { idx, score: 0.34, margin: 0, method: 'fallback', candidateCount: 0 };
  }

  const liR = bestInZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, liZS, liZE, 'li');
  const maxAllowed = lsIdx + Math.round((pgIdx - lsIdx) * 0.70);
  const idx = Math.max(lsIdx + 1, Math.min(pgIdx - 1, Math.min(liR.idx, maxAllowed)));
  const rel = Math.abs(idx - (lsIdx + Math.round((pgIdx - lsIdx) * 0.42))) / Math.max(2, (pgIdx - lsIdx) * 0.32);
  const anatomicalBoost = 1 - clamp01(rel);
  const score = clamp01(liR.score * 0.75 + anatomicalBoost * 0.25 - (liR.method === 'fallback' ? 0.08 : 0));
  return { idx, score, margin: liR.margin ?? 0, method: liR.method, candidateCount: liR.candidateCount ?? 0 };
}

function inferLabialeSuperiusIndex(snIdx, smoothed, Pd1, kappa, yNorm, promPeak, promValley, faceH, yn2i) {
  const N = smoothed.length;
  const lsMinGap = Math.max(1, Math.round(faceH * LS_MIN_GAP_RATIO));
  const lsMaxGap = Math.max(lsMinGap + 2, Math.round(faceH * LS_MAX_GAP_RATIO));
  let lsZS = Math.max(snIdx + lsMinGap, yn2i(0.60));
  let lsZE = Math.min(yn2i(0.76), snIdx + lsMaxGap);
  if (lsZE <= lsZS) {
    lsZS = Math.max(snIdx + 1, yn2i(0.58));
    lsZE = Math.min(yn2i(0.78), snIdx + Math.max(4, Math.round(faceH * 0.16)));
  }

  const pickEarliestStrongLs = (zoneS, zoneE) => {
    const { start, end } = getZoneBounds(N, zoneS, zoneE);
    if (end <= start) return null;
    const candidates = collectZoneCandidates(smoothed, kappa, promPeak, promValley, start, end, 'ls', 8);
    if (candidates.length === 0) return null;
    const { zMin, zRange, promMax, kappaAbsMax } = getZoneStats(smoothed, promPeak, kappa, start, end);
    const scored = candidates.map((idx) => ({
      idx,
      score: scorePoint(idx, smoothed, Pd1, kappa, yNorm, promPeak, promValley, zMin, zRange, promMax, kappaAbsMax, 'ls'),
    }));
    if (scored.length === 0) return null;
    const byScore = [...scored].sort((a, b) => b.score - a.score);
    const bestScore = byScore[0]?.score ?? 0;
    const secondScore = byScore[1]?.score ?? 0;
    const floor = Math.max(0.28, bestScore * 0.62);
    const earliestStrong = scored
      .filter((c) => c.score >= floor)
      .sort((a, b) => a.idx - b.idx)[0];
    const pick = earliestStrong ?? scored.sort((a, b) => a.idx - b.idx)[0];
    return {
      idx: pick.idx,
      score: pick.score,
      margin: clamp01(bestScore - secondScore),
      method: 'ls_earliest_strong',
      candidateCount: scored.length,
    };
  };

  let lsR = pickEarliestStrongLs(lsZS, lsZE)
    ?? bestInTransitionZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, lsZS, lsZE, 'ls', 'earliest');
  let lsIdx = lsR.idx;
  let lsScore = lsR.score;
  let lsMargin = lsR.margin ?? 0;
  let lsMethod = lsR.method;
  let lsCandidateCount = lsR.candidateCount ?? 0;

  // Hard anatomical cap: ls (labrale superius) must stay close to sn, otherwise
  // lower-lip peaks may be mistaken as ls on smooth/low-contrast contours.
  const lsHardMax = Math.min(N - 1, snIdx + Math.max(3, Math.round(faceH * LS_HARD_MAX_GAP_RATIO)));
  if (lsIdx > lsHardMax) {
    const nearZS = Math.max(snIdx + 1, yn2i(0.58));
    const nearZE = Math.min(lsHardMax, yn2i(0.78));
    if (nearZE > nearZS) {
      const nearR = pickEarliestStrongLs(nearZS, nearZE)
        ?? bestInTransitionZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, nearZS, nearZE, 'ls', 'earliest');
      lsIdx = Math.min(nearR.idx, lsHardMax);
      lsScore = nearR.score;
      lsMargin = nearR.margin ?? lsMargin;
      lsMethod = `refined_${nearR.method}`;
      lsCandidateCount = nearR.candidateCount ?? lsCandidateCount;
    } else {
      lsIdx = lsHardMax;
      lsScore = Math.max(0.25, lsScore * 0.75);
      lsMargin = Math.min(lsMargin, 0.08);
      lsMethod = 'refined_fallback';
    }
  }

  return { idx: lsIdx, score: lsScore, margin: lsMargin, method: lsMethod, candidateCount: lsCandidateCount };
}

// ─── DP joint scoring ────────────────────────────────────────────────────────
// DP order: g(0) → n(1) → prn(2) → sn(3) → ls(4) → pg(5)  [cm and li are separate]
// DP_SLOTS maps DP position → slot index in GAP_REFS arrays
const DP_LM_ORDER = ['g', 'n', 'prn', 'sn', 'ls', 'pg'];
const DP_SLOTS    = [0, 1, 2, 4, 5, 6]; // skip cm slot(3) which is inferred separately

/**
 * Pairwise score for transition from prevIdx to curIdx.
 * Returns -Infinity on hard ordering violation, otherwise a negative penalty.
 */
function computePairScore(prevIdx, curIdx, prevSlot, curSlot, faceH) {
  if (curIdx <= prevIdx) return -Infinity; // hard ordering constraint
  if (faceH <= 0) return 0;
  const ref = GAP_REFS.find(([a, b]) => a === prevSlot && b === curSlot);
  if (!ref) return 0;
  const [,, gapRef, tol, lambda] = ref;
  const gapObs = (curIdx - prevIdx) / faceH;
  const excess = Math.max(0, Math.abs(gapObs - gapRef) - tol);
  return -(lambda * excess * excess);
}

/**
 * Collect top-K candidates (scored locally) for each of the 6 DP landmarks.
 * Zones are absolute (no inter-landmark dependency) — DP pair scores handle ordering.
 * Returns array of 6 arrays, each: [{ idx, localScore }]
 */
function collectAllCandidates(smoothed, Pd1, kappa, yNorm, promPeak, promValley, faceH, yn2i, globalMax, N) {
  const TOP_K = 3;
  // DP zones must not heavily overlap between adjacent landmarks in the chain (g<n<prn<sn<ls<pg).
  // g and n in particular need separate zones — g is the forehead peak (upper face),
  // n is the nasion valley (slightly lower). sn/ls boundary also separated.
  const zones = {
    g:   [yn2i(0.04), yn2i(0.22)],   // forehead/glabella — upper face
    n:   [yn2i(0.14), yn2i(0.38)],   // nasion — real position ~27-33% faceH, extended zone
    prn: [yn2i(0.35), yn2i(0.58)],
    sn:  [yn2i(0.50), yn2i(0.62)],   // prn/cm/sn cluster in nose area
    ls:  [yn2i(0.64), yn2i(0.82)],   // keep ls in upper-lip zone (not lower lip/chin)
    pg:  [yn2i(0.82), Math.min(N - 1, yn2i(0.80) + Math.round(faceH * PG_MAX_GAP_RATIO))],
  };

  return DP_LM_ORDER.map((lm) => {
    const [zS, zE] = zones[lm];
    let candIndices = collectZoneCandidates(smoothed, kappa, promPeak, promValley, zS, zE, lm, TOP_K);

    // prn: include globalMax index as extra candidate if best zone candidate is weak
    if (lm === 'prn') {
      const bestP = candIndices.length > 0 ? Math.max(...candIndices.map(i => smoothed[i])) : 0;
      if (bestP < globalMax * 0.60) {
        let gmIdx = 0;
        for (let i = 1; i < N; i++) if (smoothed[i] > smoothed[gmIdx]) gmIdx = i;
        if (!candIndices.includes(gmIdx)) candIndices = [...candIndices, gmIdx];
      }
    }

    // Ensure at least 1 candidate
    if (candIndices.length === 0) {
      const fb = bestInZoneLegacy(smoothed, Pd1, kappa, yNorm, promPeak, promValley, zS, zE, lm);
      candIndices = [fb.idx];
    }
    // Ensure at least 2 candidates for meaningful margin computation in dpJointSelect.
    // If only 1 candidate found, add the legacy full-scan best as a second option.
    if (candIndices.length < 2) {
      const fb = bestInZoneLegacy(smoothed, Pd1, kappa, yNorm, promPeak, promValley, zS, zE, lm);
      if (!candIndices.includes(fb.idx)) candIndices = [...candIndices, fb.idx];
    }

    // Score each candidate locally within the zone
    const isPeak = LM_IS_PEAK[lm];
    const promArr = isPeak ? promPeak : promValley;
    const { start, end } = getZoneBounds(N, zS, zE);
    const { zMin, zRange, promMax, kappaAbsMax } = getZoneStats(smoothed, promArr, kappa, start, end);

    return candIndices.map((idx) => ({
      idx,
      localScore: scorePoint(idx, smoothed, Pd1, kappa, yNorm, promPeak, promValley, zMin, zRange, promMax, kappaAbsMax, lm),
    }));
  });
}

/**
 * Dynamic programming sweep over the 6 DP landmarks.
 * Returns { idxArr, scrArr, marginArr, fallbackArr } or null on failure.
 */
function dpJointSelect(allCandidates, faceH) {
  const L = allCandidates.length; // 6

  // dp[s][j] = best total score reaching candidate j at stage s
  // par[s][j] = index of best predecessor candidate at stage s-1
  const dp  = Array.from({ length: L }, () => []);
  const par = Array.from({ length: L }, () => []);

  // Stage 0: no predecessor
  for (let j = 0; j < allCandidates[0].length; j++) {
    dp[0][j]  = allCandidates[0][j].localScore;
    par[0][j] = -1;
  }

  // Stages 1..5
  for (let s = 1; s < L; s++) {
    const prevSlot = DP_SLOTS[s - 1];
    const curSlot  = DP_SLOTS[s];
    for (let j = 0; j < allCandidates[s].length; j++) {
      const cur = allCandidates[s][j];
      let bestPrev = -Infinity, bestPrevIdx = -1;
      for (let i = 0; i < allCandidates[s - 1].length; i++) {
        const prev  = allCandidates[s - 1][i];
        const pair  = computePairScore(prev.idx, cur.idx, prevSlot, curSlot, faceH);
        if (pair === -Infinity) continue; // ordering violation — skip
        const total = dp[s - 1][i] + cur.localScore + pair;
        if (total > bestPrev) { bestPrev = total; bestPrevIdx = i; }
      }
      dp[s][j]  = bestPrev;
      par[s][j] = bestPrevIdx;
    }
  }

  // Find best at final stage
  let bestFinal = -Infinity, bestFinalJ = -1;
  for (let j = 0; j < dp[L - 1].length; j++) {
    if (dp[L - 1][j] > bestFinal) { bestFinal = dp[L - 1][j]; bestFinalJ = j; }
  }
  if (bestFinalJ === -1 || bestFinal === -Infinity) return null; // no valid path

  // Backtrack
  const chosen = new Array(L);
  chosen[L - 1] = bestFinalJ;
  for (let s = L - 2; s >= 0; s--) {
    chosen[s] = par[s + 1][chosen[s + 1]];
    if (chosen[s] === -1) return null; // broken path
  }

  const idxArr  = chosen.map((ci, s) => allCandidates[s][ci].idx);
  const scrArr  = chosen.map((ci, s) => allCandidates[s][ci].localScore);

  // Per-landmark margin: gap between best and second-best LOCAL scores (not dp totals)
  // dp totals accumulate pair penalties which distort per-stage margin interpretation.
  // fallbackArr is all false in DP path — DP already optimises globally, no per-landmark penalty.
  const marginArr   = new Array(L).fill(0);
  const fallbackArr = new Array(L).fill(false);
  for (let s = 0; s < L; s++) {
    const localScores = allCandidates[s].map(c => c.localScore).sort((a, b) => b - a);
    marginArr[s] = localScores.length >= 2 ? clamp01(localScores[0] - localScores[1]) : 0;
  }

  return { idxArr, scrArr, marginArr, fallbackArr, totalScore: bestFinal };
}
// ─────────────────────────────────────────────────────────────────────────────

function inferDeterministicFromContour(contour, width, side) {
  if (!Array.isArray(contour) || contour.length < 30) return null;

  const projection = buildProjectionCurve(contour, width, side);
  const N = projection.length;
  const win = chooseSgWindow(N);
  const smoothed = savitzkyGolay(projection, win);
  const Pd1 = savitzkyGolayD1(projection, win);
  const Pd2 = derivative(Pd1);
  const kappa = computeKappa(Pd1, Pd2);

  const { topIdx, bottomIdx, faceH, globalMax } = computeFaceBBox(smoothed);
  const yn2i  = (yn) => Math.max(0, Math.min(N - 1, Math.round(topIdx + yn * faceH)));
  const yNorm = Array.from({ length: N }, (_, i) => (i - topIdx) / (faceH || 1));

  // Precompute topographic prominences (O(N·50))
  const promPeak   = Array.from({ length: N }, (_, i) => computeProminence(smoothed, i, true));
  const promValley = Array.from({ length: N }, (_, i) => computeProminence(smoothed, i, false));

  console.log(`[ProfileContour] SG win=${win} bbox top=${topIdx} bot=${bottomIdx} faceH=${faceH} N=${N}`);

  let idxArr, scrArr, marginArr, fallbackArr, cmR;
  let usedDP = false;

  // ─── Primary path: DP joint scoring ────────────────────────────────────────
  // Skip DP for small contours: zones become too narrow and candidates overlap,
  // causing systematic ordering violations. Sequential handles small N better.
  const DP_MIN_N = 350;
  try {
    if (N < DP_MIN_N) {
      console.log(`[ProfileContour] N=${N} < ${DP_MIN_N}, skipping DP → sequential`);
    }
    const dpCandidates = N >= DP_MIN_N
      ? collectAllCandidates(smoothed, Pd1, kappa, yNorm, promPeak, promValley, faceH, yn2i, globalMax, N)
      : null;
    const dpResult = dpCandidates ? dpJointSelect(dpCandidates, faceH) : null;

    if (!dpResult) {
      if (dpCandidates) console.warn('[ProfileContour] DP returned null — falling back to sequential');
    } else {
      const [gIdx, _dpNIdx, prnIdx, _dpSnIdx, _dpLsIdx, dpPgIdx] = dpResult.idxArr;
      // Re-score n in a targeted zone between gIdx and prnIdx using bestInZone.
      const nReZS = Math.max(gIdx + 1, yn2i(0.12));
      const nReZE = Math.min(prnIdx - 2, yn2i(0.42));
      const nReR = bestInZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, nReZS, nReZE, 'n');
      const nIdx = nReR.idx;
      const nArgScore = nReR.score;
      const nArgMargin = nReR.margin ?? 0;

      // Re-score sn using strict prn-relative anatomical zone.
      const snMinGap = Math.max(2, Math.round(faceH * SN_MIN_GAP_RATIO));
      const snMaxGap = Math.max(snMinGap + 2, Math.round(faceH * SN_MAX_GAP_RATIO));
      let snZS = Math.max(prnIdx + snMinGap, yn2i(0.50));
      let snZE = Math.min(yn2i(0.64), prnIdx + snMaxGap);
      if (snZE <= snZS) {
        snZS = Math.max(prnIdx + 2, yn2i(0.50));
        snZE = Math.min(yn2i(0.64), prnIdx + Math.max(4, Math.round(faceH * 0.16)));
      }
      const snReR = bestInTransitionZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, snZS, snZE, 'sn', 'earliest');
      const snIdx = snReR.idx;

      // Re-score ls using strict upper-lip anatomy (closest stable peak after sn).
      const lsReR = inferLabialeSuperiusIndex(snIdx, smoothed, Pd1, kappa, yNorm, promPeak, promValley, faceH, yn2i);
      const lsIdx = lsReR.idx;

      // Re-score pg with strict minimum distance from ls and max neck-drift cap.
      const pgHardMax = Math.min(N - 1, lsIdx + Math.round(faceH * PG_MAX_GAP_RATIO));
      const pgMinGap = Math.max(2, Math.round(faceH * PG_MIN_GAP_RATIO));
      const pgReZS = Math.max(lsIdx + pgMinGap, yn2i(0.80));
      const pgReZE = Math.min(pgHardMax, yn2i(1.00));
      let pgIdx = dpPgIdx;
      let pgScore = dpResult.scrArr[5];
      let pgMargin = dpResult.marginArr[5];
      let pgFallback = dpResult.fallbackArr[5];
      if (pgReZE > pgReZS) {
        const pgReR = bestInTransitionZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, pgReZS, pgReZE, 'pg', 'strongest');
        pgIdx = pgReR.idx;
        pgScore = pgReR.score;
        pgMargin = pgReR.margin ?? 0;
        pgFallback = pgReR.method === 'fallback';
      } else if (pgIdx > pgHardMax) {
        pgIdx = pgHardMax;
        pgFallback = true;
      }

      cmR = inferColumellaIndex(prnIdx, snIdx, smoothed, kappa, promValley);
      const cmScore = clamp01(Math.min(dpResult.scrArr[2], dpResult.scrArr[3]) * 0.45 + cmR.score * 0.55);

      idxArr    = [gIdx, nIdx, prnIdx, cmR.idx, snIdx, lsIdx, pgIdx];
      scrArr    = [dpResult.scrArr[0] * 0.70, nArgScore, dpResult.scrArr[2], cmScore, snReR.score, lsReR.score, pgScore];
      marginArr = [dpResult.marginArr[0], nArgMargin, dpResult.marginArr[2], 0,
                   snReR.margin ?? 0, lsReR.margin ?? 0, pgMargin];
      fallbackArr = [
        dpResult.fallbackArr[0], false, dpResult.fallbackArr[2],
        cmR.source === 'fallback',
        snReR.method === 'fallback', lsReR.method === 'fallback', pgFallback,
      ];
      usedDP = true;
    }
  } catch (e) {
    console.warn('[ProfileContour] DP failed, using sequential fallback:', e.message);
  }

  // ─── Fallback path: sequential detection ───────────────────────────────────
  if (!usedDP) {
    // Step 1: prn — y_norm [0.35..0.58], fallback to global max
    const prnZS = yn2i(0.35), prnZE = yn2i(0.58);
    let prnR = bestInZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, prnZS, prnZE, 'prn');
    if (smoothed[prnR.idx] < globalMax * 0.60) {
      let gmIdx = 0;
      for (let i = 1; i < N; i++) if (smoothed[i] > smoothed[gmIdx]) gmIdx = i;
      prnR = { idx: gmIdx, score: prnR.score, margin: prnR.margin ?? 0, method: 'fallback', candidateCount: 0 };
    }
    const prnIdx = prnR.idx;

    // Step 2: nasion — bestInZone in y_norm [0.12..0.42], capped at prnIdx-2.
    // Using scorePoint (curvature + prominence + yScore) to find the nasion valley.
    // argmin regressed on faces where the forehead area starts at the zone boundary.
    const nZS = Math.max(0, yn2i(0.12));
    const nZE = Math.min(prnIdx - 2, yn2i(0.42));
    const nR = bestInZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, nZS, nZE, 'n');
    const nIdx = nR.idx;

    // Step 3: glabella — between top of face and nasion
    const gZS = Math.max(0, topIdx);
    const gZE = Math.max(gZS + 2, nIdx - 2);
    const gR = bestInZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, gZS, gZE, 'g');
    const gIdx = gR.idx;

    // Step 4: subnasale — strict prn-relative zone to keep sn near nasal base.
    const snMinGap = Math.max(2, Math.round(faceH * SN_MIN_GAP_RATIO));
    const snMaxGap = Math.max(snMinGap + 2, Math.round(faceH * SN_MAX_GAP_RATIO));
    const snHardMax = Math.min(N - 1, prnIdx + snMaxGap);
    const snZS = Math.max(prnIdx + snMinGap, yn2i(0.50));
    const snZE = Math.min(snHardMax, yn2i(0.64));
    const snR = bestInTransitionZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, snZS, snZE, 'sn', 'earliest');
    const snIdx = snR.idx;

    // Step 5: cm — hybrid: candidate valley in prn..sn with interpolation fallback
    cmR = inferColumellaIndex(prnIdx, snIdx, smoothed, kappa, promValley);
    const cmIdx = cmR.idx;
    const cmScore = clamp01(Math.min(prnR.score, snR.score) * 0.45 + cmR.score * 0.55);

    // Step 6: ls — strict upper-lip detection (prevent lower-lip selection).
    const lsR = inferLabialeSuperiusIndex(snIdx, smoothed, Pd1, kappa, yNorm, promPeak, promValley, faceH, yn2i);
      const lsIdx = lsR.idx;

    // Step 7: pg — lower-face zone, hard cap at ls + PG_MAX_GAP_RATIO*faceH.
    // This prevents pg from drifting into neck when the contour continues past chin.
    const pgHardMax = Math.min(N - 1, lsIdx + Math.round(faceH * PG_MAX_GAP_RATIO));
    const pgMinGap = Math.max(2, Math.round(faceH * PG_MIN_GAP_RATIO));
    const pgZS = Math.max(lsIdx + pgMinGap, yn2i(0.80)), pgZE = Math.min(pgHardMax, yn2i(1.00));
    const pgR = bestInTransitionZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, pgZS, pgZE, 'pg', 'strongest');
    const pgIdx = pgR.idx;

    idxArr    = [gIdx, nIdx, prnIdx, cmIdx, snIdx, lsIdx, pgIdx];
    scrArr    = [gR.score * 0.70, nR.score, prnR.score, cmScore, snR.score, lsR.score, pgR.score];
    marginArr = [gR.margin ?? 0, nR.margin ?? 0, prnR.margin ?? 0, 0, snR.margin ?? 0, lsR.margin ?? 0, pgR.margin ?? 0];
    fallbackArr = [
      gR.method === 'fallback', nR.method === 'fallback', prnR.method === 'fallback',
      cmR.source === 'fallback', snR.method === 'fallback', lsR.method === 'fallback', pgR.method === 'fallback',
    ];

    console.log(`[ProfileContour] seq: g=${gR.method}:${gR.candidateCount} sn=${snR.method}:${snR.candidateCount} ls=${lsR.method}:${lsR.candidateCount} cm=${cmR.source}:${cmR.candidateCount}`);

    // Ordering repair: up to 3 iterations
    const lmKeys  = ['g', 'n', 'prn', null, 'sn', 'ls', 'pg'];
    for (let iter = 0; iter < 3; iter++) {
      let ok = true;
      for (let k = 1; k < idxArr.length; k++) {
        if (idxArr[k] <= idxArr[k - 1]) {
          ok = false;
          if (k === 3) {
            const cmRepair = inferColumellaIndex(idxArr[2], idxArr[4], smoothed, kappa, promValley);
            idxArr[3] = cmRepair.idx;
            scrArr[3] = cmRepair.score;
            fallbackArr[3] = cmRepair.source === 'fallback';
            continue;
          }
          const key = lmKeys[k];
          const repairS = idxArr[k - 1] + 1;
          const repairE = k + 1 < idxArr.length ? idxArr[k + 1] - 1 : N - 1;
          if (key && repairE > repairS) {
            const re = bestInZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, repairS, repairE, key);
            idxArr[k] = re.idx;
            scrArr[k] = re.score;
            marginArr[k] = re.margin ?? 0;
            fallbackArr[k] = re.method === 'fallback';
          }
        }
      }
      if (ok) break;
    }

    // Soft gap penalties — only in sequential path; DP pair scores handle this intrinsically
    applyGapPenalties(idxArr, scrArr, faceH);
  }

  // Step 8: li (labrale inferius) — enforce lower-face chain ls < li < pg
  const liR = inferLabialeInferiusIndex(idxArr[5], idxArr[6], smoothed, Pd1, kappa, yNorm, promPeak, promValley, faceH);
  const liIdx = liR.idx;

  console.log(`[ProfileContour] path=${usedDP ? 'DP' : 'seq'} cm=${cmR.source}:${cmR.candidateCount} li=${liR.method}`);

  // Final strict ordering check — severe violations mean bad contour
  for (let i = 1; i < idxArr.length; i++) {
    if (idxArr[i] <= idxArr[i - 1]) return null;
  }
  if (!(idxArr[5] < liIdx && liIdx < idxArr[6])) return null;

  const indices = { g: idxArr[0], n: idxArr[1], prn: idxArr[2], cm: idxArr[3], sn: idxArr[4], ls: idxArr[5], li: liIdx, pg: idxArr[6] };

  // Per-landmark confidence: conf = 0.60·score + 0.40·clamp(margin·3) − 0.15·fallback
  const confidences = {};
  const lmNames = ['g', 'n', 'prn', 'cm', 'sn', 'ls', 'pg'];
  for (let k = 0; k < lmNames.length; k++) {
    const marginBoost = clamp01(marginArr[k] * 3);
    const fallbackPen = fallbackArr[k] ? 0.15 : 0;
    confidences[lmNames[k]] = clamp01(scrArr[k] * 0.60 + marginBoost * 0.40 - fallbackPen);
  }
  const liMarginBoost = clamp01((liR.margin ?? 0) * 3);
  const liFallbackPen = liR.method === 'fallback' ? 0.15 : 0;
  confidences.li = clamp01(liR.score * 0.60 + liMarginBoost * 0.40 - liFallbackPen);

  const confValues = Object.values(confidences);
  const avgConf = confValues.reduce((a, b) => a + b, 0) / confValues.length;
  const strongCount = confValues.filter((v) => v > 0.40).length;
  const strengthPenalty = strongCount >= 3 ? 1 : strongCount / 3;
  const overallConfidence = clamp01(avgConf * strengthPenalty * 1.25);

  console.log(`[ProfileContour] scrArr=${JSON.stringify(scrArr.map(v => v.toFixed(3)))} margins=${JSON.stringify(marginArr.map(v => v.toFixed(2)))} avgConf=${avgConf.toFixed(3)} strong=${strongCount} overall=${overallConfidence.toFixed(3)}`);

  return { indices, confidences, overallConfidence };
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function validateIndices(indices, contour, width, height, side) {
  for (const key of REQUIRED_KEYS) {
    if (!Number.isInteger(indices[key])) return { ok: false, reason: `missing_or_non_int_${key}` };
    if (indices[key] < 0 || indices[key] >= contour.length) return { ok: false, reason: `out_of_range_${key}` };
  }

  const ordered = [indices.g, indices.n, indices.prn, indices.sn, indices.ls, indices.pg];
  for (let i = 1; i < ordered.length; i++) {
    if (!(ordered[i - 1] < ordered[i])) return { ok: false, reason: 'invalid_order' };
  }
  if (!(indices.prn < indices.cm && indices.cm < indices.sn)) return { ok: false, reason: 'cm_outside_prn_sn' };
  if (Number.isInteger(indices.li)) {
    if (!(indices.ls < indices.li && indices.li < indices.pg)) return { ok: false, reason: 'li_outside_ls_pg' };
  }

  const uniq = new Set([indices.g, indices.n, indices.prn, indices.cm, indices.sn, indices.ls, indices.pg]);
  if (Number.isInteger(indices.li)) uniq.add(indices.li);
  const requiredUnique = Number.isInteger(indices.li) ? 8 : 7;
  if (uniq.size < requiredUnique) return { ok: false, reason: 'duplicate_indices' };

  const minGap = Math.max(2, Math.floor(contour.length * 0.01));
  if (indices.n - indices.g < minGap) return { ok: false, reason: 'g_n_too_close' };
  if (indices.prn - indices.n < minGap) return { ok: false, reason: 'n_prn_too_close' };
  if (indices.sn - indices.prn < minGap) return { ok: false, reason: 'prn_sn_too_close' };
  if (indices.ls - indices.sn < minGap) return { ok: false, reason: 'sn_ls_too_close' };
  if (Number.isInteger(indices.li)) {
    const liMinGap = Math.max(1, Math.floor(minGap * 0.6));
    if (indices.li - indices.ls < liMinGap) return { ok: false, reason: 'ls_li_too_close' };
    if (indices.pg - indices.li < liMinGap) return { ok: false, reason: 'li_pg_too_close' };
  }

  const diag = Math.hypot(width, height);
  const minDistPx = Math.max(2, diag * 0.004);
  const points = {
    g: contour[indices.g],
    n: contour[indices.n],
    prn: contour[indices.prn],
    cm: contour[indices.cm],
    sn: contour[indices.sn],
    ls: contour[indices.ls],
    pg: contour[indices.pg],
  };
  if (pointDistance(points.n, points.prn) < minDistPx) return { ok: false, reason: 'n_prn_distance_small' };
  if (pointDistance(points.prn, points.sn) < minDistPx) return { ok: false, reason: 'prn_sn_distance_small' };
  if (pointDistance(points.sn, points.ls) < minDistPx) return { ok: false, reason: 'sn_ls_distance_small' };
  if (Number.isInteger(indices.li)) {
    const liPoint = contour[indices.li];
    if (!liPoint) return { ok: false, reason: 'li_missing_point' };
    if (pointDistance(points.ls, liPoint) < minDistPx * 0.6) return { ok: false, reason: 'ls_li_distance_small' };
    if (pointDistance(liPoint, points.pg) < minDistPx * 0.6) return { ok: false, reason: 'li_pg_distance_small' };
  }

  const proj = buildProjectionCurve(contour, width, side);
  const smoothedV = savitzkyGolay(proj, chooseSgWindow(contour.length));
  const prn = indices.prn;
  let globalMax = -Infinity;
  for (let i = 0; i < smoothedV.length; i++) {
    if (smoothedV[i] > globalMax) globalMax = smoothedV[i];
  }
  // prn must be within 88% of global smoothed max (threshold loosened from 0.92 to match smoothed detection)
  if (smoothedV[prn] < globalMax * 0.88) return { ok: false, reason: 'prn_not_local_peak' };

  return { ok: true };
}

function toNamedLandmarks(indices, confidences, contour) {
  const out = {};
  const keys = indices.li !== undefined ? [...REQUIRED_KEYS, 'li'] : REQUIRED_KEYS;
  for (const key of keys) {
    const idx = indices[key];
    if (idx === undefined || idx === null) continue;
    const pt = contour[idx];
    if (!pt) continue;
    out[key] = {
      index: idx,
      x: pt.x,
      y: pt.y,
      confidence: clamp01(confidences?.[key] ?? 0.7),
    };
  }
  return out;
}

function buildSparseEntries(landmarks, contour, width, height, side) {
  const entries = new Map();
  const set = (idx, xNorm, yNorm, z = 0) => {
    if (idx < 0 || idx >= 478) return;
    entries.set(idx, [idx, xNorm, yNorm, z]);
  };

  const norm = (pt) => ({ x: pt.x / width, y: pt.y / height });

  const g = norm(landmarks.g);
  const n = norm(landmarks.n);
  const prn = norm(landmarks.prn);
  const cm = norm(landmarks.cm);
  const sn = norm(landmarks.sn);
  const ls = norm(landmarks.ls);
  const pg = norm(landmarks.pg);

  for (const idx of [9, 8]) set(idx, g.x, g.y);
  for (const idx of [168, 6]) set(idx, n.x, n.y);
  set(1, prn.x, prn.y);
  for (const idx of [2, 98, 327]) set(idx, cm.x, cm.y);
  for (const idx of [164, 167]) set(idx, sn.x, sn.y);
  for (const idx of [13, 0]) set(idx, ls.x, ls.y);
  for (const idx of [152, 148, 176, 149, 150, 136, 377, 400, 378, 379]) set(idx, pg.x, pg.y);

  const dorsumOnly = [197, 195, 5, 4];
  for (let i = 0; i < dorsumOnly.length; i++) {
    const t = (i + 1) / (dorsumOnly.length + 1);
    set(dorsumOnly[i], n.x + t * (prn.x - n.x), n.y + t * (prn.y - n.y));
  }

  const off = 0.025;
  set(129, prn.x - off, prn.y + 0.01);
  set(358, prn.x + off, prn.y + 0.01);

  // li (labrale inferius) → MediaPipe lower lip indices; fallback to interpolation
  if (landmarks.li) {
    const li = norm(landmarks.li);
    for (const idx of [14, 17]) set(idx, li.x, li.y);
  } else {
    set(14, ls.x + 0.30 * (pg.x - ls.x), ls.y + 0.30 * (pg.y - ls.y));
    set(17, ls.x + 0.40 * (pg.x - ls.x), ls.y + 0.40 * (pg.y - ls.y));
  }

  if (contour.length > 0) {
    const top = contour[0];
    set(10, top.x / width, top.y / height);
  }

  const jawContourIdx = Math.floor(contour.length * 0.70);
  if (jawContourIdx < contour.length) {
    const near = contour[jawContourIdx];
    const nearX = near.x / width;
    const nearY = near.y / height;
    const farX = side === 'left' ? 0.82 : 0.18;
    // Left profile: visible gonion = JAW.leftAngle=454; right profile = JAW.rightAngle=234.
    // jawProfileAngleProxy(lm, 'left') reads index 454, so near jaw must live there.
    if (side === 'left') {
      set(454, nearX, nearY);  // visible left gonion
      set(234, farX, nearY);   // synthetic far-side estimate
    } else {
      set(234, nearX, nearY);  // visible right gonion
      set(454, farX, nearY);   // synthetic far-side estimate
    }
  }

  const malarContourIdx = Math.floor(contour.length * 0.38);
  if (malarContourIdx < contour.length) {
    const m = contour[malarContourIdx];
    const mx = m.x / width;
    const my = m.y / height;
    const malarIndices = side === 'left'
      ? [411, 352, 346, 347, 330]
      : [187, 123, 117, 118, 101];
    for (const idx of malarIndices) set(idx, mx, my);
  }

  return [...entries.values()].sort((a, b) => a[0] - b[0]);
}

function normalizeAiProfiles(parsed) {
  const rawProfiles = Array.isArray(parsed?.profiles) ? parsed.profiles : [];
  const out = [];
  for (const p of rawProfiles) {
    const side = p?.side === 'left' || p?.side === 'right' ? p.side : null;
    if (!side) continue;
    const rawLandmarks = p?.landmarks && typeof p.landmarks === 'object' ? p.landmarks : null;
    if (!rawLandmarks) continue;

    const indices = {};
    const confidences = {};
    let ok = true;
    for (const key of REQUIRED_KEYS) {
      const v = rawLandmarks[key];
      let idx;
      let conf;
      if (typeof v === 'number') {
        idx = v;
        conf = 0.7;
      } else if (v && typeof v === 'object') {
        idx = Number(v.index);
        conf = Number.isFinite(Number(v.confidence)) ? Number(v.confidence) : 0.7;
      } else {
        ok = false;
        break;
      }
      indices[key] = Math.trunc(idx);
      confidences[key] = clamp01(conf);
    }
    if (!ok) continue;

    const confValues = Object.values(confidences);
    const fallbackOverall = confValues.length > 0
      ? confValues.reduce((a, b) => a + b, 0) / confValues.length
      : 0;
    const overallConfidence = clamp01(
      Number.isFinite(Number(p?.overallConfidence)) ? Number(p.overallConfidence) : fallbackOverall,
    );

    out.push({ side, indices, confidences, overallConfidence });
  }
  return out;
}

/**
 * Server-side enforcement: clamp AI-returned indices to the candidate windows.
 * If GPT returned an index outside a landmark's candidate window, snap it to:
 * - the best candidate (highest P for peaks, lowest P for valleys), or
 * - the detector value if no candidates exist.
 * This prevents GPT from inventing bogus sequential indices.
 */
function clampAiToWindows(aiResult, candidateWindowsBySide) {
  if (!aiResult || !candidateWindowsBySide) return aiResult;

  const windows = candidateWindowsBySide.get(aiResult.side);
  if (!windows) return aiResult;

  const landmarkTypes = {
    g: 'peak', n: 'valley', prn: 'peak', cm: 'valley', sn: 'valley', ls: 'peak', pg: 'peak',
  };

  const clampedIndices = { ...aiResult.indices };
  const clampedConfidences = { ...aiResult.confidences };
  let clampCount = 0;

  for (const key of REQUIRED_KEYS) {
    const w = windows[key];
    if (!w || !w.candidates || w.candidates.length === 0) continue;

    const aiIdx = clampedIndices[key];
    const validIndices = new Set(w.candidates.map(c => c[0]));

    if (!validIndices.has(aiIdx)) {
      // GPT returned an index outside the window — pick the best candidate instead
      clampCount++;
      const isPeak = landmarkTypes[key] === 'peak';
      let bestIdx = w.det;
      let bestVal = isPeak ? -Infinity : Infinity;

      for (const [candidateIdx, pVal] of w.candidates) {
        if (isPeak && pVal > bestVal) { bestVal = pVal; bestIdx = candidateIdx; }
        if (!isPeak && pVal < bestVal) { bestVal = pVal; bestIdx = candidateIdx; }
      }
      clampedIndices[key] = bestIdx;
      // Reduce confidence since AI was wrong for this landmark
      clampedConfidences[key] = clamp01(clampedConfidences[key] * 0.6);
    }
  }

  if (clampCount > 0) {
    console.log(`[profile-landmarks] Clamped ${clampCount} AI indices to candidate windows for ${aiResult.side}`);
    // Recalculate overall confidence
    const confValues = Object.values(clampedConfidences);
    const avgConf = confValues.reduce((a, b) => a + b, 0) / confValues.length;
    return {
      ...aiResult,
      indices: clampedIndices,
      confidences: clampedConfidences,
      overallConfidence: clamp01(avgConf),
    };
  }

  return aiResult;
}

function lowerChainPenalty(indices, faceH) {
  if (!indices || !Number.isFinite(faceH) || faceH <= 0) return Number.POSITIVE_INFINITY;
  const { prn, cm, sn, ls, pg } = indices;
  if (![prn, cm, sn, ls, pg].every(Number.isInteger)) return Number.POSITIVE_INFINITY;
  if (!(prn < cm && cm < sn && sn < ls && ls < pg)) return Number.POSITIVE_INFINITY;

  const pSn = (sn - prn) / faceH;
  const sLs = (ls - sn) / faceH;
  const lPg = (pg - ls) / faceH;
  const span = Math.max(1, sn - prn);
  const cmRel = (cm - prn) / span;

  let penalty = 0;
  penalty += Math.abs(pSn - 0.095) * 1.6;
  penalty += Math.abs(sLs - 0.110) * 1.4;
  penalty += Math.abs(lPg - 0.170) * 0.8;
  if (cmRel < 0.52) penalty += (0.52 - cmRel) * 2.5;
  if (cmRel > 0.92) penalty += (cmRel - 0.92) * 1.8;
  return penalty;
}

function refineAiPostPrnChain(profile, ai) {
  if (!ai?.indices || !Array.isArray(profile?.contour) || profile.contour.length < 30) return ai;
  const contour = profile.contour;
  const N = contour.length;
  const prnIdx = ai.indices.prn;
  if (!Number.isInteger(prnIdx) || prnIdx < 0 || prnIdx >= N) return ai;

  try {
    const projection = buildProjectionCurve(contour, profile.imageWidth, profile.side);
    const win = chooseSgWindow(N);
    const smoothed = savitzkyGolay(projection, win);
    const Pd1 = savitzkyGolayD1(projection, win);
    const Pd2 = derivative(Pd1);
    const kappa = computeKappa(Pd1, Pd2);

    const { topIdx, faceH } = computeFaceBBox(smoothed);
    if (!Number.isFinite(faceH) || faceH <= 8) return ai;

    const yn2i = (yn) => Math.max(0, Math.min(N - 1, Math.round(topIdx + yn * faceH)));
    const yNorm = Array.from({ length: N }, (_, i) => (i - topIdx) / (faceH || 1));
    const promPeak = Array.from({ length: N }, (_, i) => computeProminence(smoothed, i, true));
    const promValley = Array.from({ length: N }, (_, i) => computeProminence(smoothed, i, false));

    const snMinGap = Math.max(2, Math.round(faceH * SN_MIN_GAP_RATIO));
    const snMaxGap = Math.max(snMinGap + 2, Math.round(faceH * SN_MAX_GAP_RATIO));
    let snZS = Math.max(prnIdx + snMinGap, yn2i(0.50));
    let snZE = Math.min(yn2i(0.64), prnIdx + snMaxGap);
    if (snZE <= snZS) {
      snZS = Math.max(prnIdx + 2, yn2i(0.50));
      snZE = Math.min(yn2i(0.64), prnIdx + Math.max(4, Math.round(faceH * 0.16)));
    }
    const snR = bestInTransitionZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, snZS, snZE, 'sn', 'earliest');
    const snIdx = snR.idx;
    if (!Number.isInteger(snIdx) || snIdx <= prnIdx + 1) return ai;

    const cmR = inferColumellaIndex(prnIdx, snIdx, smoothed, kappa, promValley);
    const prnSnSpan = Math.max(2, snIdx - prnIdx);
    const cmMin = prnIdx + Math.max(1, Math.round(prnSnSpan * 0.52));
    const cmMax = prnIdx + Math.max(1, Math.round(prnSnSpan * 0.92));
    const cmIdx = Math.max(prnIdx + 1, Math.min(snIdx - 1, Math.max(cmMin, Math.min(cmR.idx, cmMax))));

    const lsR = inferLabialeSuperiusIndex(snIdx, smoothed, Pd1, kappa, yNorm, promPeak, promValley, faceH, yn2i);
    const lsIdx = lsR.idx;
    if (!Number.isInteger(lsIdx) || lsIdx <= snIdx + 1) return ai;

    const pgHardMax = Math.min(N - 1, lsIdx + Math.round(faceH * PG_MAX_GAP_RATIO));
    const pgMinGap = Math.max(2, Math.round(faceH * PG_MIN_GAP_RATIO));
    const pgZS = Math.max(lsIdx + pgMinGap, yn2i(0.80));
    const pgZE = Math.min(pgHardMax, yn2i(1.00));
    const pgR = bestInTransitionZone(smoothed, Pd1, kappa, yNorm, promPeak, promValley, pgZS, pgZE, 'pg', 'strongest');
    const pgIdx = pgR.idx;
    if (!Number.isInteger(pgIdx) || pgIdx <= lsIdx + 1) return ai;

    const repairedIndices = { ...ai.indices, cm: cmIdx, sn: snIdx, ls: lsIdx, pg: pgIdx };
    const beforePenalty = lowerChainPenalty(ai.indices, faceH);
    const afterPenalty = lowerChainPenalty(repairedIndices, faceH);
    const beforeCmRel = (ai.indices.cm - prnIdx) / Math.max(1, ai.indices.sn - prnIdx);
    const suspiciousBefore = !Number.isFinite(beforePenalty) || beforePenalty > 0.085 || !Number.isFinite(beforeCmRel) || beforeCmRel < 0.50;
    const shouldAdopt = suspiciousBefore || afterPenalty + 0.010 < beforePenalty;
    if (!shouldAdopt) return ai;

    const confidences = { ...ai.confidences };
    confidences.cm = clamp01((confidences.cm ?? 0.65) * 0.45 + cmR.score * 0.55);
    confidences.sn = clamp01((confidences.sn ?? 0.65) * 0.40 + snR.score * 0.60);
    confidences.ls = clamp01((confidences.ls ?? 0.65) * 0.40 + lsR.score * 0.60);
    confidences.pg = clamp01((confidences.pg ?? 0.65) * 0.40 + pgR.score * 0.60);

    const overallConfidence = clamp01(
      REQUIRED_KEYS.reduce((acc, key) => acc + (confidences[key] ?? 0.65), 0) / REQUIRED_KEYS.length,
    );
    console.log(
      `[profile-landmarks] AI ${profile.side}: lower-chain refined prn=${prnIdx} cm=${cmIdx} sn=${snIdx} ls=${lsIdx} pg=${pgIdx} penalty ${beforePenalty.toFixed(3)}→${afterPenalty.toFixed(3)}`,
    );
    return { ...ai, indices: repairedIndices, confidences, overallConfidence };
  } catch (e) {
    console.warn(`[profile-landmarks] AI ${profile.side}: post-refine failed: ${e?.message || 'unknown_error'}`);
    return ai;
  }
}

function resolveResultForProfile(profile, aiBySide, detectorBySide) {
  const detector = detectorBySide.get(profile.side);
  const ai = aiBySide.get(profile.side);

  if (!ai) {
    if (detector) return { source: 'detector', reason: 'ai_missing_side', ...detector };
    return { source: 'detector', reason: 'detector_unavailable' };
  }

  const refinedAi = refineAiPostPrnChain(profile, ai);
  const valid = validateIndices(refinedAi.indices, profile.contour, profile.imageWidth, profile.imageHeight, profile.side);
  if (!valid.ok) {
    if (detector) return { source: 'detector', reason: `ai_invalid_${valid.reason}`, ...detector };
    return { source: 'detector', reason: `ai_invalid_${valid.reason}` };
  }
  if (refinedAi.overallConfidence < AI_MIN_CONFIDENCE) {
    console.log(`[profile-landmarks] AI ${profile.side}: low confidence=${refinedAi.overallConfidence.toFixed(3)} but accepted (ai-first mode)`);
  }

  return { source: 'ai', ...refinedAi };
}

function buildCandidateWindows(detectorResult, smoothed, N) {
  if (!detectorResult || !detectorResult.indices) return null;
  const { indices } = detectorResult;
  const windowsByKey = {
    g: 10,
    n: 10,
    prn: 10,
    cm: 16,
    sn: 18,
    ls: 20,
    pg: 24,
  };

  const landmarkTypes = {
    g: 'peak', n: 'valley', prn: 'peak', cm: 'valley', sn: 'valley', ls: 'peak', pg: 'peak',
  };

  const windows = {};
  for (const key of REQUIRED_KEYS) {
    const center = indices[key];
    const span = windowsByKey[key] ?? 10;
    const lo = Math.max(0, center - span);
    const hi = Math.min(N - 1, center + span);
    const candidates = [];
    for (let i = lo; i <= hi; i++) {
      candidates.push([i, Math.round(smoothed[i] * 100) / 100]);
    }
    windows[key] = {
      det: center,
      type: landmarkTypes[key],
      candidates,
    };
  }
  return windows;
}

async function requestAiLandmarks(client, model, profiles, detectorBySide) {
  const candidateWindowsBySide = new Map();

  const userPayload = profiles.map((p) => {
    const det = detectorBySide.get(p.side);
    if (!det) return null;

    const projection = buildProjectionCurve(p.contour, p.imageWidth, p.side);
    const smoothed = savitzkyGolay(projection, chooseSgWindow(p.contour.length));
    const windows = buildCandidateWindows(det, smoothed, p.contour.length);
    if (!windows) return null;

    candidateWindowsBySide.set(p.side, windows);

    return {
      side: p.side,
      contourCount: p.contour.length,
      landmarks: windows,
    };
  }).filter(Boolean);

  if (userPayload.length === 0) {
    return [];
  }

  const completionPromise = client.chat.completions.create({
    model,
    temperature: 0,
    max_tokens: 1400,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_CANDIDATE },
      {
        role: 'user',
        content: `Select the best landmark index from each candidate list. Return strict JSON only.\n\n${JSON.stringify({ profiles: userPayload })}`,
      },
    ],
  });

  const timed = Promise.race([
    completionPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('ai_timeout')), AI_TIMEOUT_MS)),
  ]);
  // Prevent unhandled rejection if SDK resolves after the race timeout already fired
  completionPromise.catch(() => {});

  const response = await timed;
  const text = response?.choices?.[0]?.message?.content ?? '';
  const parsed = parseJsonLoose(text);
  const aiProfiles = normalizeAiProfiles(parsed);

  // Server-side enforcement: clamp any out-of-window AI indices back to best candidates
  const clampedProfiles = aiProfiles.map((aiResult) =>
    clampAiToWindows(aiResult, candidateWindowsBySide)
  );

  return clampedProfiles;
}

export async function handleProfileLandmarks(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    jsonReply(res, 405, { error: 'Метод не поддерживается' });
    return;
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    jsonReply(res, 400, { error: 'Некорректный JSON в теле запроса' });
    return;
  }

  const rawProfiles = Array.isArray(body?.profiles) ? body.profiles : [];
  if (rawProfiles.length === 0) {
    jsonReply(res, 400, { error: 'Требуется непустой массив profiles' });
    return;
  }

  const profiles = rawProfiles
    .map((p) => {
      const side = p?.side === 'left' || p?.side === 'right' ? p.side : null;
      const imageWidth = Number(p?.imageWidth);
      const imageHeight = Number(p?.imageHeight);
      if (!side || !Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
        return null;
      }
      const contour = normalizeContourPoints(p);
      return { side, imageWidth, imageHeight, contour };
    })
    .filter(Boolean)
    .filter((p) => p.contour.length >= 30);

  if (profiles.length === 0) {
    jsonReply(res, 200, { profiles: [] });
    return;
  }

  const detectorBySide = new Map();
  for (const p of profiles) {
    // Truncate contour to face area only — exclude neck/shoulders (keep top 70% of image).
    // pg neck-drift is handled by PG_MAX_GAP_RATIO hard cap, not by aggressive truncation.
    const maxFaceY = p.imageHeight * 0.70;
    const faceContour = p.contour.filter(pt => pt.y <= maxFaceY);
    if (faceContour.length < 30) {
      console.log(`[profile-landmarks] Contour too short after neck truncation: ${faceContour.length}`);
      continue;
    }
    const det = inferDeterministicFromContour(faceContour, p.imageWidth, p.side);
    if (det) {
      detectorBySide.set(p.side, det);
      const yCoords = {};
      for (const k of ['g','n','prn','cm','sn','ls','pg']) {
        const pt = p.contour[det.indices[k]];
        yCoords[k] = pt ? Math.round(pt.y) : '?';
      }
      const gaps = {
        prn_sn: det.indices.sn - det.indices.prn,
        sn_ls: det.indices.ls - det.indices.sn,
      };
      console.log(`[profile-landmarks] Detector ${p.side}: conf=${det.overallConfidence.toFixed(3)} N=${faceContour.length} (orig ${p.contour.length}) indices=${JSON.stringify(det.indices)} y=${JSON.stringify(yCoords)} gaps=${JSON.stringify(gaps)} h=${p.imageHeight}`);
    } else {
      console.log(`[profile-landmarks] Detector ${p.side}: FAILED (returned null) N=${faceContour.length}`);
    }
  }

  const model = resolveProfileModel();
  const aiBySide = new Map();
  let aiFailureReason = null;

  const apiKey = resolveOpenAIKey();
  if (!apiKey) {
    aiFailureReason = 'missing_openai_key';
    console.warn('[profile-landmarks] AI disabled: OPENAI_API_KEY is missing');
  } else {
    const client = new OpenAI({ apiKey });
    try {
      const aiProfiles = await requestAiLandmarks(client, model, profiles, detectorBySide);
      for (const aiProfile of aiProfiles) {
        aiBySide.set(aiProfile.side, aiProfile);
      }
      if (aiProfiles.length === 0) {
        aiFailureReason = 'ai_empty_response';
      }
    } catch (error) {
      const message = String(error?.message || '');
      aiFailureReason = message === 'ai_timeout' ? 'ai_timeout' : 'ai_request_failed';
      console.error(`[profile-landmarks] AI request failed: ${message || 'unknown_error'}`);
    }
  }

  const outputProfiles = profiles.map((p) => {
    const resolved = resolveResultForProfile(p, aiBySide, detectorBySide);
    if (!resolved.indices || !resolved.confidences) {
      return {
        side: p.side,
        source: 'detector',
        overallConfidence: 0,
        landmarks: null,
        landmarkEntries: [],
        reason: aiFailureReason || resolved.reason || 'no_valid_solution',
      };
    }

    const landmarks = toNamedLandmarks(resolved.indices, resolved.confidences, p.contour);
    const landmarkEntries = buildSparseEntries(landmarks, p.contour, p.imageWidth, p.imageHeight, p.side);

    return {
      side: p.side,
      source: resolved.source,
      overallConfidence: clamp01(resolved.overallConfidence),
      landmarks,
      landmarkEntries,
      ...(resolved.reason ? { reason: resolved.reason } : {}),
      ...(resolved.source === 'detector' && aiFailureReason ? { aiFailure: aiFailureReason } : {}),
    };
  });

  jsonReply(res, 200, { profiles: outputProfiles, model });
}

export const __profileLandmarkInternals = {
  normalizeAiProfiles,
  validateIndices,
  inferDeterministicFromContour,
};

export default handleProfileLandmarks;
