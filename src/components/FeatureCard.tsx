import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureAnalysis, Gender, PopulationGroup, NormalizedLandmark } from '../types';
import type { AIFeatureResult } from '../analysis/llm';
import { featureLabel, statusLabel } from '../i18n';
import { useLanguage, useT } from '../lib/language';
import { localizeNarrativeText } from '../lib/narrativeLocalization';
import { boostedConfidence } from '../analysis/scoring';
import MeasurementCard from './MeasurementCard';
import ObservationCard from './ObservationCard';
import ProportionBar from './ProportionBar';
import ProportionOverlay from './ProportionOverlay';
import { computeProportions } from '../analysis/proportions';
import { robustMedian } from '../analysis/metrics';
import * as L from '../analysis/landmarks';
import {
  FEATURE_TRANSFORM_MAP,
  buildMaskDataUrl,
  requestFaceTransform,
  type TransformPresetId,
  type ProportionDeviation,
} from '../analysis/faceTransform';

interface Props {
  feature: FeatureAnalysis;
  index: number;
  aiResult?: AIFeatureResult;
  frontImageDataUrl?: string | null;
  landmarks?: NormalizedLandmark[] | null;
  profileImageDataUrls?: { left?: string; right?: string };
  profileMaskDataUrls?: { left?: string; right?: string };
  profileLandmarks?: { left?: NormalizedLandmark[] | null; right?: NormalizedLandmark[] | null };
  profileLandmarkSource?: { left?: 'ai' | 'contour' | 'mediapipe'; right?: 'ai' | 'contour' | 'mediapipe' };
  profileLandmarkConfidence?: { left?: number; right?: number };
  precomputedTransformDataUrl?: string | null;
  gender?: Gender | null;
  population?: PopulationGroup;
  defaultExpanded?: boolean;
}

// ─── AI Insight text cleanup ───────────────────────────────────────────────

const FEATURE_NAME_RU: Record<string, string> = {
  Eyebrows: 'Брови', Eyes: 'Глаза', Nose: 'Нос', Lips: 'Губы',
  Cheeks: 'Щёки', Jaw: 'Овал лица', Chin: 'Подбородок',
  Skin: 'Кожа', Neck: 'Шея', Ears: 'Уши', Hair: 'Волосы',
};

function cleanAiInsight(text: string, lang: 'ru' | 'en'): string {
  if (lang === 'en') {
    return localizeNarrativeText(text, lang);
  }
  return text
    // "стандарту default:" → "стандарту красоты:"
    .replace(/стандарту\s+default\s*:/gi, 'стандарту красоты:')
    .replace(/стандарту\s+east_asian\s*:/gi, 'восточноазиатскому стандарту:')
    .replace(/\bdefault\b/g, 'базовому')
    .replace(/\beast_asian\b/gi, 'восточноазиатскому')
    // English feature names in quotes → Russian
    .replace(/"([A-Za-z]+)"/g, (_, name) => `«${FEATURE_NAME_RU[name] ?? name}»`)
    // "зоны «Eyebrows»" style
    .replace(/зон[ыеа]\s+"([A-Za-z]+)"/gi, (_, name) => `зоны «${FEATURE_NAME_RU[name] ?? name}»`)
    // "Статус: OK" / "Статус: OK." — убираем
    .replace(/Статус:\s*(OK|Attention|Monitor|Norm)[.,]?\s*/gi, '')
    // Шаблонные фразы — убираем
    .replace(/Интерпретация выполнена по доступным метрикам и наблюдениям[.,]?\s*/gi, '')
    .replace(/Зоны улучшения корректируются поэтапно с контролем динамики по тем же индексам[.,]?\s*/gi, '')
    // Убираем "Параметры: ..." (до точки включительно)
    .replace(/Параметры:[^.]+\./gi, '')
    // Лишние пробелы
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const LIMITATION_PATTERNS: RegExp[] = [
  /\blimitations?\b/i,
  /\bограничени[ея]\b/i,
  /толщин[ауы]\s+и\s+плотност[ьи]\s+бровей.*нельзя\s+точно\s+измерить/i,
  /для\s+оценки\s+густоты.*нужен\s+крупный\s+план/i,
  /мимика\s+влияет\s+на\s+положени[ея]\s+и\s+форму\s+бровей/i,
  /cannot\s+be\s+accurately\s+measured/i,
  /requires?\s+(a\s+)?close[- ]up/i,
  /facial\s+expression\s+affects/i,
];

function isLimitationLike(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (/^[-—]\s*/.test(value)) return LIMITATION_PATTERNS.some((rx) => rx.test(value));
  return LIMITATION_PATTERNS.some((rx) => rx.test(value));
}

// ─── Profile Angle Visualizer ──────────────────────────────────────────────

type Pt = { x: number; y: number };

/**
 * Detect the face silhouette via brightness threshold and locate 6 cephalometric
 * points on the profile curve. Returns null if the silhouette can't be found.
 *
 * Works purely from pixels — no landmark data required. Designed for profile
 * selfies with a light background.
 */
function detectSilhouetteAngles(
  imgData: ImageData,
  side: 'left' | 'right',
): { pts: Record<string, Pt>; nfa: number; nla: number } | null {
  const { data, width: W, height: H } = imgData;

  // Auto-detect background brightness by sampling image corners
  const px = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  const bg = (px(4, 4) + px(W - 5, 4) + px(4, H - 5) + px(W - 5, H - 5)) / 4;
  // If background is dark, don't attempt (works best for light backgrounds)
  if (bg < 100) return null;
  const thresh = bg - 35;

  // For each row, find the outermost face pixel (first pixel darker than threshold)
  const yS = Math.floor(H * 0.08);
  const yE = Math.floor(H * 0.94);
  const xLim = side === 'left' ? Math.floor(W * 0.65) : Math.floor(W * 0.35);
  const raw: (number | null)[] = new Array(H).fill(null);

  for (let y = yS; y < yE; y++) {
    if (side === 'left') {
      for (let x = 0; x < xLim; x++) {
        if (px(x, y) < thresh) { raw[y] = x; break; }
      }
    } else {
      for (let x = W - 1; x >= xLim; x--) {
        if (px(x, y) < thresh) { raw[y] = x; break; }
      }
    }
  }

  // Median smooth (window = 9)
  const sm: (number | null)[] = new Array(H).fill(null);
  for (let y = yS; y < yE; y++) {
    const vals: number[] = [];
    for (let k = -4; k <= 4; k++) {
      const sy = y + k;
      if (sy >= yS && sy < yE && raw[sy] !== null) vals.push(raw[sy]!);
    }
    if (vals.length >= 3) {
      vals.sort((a, b) => a - b);
      sm[y] = vals[Math.floor(vals.length / 2)];
    }
  }

  // Build contour from largest contiguous run
  let bS = yS, bE = yS, bLen = 0, cS = -1;
  for (let y = yS; y < yE; y++) {
    if (sm[y] !== null) {
      if (cS === -1) cS = y;
    } else if (cS !== -1) {
      if (y - cS > bLen) { bLen = y - cS; bS = cS; bE = y; }
      cS = -1;
    }
  }
  if (cS !== -1 && yE - cS > bLen) { bS = cS; bE = yE; bLen = yE - cS; }
  if (bLen < H * 0.25) return null;

  const contour: Pt[] = [];
  for (let y = bS; y < bE; y++) {
    if (sm[y] !== null) contour.push({ x: sm[y]!, y });
  }
  if (contour.length < 40) return null;

  // Projection curve: distance from far edge → protrusions = peaks
  const proj = contour.map(p => side === 'left' ? (W - 1 - p.x) : p.x);

  // Moving-average smooth
  const sw = Math.max(5, Math.round(contour.length / 25));
  const sp = proj.map((_, i) => {
    let s = 0, c = 0;
    for (let k = -sw; k <= sw; k++) {
      const j = i + k;
      if (j >= 0 && j < proj.length) { s += proj[j]; c++; }
    }
    return s / c;
  });

  const N = contour.length;

  // Pronasale: global max in 25–62 % zone
  const pS = Math.floor(N * 0.25), pE = Math.floor(N * 0.62);
  let prnIdx = pS;
  for (let i = pS; i < pE; i++) if (sp[i] > sp[prnIdx]) prnIdx = i;

  // Nasion: min in 8–85 % of pronasale zone
  const nS = Math.floor(N * 0.08), nE = Math.floor(prnIdx * 0.85);
  if (nE <= nS) return null;
  let nIdx = nS;
  for (let i = nS; i < nE; i++) if (sp[i] < sp[nIdx]) nIdx = i;

  // Glabella: max from 0 to nasion
  let gIdx = 0;
  for (let i = 0; i < nIdx; i++) if (sp[i] > sp[gIdx]) gIdx = i;

  // Subnasale: min after pronasale (3–22 % ahead)
  const snS = prnIdx + Math.max(2, Math.floor(N * 0.03));
  const snE = Math.min(prnIdx + Math.floor(N * 0.22), N - 1);
  if (snE <= snS) return null;
  let snIdx = snS;
  for (let i = snS; i < snE; i++) if (sp[i] < sp[snIdx]) snIdx = i;

  // Labiale superius: max after subnasale (up to 15 % ahead)
  const lsS = snIdx + 1;
  const lsE = Math.min(snIdx + Math.floor(N * 0.15), N - 1);
  let lsIdx = lsS;
  for (let i = lsS + 1; i <= lsE; i++) if (sp[i] > sp[lsIdx]) lsIdx = i;

  // Columella: 60 % between pronasale and subnasale
  const cmIdx = Math.min(Math.round(prnIdx + (snIdx - prnIdx) * 0.6), N - 1);

  const pts: Record<string, Pt> = {
    g:   contour[gIdx],
    n:   contour[nIdx],
    prn: contour[prnIdx],
    cm:  contour[cmIdx],
    sn:  contour[snIdx],
    ls:  contour[Math.min(lsIdx, N - 1)],
  };

  // Angle at vertex v between rays v→a and v→b
  const ang3 = (a: Pt, v: Pt, b: Pt) => {
    const ax = a.x - v.x, ay = a.y - v.y;
    const bx = b.x - v.x, by = b.y - v.y;
    return Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by) * (180 / Math.PI);
  };

  return {
    pts,
    nfa: Math.round(ang3(pts.g, pts.n, pts.prn) * 10) / 10,
    nla: Math.round(ang3(pts.prn, pts.sn, pts.ls) * 10) / 10,
  };
}

function detectAnglesFromProfileLandmarks(
  lm: NormalizedLandmark[],
  imageAspectRatio = 1,
): { pts: Record<string, Pt>; nfa: number; nla: number; nfaFrom: 'tangent' | 'local'; nlaFrom: 'cm' | 'prn' } | null {
  const prn = lm[L.NOSE.tip] ?? robustMedian(lm, L.NOSE_TIP_DENSE);
  const cm = lm[L.NOSE.bottom] ?? robustMedian(lm, L.COLUMELLA_CANDIDATES);
  const strictSnIdx = [164, 167] as const;
  const sn = strictSnIdx.some((idx) => !!lm[idx])
    ? robustMedian(lm, strictSnIdx)
    : robustMedian(lm, L.SUBNASALE_CANDIDATES);
  const ls = lm[L.LIPS.upperCenter] ?? robustMedian(lm, [L.LIPS.upperCenter, L.LIPS.upperOuter]);
  const pg = robustMedian(lm, [152, 148, 176, 149, 150, 136, 377, 400, 378, 379]);
  const faceTop = lm[L.REFERENCE.faceTop];
  const pts3 = {
    g: robustMedian(lm, L.GLABELLA_CANDIDATES),
    n: robustMedian(lm, L.NASION_CANDIDATES),
    prn,
    cm,
    sn,
    ls,
    pg,
  };

  const finite = (p: NormalizedLandmark) => Number.isFinite(p.x) && Number.isFinite(p.y);
  if (!finite(pts3.g) || !finite(pts3.n) || !finite(pts3.prn) || !finite(pts3.sn) || !finite(pts3.ls)) {
    return null;
  }
  if (pts3.n.x === 0 && pts3.n.y === 0 && pts3.prn.x === 0 && pts3.prn.y === 0) return null;

  const tangentPt = (() => {
    if (!faceTop || !finite(faceTop)) return pts3.g;
    const vx = pts3.g.x - faceTop.x;
    const vy = pts3.g.y - faceTop.y;
    if (Math.hypot(vx, vy) < 1e-6) return pts3.g;
    return { x: pts3.n.x + vx, y: pts3.n.y + vy, z: pts3.n.z };
  })();

  const toPt = (p: NormalizedLandmark): Pt => ({ x: p.x, y: p.y });
  const pts = {
    g: toPt(pts3.g),
    g_tan: toPt(tangentPt),
    n: toPt(pts3.n),
    prn: toPt(pts3.prn),
    cm: toPt(pts3.cm),
    sn: toPt(pts3.sn),
    ls: toPt(pts3.ls),
    ...(finite(pts3.pg) ? { pg: toPt(pts3.pg) } : {}),
  };

  const asp = Number.isFinite(imageAspectRatio) && imageAspectRatio > 0 ? imageAspectRatio : 1;
  const ang3 = (a: Pt, v: Pt, b: Pt) => {
    const ax = (a.x - v.x) * asp, ay = a.y - v.y;
    const bx = (b.x - v.x) * asp, by = b.y - v.y;
    return Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by) * (180 / Math.PI);
  };

  const cmSn = Math.hypot(pts.cm.x - pts.sn.x, pts.cm.y - pts.sn.y);
  const cmPrn = Math.hypot(pts.cm.x - pts.prn.x, pts.cm.y - pts.prn.y);
  const nfaLocal = ang3(pts.g, pts.n, pts.prn);
  const nfaTangent = ang3(pts.g_tan, pts.n, pts.prn);
  const foreheadDirDelta = ang3(pts.g, pts.n, pts.g_tan);
  let nfaFrom: 'tangent' | 'local' = foreheadDirDelta <= 25 ? 'tangent' : 'local';
  let nfaChosen = nfaFrom === 'tangent' ? nfaTangent : nfaLocal;
  if ((nfaChosen < 95 || nfaChosen > 170) && nfaLocal >= 95 && nfaLocal <= 170) {
    nfaFrom = 'local';
    nfaChosen = nfaLocal;
  }
  // If still outside clinical range, silhouette is degenerate — flag as unreliable
  if (nfaChosen < 95 || nfaChosen > 170) nfaChosen = NaN;

  const nlaCm = ang3(pts.cm, pts.sn, pts.ls);
  const nlaPrn = ang3(pts.prn, pts.sn, pts.ls);
  const cmCollapsed = cmSn < 0.01 || cmPrn < 0.006;
  const cmPlausible = nlaCm >= 70 && nlaCm <= 155;
  const prnPlausible = nlaPrn >= 70 && nlaPrn <= 155;
  let nlaFrom: 'cm' | 'prn';
  let nlaChosen: number;
  if (cmCollapsed) {
    nlaFrom = 'prn';
    nlaChosen = nlaPrn;
  } else if (cmPlausible && !prnPlausible) {
    nlaFrom = 'cm';
    nlaChosen = nlaCm;
  } else if (!cmPlausible && prnPlausible) {
    nlaFrom = 'prn';
    nlaChosen = nlaPrn;
  } else if (cmPlausible && prnPlausible) {
    nlaFrom = 'cm';
    nlaChosen = nlaCm;
  } else {
    nlaFrom = Math.abs(nlaPrn - 100) < Math.abs(nlaCm - 100) ? 'prn' : 'cm';
    nlaChosen = nlaFrom === 'prn' ? nlaPrn : nlaCm;
  }

  return {
    pts,
    nfa: Math.round(nfaChosen * 10) / 10,
    nla: Math.round(nlaChosen * 10) / 10,
    nfaFrom,
    nlaFrom,
  };
}

/**
 * Self-contained profile angle canvas.
 * Uses SAM/contour landmarks when available; falls back to brightness silhouette.
 */
function ProfileAngleCanvas({
  imageDataUrl,
  side,
  profileLandmarks,
  maskDataUrl,
}: {
  imageDataUrl: string;
  side: 'left' | 'right';
  profileLandmarks?: NormalizedLandmark[] | null;
  maskDataUrl?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const drawCtx: CanvasRenderingContext2D = ctx;
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      canvas.width = W;
      canvas.height = H;
      drawCtx.drawImage(img, 0, 0, W, H);
      const renderAngles = () => {
        let result: { pts: Record<string, Pt>; nfa: number; nla: number; nfaFrom?: 'tangent' | 'local'; nlaFrom?: 'cm' | 'prn' } | null = null;
        if (profileLandmarks && profileLandmarks.length > 0) {
          const fromLm = detectAnglesFromProfileLandmarks(profileLandmarks, W / H);
          if (fromLm) {
            result = {
              pts: Object.fromEntries(
                Object.entries(fromLm.pts).map(([k, p]) => [k, { x: p.x * W, y: p.y * H }]),
              ) as Record<string, Pt>,
              nfa: fromLm.nfa,
              nla: fromLm.nla,
              nfaFrom: fromLm.nfaFrom,
              nlaFrom: fromLm.nlaFrom,
            };
          }
        }
        // Legacy pixel fallback is too unstable on masked/profile frames.
        // Keep it only when we have no SAM mask at all.
        if (!result && !maskDataUrl) {
          const imgData = drawCtx.getImageData(0, 0, W, H);
          result = detectSilhouetteAngles(imgData, side);
        }
        if (!result) return; // silhouette not found — show image only

        const { pts, nfa, nla } = result;
        const lineW = Math.max(2, W / 200);
        const dotR  = Math.max(5, W / 70);
        const fontSize = Math.max(13, W / 35);

      function drawAngleLine(
        from: Pt, vertex: Pt, to: Pt,
        color: string, label: string, angle: number,
      ) {
        const extend = W * 0.12;
        const ax = vertex.x - from.x, ay = vertex.y - from.y;
        const lenA = Math.hypot(ax, ay) || 1;
        const bx = to.x - vertex.x, by = to.y - vertex.y;
        const lenB = Math.hypot(bx, by) || 1;

        drawCtx.save();
        drawCtx.strokeStyle = color;
        drawCtx.lineWidth = lineW;

        drawCtx.beginPath();
        drawCtx.moveTo(from.x - (ax / lenA) * extend * 0.3, from.y - (ay / lenA) * extend * 0.3);
        drawCtx.lineTo(vertex.x, vertex.y);
        drawCtx.stroke();

        drawCtx.beginPath();
        drawCtx.moveTo(vertex.x, vertex.y);
        drawCtx.lineTo(to.x + (bx / lenB) * extend * 0.3, to.y + (by / lenB) * extend * 0.3);
        drawCtx.stroke();

        const angA = Math.atan2(-ay, -ax);
        const angB = Math.atan2(by, bx);
        const arcR = Math.min(dotR * 3.5, W * 0.06);
        drawCtx.beginPath();
        drawCtx.arc(vertex.x, vertex.y, arcR, angA, angB, false);
        drawCtx.globalAlpha = 0.45;
        drawCtx.stroke();
        drawCtx.globalAlpha = 1;

        // Label pill
        const midAng = (angA + angB) / 2;
        const lx = vertex.x + Math.cos(midAng) * arcR * 2.2;
        const ly = vertex.y + Math.sin(midAng) * arcR * 2.2;
        drawCtx.font = `bold ${fontSize}px system-ui, sans-serif`;
        const text = `${label} ${angle.toFixed(1)}°`;
        const tw = drawCtx.measureText(text).width;
        const pad = 5;
        drawCtx.fillStyle = 'rgba(0,0,0,0.55)';
        drawCtx.beginPath();
        drawCtx.roundRect(lx - tw / 2 - pad, ly - fontSize * 0.75 - pad, tw + pad * 2, fontSize + pad * 2, 4);
        drawCtx.fill();
        drawCtx.fillStyle = color;
        drawCtx.textAlign = 'center';
        drawCtx.textBaseline = 'middle';
        drawCtx.fillText(text, lx, ly);
        drawCtx.restore();
      }

      function drawDot(pt: Pt, color: string, labelText: string) {
        drawCtx.beginPath();
        drawCtx.arc(pt.x, pt.y, dotR + 2, 0, Math.PI * 2);
        drawCtx.fillStyle = 'rgba(0,0,0,0.4)';
        drawCtx.fill();
        drawCtx.beginPath();
        drawCtx.arc(pt.x, pt.y, dotR, 0, Math.PI * 2);
        drawCtx.fillStyle = color;
        drawCtx.fill();
        drawCtx.font = `bold ${Math.round(fontSize * 0.85)}px system-ui, sans-serif`;
        drawCtx.lineWidth = 3;
        drawCtx.strokeStyle = 'rgba(0,0,0,0.7)';
        drawCtx.fillStyle = '#fff';
        drawCtx.textAlign = 'left';
        drawCtx.textBaseline = 'middle';
        drawCtx.strokeText(labelText, pt.x + dotR + 3, pt.y);
        drawCtx.fillText(labelText, pt.x + dotR + 3, pt.y);
      }

        const nfaFromPt = result.nfaFrom === 'tangent' ? (pts.g_tan ?? pts.g) : pts.g;
        const nlaFromPt = result.nlaFrom === 'cm' ? pts.cm : pts.prn;

        if (!isNaN(nfa)) drawAngleLine(nfaFromPt, pts.n, pts.prn, '#60a5fa', 'NFA', nfa);
        drawAngleLine(nlaFromPt, pts.sn, pts.ls, '#fbbf24', 'NLA', nla);

        drawDot(pts.g,   '#a78bfa', "g'");
        drawDot(pts.n,   '#60a5fa', "n'");
        drawDot(pts.prn, '#34d399', 'prn');
        drawDot(pts.cm,  '#2dd4bf', 'cm');
        drawDot(pts.sn,  '#fbbf24', 'sn');
        drawDot(pts.ls,  '#fb923c', 'ls');
        if (pts.pg) drawDot(pts.pg, '#f97316', 'pg');
      };

      if (maskDataUrl) {
        const maskImg = new Image();
        maskImg.onload = () => {
          drawCtx.drawImage(maskImg, 0, 0, W, H);
          renderAngles();
        };
        maskImg.src = maskDataUrl;
      } else {
        renderAngles();
      }
    };
    img.src = imageDataUrl;
  }, [imageDataUrl, side, profileLandmarks, maskDataUrl]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full object-cover"
      style={{ display: 'block' }}
    />
  );
}

const STATUS_CONFIG = {
  within_norm: {
    label: statusLabel('within_norm'),
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    dot: 'bg-emerald-500',
  },
  strength: {
    label: statusLabel('strength'),
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
    dot: 'bg-blue-500',
  },
  attention: {
    label: statusLabel('attention'),
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    dot: 'bg-amber-500',
  },
  insufficient_data: {
    label: statusLabel('insufficient_data'),
    bg: 'bg-gray-50',
    text: 'text-gray-500',
    border: 'border-gray-200',
    dot: 'bg-gray-400',
  },
};

export default function FeatureCard({
  feature,
  index,
  aiResult,
  frontImageDataUrl,
  landmarks,
  profileImageDataUrls,
  profileMaskDataUrls,
  profileLandmarks,
  profileLandmarkSource,
  profileLandmarkConfidence,
  precomputedTransformDataUrl,
  gender,
  population = 'default',
  defaultExpanded = false,
}: Props) {
  const t = useT();
  const { lang } = useLanguage();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [activeProportionKey, setActiveProportionKey] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [transformResult, setTransformResult] = useState<string | null>(precomputedTransformDataUrl ?? null);
  const [transformError, setTransformError] = useState<string | null>(null);
  const autoFallbackRequestedRef = useRef(false);

  const cfg = STATUS_CONFIG[feature.status];
  const effectiveConf = boostedConfidence(feature, gender ?? null, population);
  const sanitizedObservations = useMemo(
    () => feature.observations.filter((obs) => !isLimitationLike(obs)),
    [feature.observations],
  );
  const sanitizedRecommendations = useMemo(
    () => feature.recommendations.filter((rec) => !isLimitationLike(rec)),
    [feature.recommendations],
  );
  const sanitizedAiRecommendations = useMemo(
    () => (aiResult?.aiRecommendations ?? []).filter((rec) => !isLimitationLike(rec)),
    [aiResult?.aiRecommendations],
  );

  const proportions = useMemo(
    () => computeProportions(feature.name, feature.measurements, gender ?? null, population),
    [feature.name, feature.measurements, gender, population, lang],
  );
  const proportionMeasurementKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!proportions?.items?.length) return keys;
    for (const item of proportions.items) {
      if (item.key && !item.key.startsWith('_')) {
        keys.add(item.key);
      }
    }
    return keys;
  }, [proportions]);
  const additionalMeasurements = useMemo(
    () => Object.entries(feature.measurements).filter(([key]) => !proportionMeasurementKeys.has(key)),
    [feature.measurements, proportionMeasurementKeys],
  );
  const hasAdditionalMeasurements = additionalMeasurements.length > 0;
  const transformPresetId = FEATURE_TRANSFORM_MAP[feature.name] as TransformPresetId | undefined;
  const canTransform =
    !!transformPresetId &&
    !!frontImageDataUrl &&
    !!landmarks &&
    landmarks.length > 0;

  useEffect(() => {
    if (precomputedTransformDataUrl) {
      setTransformResult(precomputedTransformDataUrl);
      setTransformError(null);
    }
  }, [precomputedTransformDataUrl]);

  useEffect(() => {
    autoFallbackRequestedRef.current = false;
  }, [feature.name, frontImageDataUrl]);

  useEffect(() => {
    if (!expanded) {
      setActiveProportionKey(null);
    }
  }, [expanded]);

  useEffect(() => {
    setActiveProportionKey(null);
  }, [feature.name]);

  const handleGenerateTransform = useCallback(async () => {
    if (!canTransform || isGenerating) return;
    setIsGenerating(true);
    setTransformError(null);
    try {
      const maskDataUrl = await buildMaskDataUrl(frontImageDataUrl!, landmarks!, transformPresetId!);

      // Build proportion deviations for data-driven prompts
      const deviations: ProportionDeviation[] = proportions?.items
        ?.filter((item) => !item.informational)
        .map((item) => ({
          key: item.key,
          label: item.label,
          userValue: item.userValue,
          idealCenter: item.idealCenter,
          idealMin: item.idealMin,
          idealMax: item.idealMax,
          unit: item.unit,
          direction: item.userValue < item.idealMin
            ? 'too_low' as const
            : item.userValue > item.idealMax
              ? 'too_high' as const
              : 'ideal' as const,
          deviationAmount: Math.abs(item.userValue - item.idealCenter),
          status: item.status,
        })) ?? [];

      const transformed = await requestFaceTransform({
        preset: transformPresetId!,
        imageDataUrl: frontImageDataUrl!,
        maskDataUrl,
        intensity: 'strong',
        profileLeftDataUrl: profileImageDataUrls?.left,
        profileRightDataUrl: profileImageDataUrls?.right,
        proportionDeviations: deviations,
      });
      const transformedSource = transformed.imageDataUrl ?? transformed.imageUrl;
      // Skip blending — show raw FAL output directly for stronger visual difference
      setTransformResult(transformedSource);
    } catch (err) {
      setTransformError(err instanceof Error ? err.message : t('featureCard.generateError'));
    } finally {
      setIsGenerating(false);
    }
  }, [
    canTransform,
    frontImageDataUrl,
    isGenerating,
    landmarks,
    profileImageDataUrls?.left,
    profileImageDataUrls?.right,
    proportions,
    transformPresetId,
  ]);

  useEffect(() => {
    if (!canTransform || transformResult || isGenerating || autoFallbackRequestedRef.current) return;

    const timer = setTimeout(() => {
      autoFallbackRequestedRef.current = true;
      void handleGenerateTransform();
    }, 1200 + index * 180);

    return () => clearTimeout(timer);
  }, [canTransform, handleGenerateTransform, index, isGenerating, transformResult]);

  return (
    <div
      className={`rounded-xl transition-all duration-200 ${
        defaultExpanded ? '' : `border ${cfg.border} ${expanded ? 'shadow-md' : 'shadow-sm hover:shadow-md'}`
      }`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* Header — hidden when opened via tab slider */}
      {!defaultExpanded && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-4 py-3 sm:px-5 sm:py-4 text-left hover:bg-gray-50/50 transition-colors border-l-4 border-l-emerald-500 rounded-t-xl"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span className="text-base sm:text-lg font-semibold text-gray-900 shrink-0">
                {featureLabel(feature.name)}
              </span>
              <span
                className="inline-flex items-center"
                title={cfg.label}
                aria-label={cfg.label}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] sm:text-xs text-gray-400 tabular-nums">
                {Math.round(effectiveConf * 100)}%
              </span>
              <svg
                className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </div>
          </div>
        </button>
      )}

      {/* Expandable content */}
      {expanded && (
        <div className={`px-4 pb-4 sm:px-5 sm:pb-5 rounded-b-xl ${defaultExpanded ? '' : 'border-t border-gray-100 border-l border-l-emerald-200'}`}>

          {/* Proportions */}
          {proportions && proportions.items.length > 0 && (
            <div className="mt-3 sm:mt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
                {t('featureCard.proportions')}
              </h4>
              <p className="text-[11px] text-gray-400 mb-2">{t('featureCard.proportionsDesc')}</p>

              {/* Profile angle visualization — Nose card only */}
              {feature.name === 'Nose' && (() => {
                const leftLm = profileLandmarks?.left ?? null;
                const rightLm = profileLandmarks?.right ?? null;
                const leftAngles = leftLm && leftLm.length > 0 ? detectAnglesFromProfileLandmarks(leftLm) : null;
                const rightAngles = rightLm && rightLm.length > 0 ? detectAnglesFromProfileLandmarks(rightLm) : null;
                const leftSource = profileLandmarkSource?.left;
                const rightSource = profileLandmarkSource?.right;
                const leftConfidenceRaw = profileLandmarkConfidence?.left;
                const rightConfidenceRaw = profileLandmarkConfidence?.right;
                const leftConfidence = Number.isFinite(leftConfidenceRaw) ? Math.max(0, Math.min(1, Number(leftConfidenceRaw))) : 0;
                const rightConfidence = Number.isFinite(rightConfidenceRaw) ? Math.max(0, Math.min(1, Number(rightConfidenceRaw))) : 0;
                const isAngleSetPlausible = (
                  v: { nfa: number; nla: number } | null,
                ): boolean => !!(
                  v &&
                  Number.isFinite(v.nla) &&
                  v.nla >= 70 && v.nla <= 155 &&
                  // NFA is optional: degenerate silhouette may give NaN
                  (isNaN(v.nfa) || (v.nfa >= 95 && v.nfa <= 170))
                );
                const scoreSide = (
                  side: 'left' | 'right',
                  lm: NormalizedLandmark[] | null,
                  angles: { nfa: number; nla: number } | null,
                  source: 'ai' | 'contour' | 'mediapipe' | undefined,
                  confidence: number,
                ): number => {
                  const hasImage = side === 'left' ? !!profileImageDataUrls?.left : !!profileImageDataUrls?.right;
                  if (!hasImage) return -999;
                  if (!lm || lm.length === 0) return -6;

                  let score = 0;

                  if (isAngleSetPlausible(angles)) {
                    score += 2.2;
                  } else if (angles && Number.isFinite(angles.nla)) {
                    score -= Math.min(2.2, Math.abs(angles.nla - 108) / 18);
                  } else {
                    score -= 2.5;
                  }

                  if (angles && Number.isFinite(angles.nla)) {
                    const nlaDelta = Math.abs(angles.nla - 108);
                    score += Math.max(-1.4, 1.1 - nlaDelta / 30);
                    if (angles.nla < 65 || angles.nla > 160) score -= 1.2;
                  }
                  if (angles && Number.isFinite(angles.nfa)) {
                    const nfaDelta = Math.abs(angles.nfa - 132);
                    score += Math.max(-0.6, 0.6 - nfaDelta / 45);
                  }

                  // Confidence from /api/profile-landmarks should dominate side choice.
                  score += confidence * 2.4;

                  if (source === 'ai') score += 0.35;
                  else if (source === 'contour') score += 0.12;

                  return score;
                };

                const leftScore = scoreSide('left', leftLm, leftAngles, leftSource, leftConfidence);
                const rightScore = scoreSide('right', rightLm, rightAngles, rightSource, rightConfidence);

                const hasLeftLm = !!(leftLm && leftLm.length > 0);
                const hasRightLm = !!(rightLm && rightLm.length > 0);
                const hasLeftImage = !!profileImageDataUrls?.left;
                const hasRightImage = !!profileImageDataUrls?.right;

                const side: 'left' | 'right' = (() => {
                  if (hasLeftLm && !hasRightLm) return 'left';
                  if (hasRightLm && !hasLeftLm) return 'right';
                  if (hasLeftLm && hasRightLm) {
                    if (rightScore > leftScore + 0.05) return 'right';
                    if (leftScore > rightScore + 0.05) return 'left';
                    return rightConfidence > leftConfidence ? 'right' : 'left';
                  }
                  if (hasLeftImage && !hasRightImage) return 'left';
                  if (hasRightImage && !hasLeftImage) return 'right';
                  return rightConfidence > leftConfidence ? 'right' : 'left';
                })();
                const profileUrl = side === 'left' ? profileImageDataUrls?.left : profileImageDataUrls?.right;
                const profileLm = side === 'left' ? profileLandmarks?.left : profileLandmarks?.right;
                const profileSource = side === 'left' ? profileLandmarkSource?.left : profileLandmarkSource?.right;
                const maskDataUrl = side === 'left' ? profileMaskDataUrls?.left : profileMaskDataUrls?.right;
                const sideLabel = side === 'left' ? t('featureCard.leftProfile') : t('featureCard.rightProfile');
                // NFA may be NaN on near-vertical silhouettes; require only NLA
                const hasAngleMeasurements =
                  typeof feature.measurements.nasolabialAngle === 'number' &&
                  Number.isFinite(feature.measurements.nasolabialAngle as number);
                if (!profileUrl) return null;
                return (
                  <div className="mb-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <svg className="w-3 h-3 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                      </svg>
                      <span className="text-xs font-medium text-gray-600">{t('featureCard.profileAngles')}</span>
                      <span className="text-[10px] text-gray-400">{sideLabel}</span>
                    </div>
                    <div
                      className="relative rounded-xl overflow-hidden border border-gray-100 bg-gray-50"
                      style={{ height: 200 }}
                    >
                      <ProfileAngleCanvas
                        imageDataUrl={profileUrl}
                        side={side}
                        profileLandmarks={profileLm}
                        maskDataUrl={maskDataUrl}
                      />
                      {profileLm && profileSource === 'ai' && (
                        <div className="absolute top-2 right-2">
                          <span className="bg-sky-500/90 text-white text-[10px] font-medium px-2 py-0.5 rounded-full">
                            {t('featureCard.aiPoints')}
                          </span>
                        </div>
                      )}
                      {profileLm && profileSource === 'contour' && (
                        <div className="absolute top-2 right-2">
                          <span className="bg-emerald-500/90 text-white text-[10px] font-medium px-2 py-0.5 rounded-full">
                            {t('featureCard.detectorPoints')}
                          </span>
                        </div>
                      )}
                    </div>
                    <p className="mt-1 text-[9px] text-gray-400 text-center">
                      {hasAngleMeasurements
                        ? (() => {
                            const hasNfa = typeof feature.measurements.nasofrontalAngle === 'number' &&
                              Number.isFinite(feature.measurements.nasofrontalAngle as number);
                            return hasNfa
                              ? t('featureCard.angleHintFull')
                              : t('featureCard.angleHintNoNfa');
                          })()
                        : t('featureCard.angleHintNone')}
                    </p>
                  </div>
                );
              })()}

              {/* Color legend — shown once above all proportion photos */}
              {frontImageDataUrl && landmarks && landmarks.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 px-0.5">
                  <span className="text-[10px] text-gray-400 shrink-0">{t('overlay.legend.title')}</span>
                  <span className="flex items-center gap-1.5 text-[10px] text-gray-600">
                    <span className="w-3.5 h-1.5 rounded-full bg-sky-400 inline-block flex-shrink-0" />
                    {t('overlay.legend.ideal')}
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] text-gray-600">
                    <span className="w-3.5 h-1.5 rounded-full bg-amber-400 inline-block flex-shrink-0" />
                    {t('overlay.legend.close')}
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] text-gray-600">
                    <span className="w-3.5 h-1.5 rounded-full bg-rose-400 inline-block flex-shrink-0" />
                    {t('overlay.legend.deviation')}
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] text-gray-600">
                    <span className="w-3.5 h-1.5 rounded-full bg-white border border-gray-300 inline-block flex-shrink-0" />
                    {t('overlay.legend.inactive')}
                  </span>
                </div>
              )}

              <div className="space-y-4 -mx-1 sm:-mx-1.5">
                {proportions.items.map((item) => (
                  <div key={item.key}>
                    <ProportionBar
                      item={item}
                      expanded={activeProportionKey === item.key}
                      onExpandedChange={(isExpanded) => {
                        setActiveProportionKey((current) => {
                          if (isExpanded) return item.key;
                          return current === item.key ? null : current;
                        });
                      }}
                    />
                    {frontImageDataUrl && landmarks && landmarks.length > 0 && (
                      <div className="mt-2">
                        <ProportionOverlay
                          imageDataUrl={frontImageDataUrl}
                          landmarks={landmarks}
                          featureName={feature.name}
                          proportions={proportions.items}
                          activeProportionKey={item.key}
                        />
                        <p className="mt-1 text-[9px] text-gray-400 text-center">
                          {t('featureCard.proportionHint')}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {proportions.note && (
                <p className="mt-2 text-[10px] text-gray-400 italic">{proportions.note}</p>
              )}
            </div>
          )}

          {/* AI Insight */}
          {aiResult?.aiInsight && (
            <div className="mt-3 sm:mt-4 px-3 py-2.5 sm:px-4 sm:py-3 bg-violet-50 border border-violet-100 rounded-lg">
              <div className="text-sm text-violet-800 leading-relaxed space-y-1">
                {cleanAiInsight(aiResult.aiInsight, lang)
                  .split(/(?<=[.!?])\s+/)
                  .filter((s) => s.trim().length > 0 && !/\(\s*(идеал|ideal)/i.test(s))
                  .filter((s) => !isLimitationLike(s))
                  .map((sentence, i) => (
                    <p key={i}>{localizeNarrativeText(sentence.trim(), lang)}</p>
                  ))}
              </div>
            </div>
          )}

          {/* Observations */}
          <div className="mt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-1">{t('featureCard.observations')}</h4>
            <p className="text-[11px] text-gray-400 mb-2">{t('featureCard.observationsDesc')}</p>

            {/* Photo showing the full feature region in context */}
            {frontImageDataUrl && landmarks && landmarks.length > 0 && (
              <div className="mb-3">
                <ProportionOverlay
                  imageDataUrl={frontImageDataUrl}
                  landmarks={landmarks}
                  featureName={feature.name}
                  proportions={proportions?.items ?? []}
                  activeProportionKey={null}
                />
                <p className="mt-1 text-[9px] text-gray-400 text-center">{t('featureCard.proportionHint')}</p>
              </div>
            )}

            <div className="hidden sm:flex gap-2">
              <div className="flex-1 flex flex-col gap-2">
                {sanitizedObservations.filter((_, i) => i % 2 === 0).map((obs, i) => {
                  const obsKey = `obs_${i * 2}`;
                  return (
                    <ObservationCard
                      key={obsKey}
                      text={obs}
                      obsKey={obsKey}
                      expanded={activeProportionKey === obsKey}
                      onExpandedChange={(isExpanded) => {
                        setActiveProportionKey((cur) => isExpanded ? obsKey : cur === obsKey ? null : cur);
                      }}
                    />
                  );
                })}
              </div>
              <div className="flex-1 flex flex-col gap-2">
                {sanitizedObservations.filter((_, i) => i % 2 !== 0).map((obs, i) => {
                  const obsKey = `obs_${i * 2 + 1}`;
                  return (
                    <ObservationCard
                      key={obsKey}
                      text={obs}
                      obsKey={obsKey}
                      expanded={activeProportionKey === obsKey}
                      onExpandedChange={(isExpanded) => {
                        setActiveProportionKey((cur) => isExpanded ? obsKey : cur === obsKey ? null : cur);
                      }}
                    />
                  );
                })}
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:hidden">
              {sanitizedObservations.map((obs, i) => {
                const obsKey = `obs_${i}`;
                return (
                  <ObservationCard
                    key={obsKey}
                    text={obs}
                    obsKey={obsKey}
                    expanded={activeProportionKey === obsKey}
                    onExpandedChange={(isExpanded) => {
                      setActiveProportionKey((cur) => isExpanded ? obsKey : cur === obsKey ? null : cur);
                    }}
                  />
                );
              })}
            </div>
          </div>

          {/* Additional measurements (excluding metrics already shown in Proportions) */}
          {hasAdditionalMeasurements && (
            <div className="mt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-1">{t('featureCard.extraMeasurements')}</h4>
              <p className="text-[11px] text-gray-400 mb-2">{t('featureCard.extraMeasurementsDesc')}</p>
              {/* Low-confidence badge for soft-tissue profile metrics */}
              {typeof feature.measurements.softTissue_confidence === 'number' &&
                feature.measurements.softTissue_confidence < 0.35 && (
                <p className="text-[10px] text-amber-600 bg-amber-50 rounded px-2 py-1 mb-2 inline-block">
                  {t('featureCard.lowProfileAccuracy')}
                </p>
              )}

              {/* Photo showing the feature region for visual context */}
              {frontImageDataUrl && landmarks && landmarks.length > 0 && (
                <div className="mb-3">
                  <ProportionOverlay
                    imageDataUrl={frontImageDataUrl}
                    landmarks={landmarks}
                    featureName={feature.name}
                    proportions={proportions?.items ?? []}
                    activeProportionKey={null}
                  />
                  <p className="mt-1 text-[9px] text-gray-400 text-center">{t('featureCard.proportionHint')}</p>
                </div>
              )}

              <div className="hidden sm:flex gap-2">
                <div className="flex-1 flex flex-col gap-2">
                  {additionalMeasurements.filter((_, i) => i % 2 === 0).map(([key, value]) => (
                    <MeasurementCard
                      key={key}
                      measurementKey={key}
                      value={value}
                      expanded={activeProportionKey === key}
                      onExpandedChange={(isExpanded) => {
                        setActiveProportionKey((cur) => isExpanded ? key : cur === key ? null : cur);
                      }}
                    />
                  ))}
                </div>
                <div className="flex-1 flex flex-col gap-2">
                  {additionalMeasurements.filter((_, i) => i % 2 !== 0).map(([key, value]) => (
                    <MeasurementCard
                      key={key}
                      measurementKey={key}
                      value={value}
                      expanded={activeProportionKey === key}
                      onExpandedChange={(isExpanded) => {
                        setActiveProportionKey((cur) => isExpanded ? key : cur === key ? null : cur);
                      }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:hidden">
                {additionalMeasurements.map(([key, value]) => (
                  <MeasurementCard
                    key={key}
                    measurementKey={key}
                    value={value}
                    expanded={activeProportionKey === key}
                    onExpandedChange={(isExpanded) => {
                      setActiveProportionKey((cur) => isExpanded ? key : cur === key ? null : cur);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* AI Recommendations */}
          {sanitizedAiRecommendations.length > 0 ? (
            <div className="mt-4">
              <h4 className="text-sm font-medium text-violet-700 mb-2 flex items-center gap-1.5">
                <span>✦</span> {t('featureCard.aiRecommendations')}
              </h4>
              <ul className="space-y-1.5">
                {sanitizedAiRecommendations.map((rec, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-700">
                    <span className="text-violet-400 mt-1 shrink-0">&#10147;</span>
                    <span>{localizeNarrativeText(rec, lang)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">{t('featureCard.recommendations')}</h4>
              <ul className="space-y-1">
                {sanitizedRecommendations.map((rec, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-600">
                    <span className="text-brand-400 mt-1 shrink-0">&#10147;</span>
                    <span>{localizeNarrativeText(rec, lang)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Baseline recommendations (secondary when AI present) */}
          {aiResult && sanitizedRecommendations.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <h4 className="text-xs font-medium text-gray-400 mb-1.5">{t('featureCard.baseRecommendations')}</h4>
              <ul className="space-y-0.5">
                {sanitizedRecommendations.map((rec, i) => (
                  <li key={i} className="text-xs text-gray-400">&#8212; {localizeNarrativeText(rec, lang)}</li>
                ))}
              </ul>
            </div>
          )}

          {/* ─── AI Transform ─────────────────────────────────────────────── */}
          {canTransform && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                  {t('featureCard.aiVisualization')}
                </h4>
                {!transformResult && (
                  <button
                    onClick={() => void handleGenerateTransform()}
                    disabled={isGenerating}
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
                      isGenerating
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-brand-600 text-white hover:bg-brand-700'
                    }`}
                  >
                    {isGenerating ? (
                      <>
                        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        {t('featureCard.generating')}
                      </>
                    ) : (
                      t('featureCard.generate')
                    )}
                  </button>
                )}
                {transformResult && (
                  <button
                    onClick={() => { setTransformResult(null); setTransformError(null); }}
                    className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {t('featureCard.retry')}
                  </button>
                )}
              </div>

              {transformError && (
                <p className="text-xs text-red-500 mb-2 bg-red-50 px-3 py-2 rounded-lg">{transformError}</p>
              )}

              {transformResult ? (
                <div className="grid grid-cols-2 gap-2">
                  <figure className="rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                    <img src={frontImageDataUrl!} alt={t('featureCard.beforeAlt')} className="w-full object-cover" />
                    <figcaption className="text-[10px] text-gray-400 text-center py-1.5 border-t border-gray-100">{t('featureCard.beforeAlt')}</figcaption>
                  </figure>
                  <figure className="rounded-xl overflow-hidden border border-brand-200 bg-gray-50">
                    <img src={transformResult} alt={t('featureCard.afterAlt')} className="w-full object-cover" />
                    <figcaption className="text-[10px] text-brand-500 text-center py-1.5 border-t border-brand-100">{t('featureCard.afterAlt')}</figcaption>
                  </figure>
                </div>
              ) : (
                !isGenerating && (
                  <p className="text-xs text-gray-400">
                    {t('featureCard.autoGenHint')}
                  </p>
                )
              )}
            </div>
          )}

          {/* Confidence bar */}
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>{t('featureCard.overallScore')}</span>
              <span>{Math.round(effectiveConf * 100)}%</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full transition-all ${
                  effectiveConf > 0.6 ? 'bg-emerald-400' :
                  effectiveConf > 0.3 ? 'bg-amber-400' : 'bg-gray-300'
                }`}
                style={{ width: `${effectiveConf * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
