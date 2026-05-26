/**
 * ProportionOverlay
 *
 * Renders a cropped, zoomed region of the face photo with proportion
 * annotation lines drawn over it — one per FeatureName.
 *
 * No external dependencies: pure Canvas 2D API.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { NormalizedLandmark, FeatureName } from '../types';
import type { ProportionItem } from '../analysis/proportions';
import { useT } from '../lib/language';

interface Props {
  imageDataUrl: string;
  landmarks: NormalizedLandmark[];
  featureName: FeatureName;
  proportions: ProportionItem[];
  activeProportionKey?: string | null;
}

// ─── Region definition ────────────────────────────────────────────────────────

interface Region { x: number; y: number; w: number; h: number }

function estimateFaceTopYNorm(lm: NormalizedLandmark[]): number {
  const topCandidateIds = [10, 338, 297, 332, 284, 251, 389, 356, 127, 162, 21, 54, 103, 67, 109];
  const topYs = topCandidateIds
    .map((i) => lm[i]?.y)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const meshTop = topYs.length > 0 ? Math.min(...topYs) : (lm[10]?.y ?? 0);

  const browMid = ((lm[105]?.y ?? meshTop) + (lm[334]?.y ?? meshTop)) / 2;
  const noseBase = lm[2]?.y ?? browMid;
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

  return Math.max(0, Math.min(fromMesh, fromThirds));
}

function estimateForeheadTopYNorm(lm: NormalizedLandmark[]): number {
  const topCandidateIds = [10, 338, 297, 332, 284, 251, 389, 356, 127, 162, 21, 54, 103, 67, 109];
  const topYs = topCandidateIds
    .map((i) => lm[i]?.y)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const meshTop = topYs.length > 0 ? Math.min(...topYs) : (lm[10]?.y ?? 0);
  return Math.max(0, Math.min(1, meshTop));
}

function regionFromLandmarks(
  lm: NormalizedLandmark[],
  ids: number[],
  imgW: number,
  imgH: number,
  padXFrac = 0.25,
  padYFrac = 0.35,
): Region {
  const px = (i: number) => (lm[i]?.x ?? 0) * imgW;
  const py = (i: number) => (lm[i]?.y ?? 0) * imgH;
  const xs = ids.map(px);
  const ys = ids.map(py);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const rw = Math.max(x1 - x0, 10);
  const rh = Math.max(y1 - y0, 10);
  const rx = Math.max(0, x0 - rw * padXFrac);
  const ry = Math.max(0, y0 - rh * padYFrac);
  const rRight = Math.min(imgW, x1 + rw * padXFrac);
  const rBottom = Math.min(imgH, y1 + rh * padYFrac);
  return { x: rx, y: ry, w: rRight - rx, h: rBottom - ry };
}

function enforceAspect(r: Region, imgW: number, imgH: number, targetAspect = 4 / 3): Region {
  let out = { ...r };
  const current = out.w / out.h;
  if (current < targetAspect) {
    const newW = out.h * targetAspect;
    const dx = (newW - out.w) / 2;
    out = {
      x: Math.max(0, out.x - dx),
      y: out.y,
      w: Math.min(imgW, newW),
      h: out.h,
    };
  } else if (current > targetAspect) {
    const newH = out.w / targetAspect;
    const dy = (newH - out.h) / 2;
    out = {
      x: out.x,
      y: Math.max(0, out.y - dy),
      w: out.w,
      h: Math.min(imgH, newH),
    };
  }
  if (out.x + out.w > imgW) out.x = Math.max(0, imgW - out.w);
  if (out.y + out.h > imgH) out.y = Math.max(0, imgH - out.h);
  return out;
}

function getRegion(
  name: FeatureName,
  lm: NormalizedLandmark[],
  imgW: number,
  imgH: number,
): Region {
  switch (name) {
    case 'Eyebrows':
      return enforceAspect(regionFromLandmarks(lm, [70, 300, 10, 159, 386, 107, 336], imgW, imgH, 0.20, 0.60), imgW, imgH);
    case 'Eyes':
      return enforceAspect(regionFromLandmarks(lm, [70, 300, 33, 263, 144, 374, 133, 362], imgW, imgH, 0.15, 0.90), imgW, imgH);
    case 'Nose':
      return enforceAspect(regionFromLandmarks(lm, [168, 129, 358, 2, 6, 1], imgW, imgH, 0.35, 0.35), imgW, imgH);
    case 'Lips':
      return enforceAspect(regionFromLandmarks(lm, [61, 291, 13, 17, 2, 152], imgW, imgH, 0.25, 0.25), imgW, imgH);
    case 'Jaw':
      return regionFromLandmarks(lm, [10, 152, 234, 454], imgW, imgH, 0.07, 0.14);
    case 'Chin':
      return enforceAspect(regionFromLandmarks(lm, [234, 454, 2, 152], imgW, imgH, 0.12, 0.15), imgW, imgH);
    case 'Cheeks':
      return regionFromLandmarks(lm, [10, 152, 123, 352], imgW, imgH, 0.07, 0.14);
    case 'Neck':
      return enforceAspect(regionFromLandmarks(lm, [234, 454, 152], imgW, imgH, 0.20, 0.05), imgW, imgH);
    default:
      return regionFromLandmarks(lm, [10, 152, 234, 454], imgW, imgH, 0.06, 0.12);
  }
}

function getFullFaceRegion(
  lm: NormalizedLandmark[],
  imgW: number,
  imgH: number,
): Region {
  const r = regionFromLandmarks(lm, [10, 152, 234, 454, 127, 356], imgW, imgH, 0.12, 0.10);
  return enforceAspect(r, imgW, imgH, 3 / 2);
}

function getSupportRegion(
  name: FeatureName,
  lm: NormalizedLandmark[],
  imgW: number,
  imgH: number,
): Region {
  switch (name) {
    case 'Lips':
    case 'Chin':
    case 'Neck':
      return enforceAspect(regionFromLandmarks(lm, [61, 291, 2, 152, 234, 454], imgW, imgH, 0.22, 0.18), imgW, imgH);
    case 'Eyes':
    case 'Eyebrows':
      return enforceAspect(regionFromLandmarks(lm, [10, 70, 300, 33, 263, 129, 358], imgW, imgH, 0.20, 0.30), imgW, imgH);
    default:
      return getFullFaceRegion(lm, imgW, imgH);
  }
}

// ─── Annotation drawing ───────────────────────────────────────────────────────

type Pt = { x: number; y: number };
type Segment = { a: Pt; b: Pt };
type OverlayHit = { key: string; label: string; segments: Segment[] };

function pointToSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = (wx * vx + wy * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + t * vx;
  const py = a.y + t * vy;
  return Math.hypot(p.x - px, p.y - py);
}

function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  name: FeatureName,
  lm: NormalizedLandmark[],
  props: ProportionItem[],
  activeProportionKey: string | null | undefined,
  region: Region,
  dw: number,
  dh: number,
  imgW: number,
  imgH: number,
): OverlayHit[] {
  // Map normalized landmark → display canvas coords
  const c = (i: number): Pt => ({
    x: ((lm[i]?.x ?? 0) * imgW - region.x) / region.w * dw,
    y: ((lm[i]?.y ?? 0) * imgH - region.y) / region.h * dh,
  });
  const fTopYNormRaw = estimateFaceTopYNorm(lm);
  const foreheadTopYNorm = estimateForeheadTopYNorm(lm);
  const fTopDisplayYRaw = (fTopYNormRaw * imgH - region.y) / region.h * dh;
  const foreheadTopDisplayY = (foreheadTopYNorm * imgH - region.y) / region.h * dh;
  const fTopDisplayY = Math.max(fTopDisplayYRaw, foreheadTopDisplayY);
  const fTop: Pt = { x: dw * 0.5, y: Math.max(0, Math.min(dh, fTopDisplayY)) };

  // Status-coloured lookup
  const col: Record<string, string> = {};
  props.forEach((p) => {
    col[p.key] = p.status === 'ideal' ? '#38bdf8' : p.status === 'close' ? '#f59e0b' : '#fb7185';
  });
  const hasActive = !!activeProportionKey;
  const MUTED = 'rgba(255,255,255,0.30)';
  const MUTED_REF = 'rgba(255,255,255,0.15)';
  const C = (key: string, fallback = 'rgba(250,204,21,0.55)') => {
    const base = col[key] ?? fallback;
    if (!hasActive || activeProportionKey === key) return base;
    return fallback === ALPHA_REF ? MUTED_REF : MUTED;
  };
  const markerByKey: Record<string, string> = {};
  props.slice(0, 3).forEach((p, i) => {
    markerByKey[p.key] = `${i + 1}`;
  });
  const labelByKey: Record<string, string> = {};
  props.forEach((p) => {
    labelByKey[p.key] = p.label;
  });
  const hitMap = new Map<string, OverlayHit>();
  const ensureHit = (key: string) => {
    let existing = hitMap.get(key);
    if (!existing) {
      existing = { key, label: labelByKey[key] ?? key, segments: [] };
      hitMap.set(key, existing);
    }
    return existing;
  };
  const pushHit = (key: string | undefined, a: Pt, b: Pt) => {
    if (!key) return;
    ensureHit(key).segments.push({ a, b });
  };

  const ALPHA_REF = 'rgba(255,255,255,0.38)'; // faint reference lines
  const CAP = 6;
  const EPS = 0.001;
  const BASE_STROKE = Math.max(1.9, Math.min(3.0, dw / 175));

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  function parseColor(color: string): { r: number; g: number; b: number } | null {
    const s = color.trim();
    if (s.startsWith('#')) {
      let hex = s.slice(1);
      if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('');
      if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r, g, b };
      }
      return null;
    }

    const m = s.match(/^rgba?\(([^)]+)\)$/i);
    if (!m) return null;
    const parts = m[1].split(',').map((p) => Number(p.trim()));
    if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
    return { r: parts[0], g: parts[1], b: parts[2] };
  }

  function withAlpha(color: string, alpha: number): string {
    const rgb = parseColor(color);
    if (!rgb) return color;
    return `rgba(${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)},${Math.max(0, Math.min(1, alpha))})`;
  }

  function lineGlow(a: Pt, b: Pt, color: string, lw = BASE_STROKE) {
    const isRef = color === ALPHA_REF;

    const drawStroke = () => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (isRef) {
      ctx.globalAlpha = 0.78;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, lw - 0.3);
      drawStroke();
      ctx.restore();
      return;
    }

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * 0.75;
    const ny = (dx / len) * 0.75;

    // Soft tinted haze (no white underlay)
    ctx.globalAlpha = 1;
    ctx.strokeStyle = withAlpha(color, 0.18);
    ctx.lineWidth = lw + 1.9;
    drawStroke();

    // Tinted translucent body
    ctx.strokeStyle = withAlpha(color, 0.39);
    ctx.lineWidth = lw + 0.68;
    drawStroke();

    // Fine core
    ctx.strokeStyle = withAlpha(color, 0.72);
    ctx.lineWidth = Math.max(0.95, lw * 0.4);
    ctx.beginPath();
    ctx.moveTo(a.x + nx, a.y + ny);
    ctx.lineTo(b.x + nx, b.y + ny);
    ctx.stroke();
    ctx.restore();
  }

  function capDot(x: number, y: number, color: string, r = Math.max(2.6, BASE_STROKE * 1.2)) {
    const isRef = color === ALPHA_REF;
    ctx.save();
    if (isRef) {
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.7, r - 0.9), 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
      return;
    }

    // Soft tinted edge ring
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(x, y, r + 1.05, 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha(color, 0.36);
    ctx.lineWidth = 1;
    ctx.stroke();

    const g = ctx.createRadialGradient(
      x - r * 0.35,
      y - r * 0.35,
      Math.max(0.8, r * 0.2),
      x,
      y,
      r + 0.1,
    );
    g.addColorStop(0, withAlpha(color, 0.48));
    g.addColorStop(0.65, withAlpha(color, 0.30));
    g.addColorStop(1, withAlpha(color, 0.12));
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, r - 0.3), 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }

  function seg(a: Pt, b: Pt, color: string, lw = BASE_STROKE, key?: string) {
    lineGlow(a, b, color, lw);
    pushHit(key, a, b);
  }

  /** Horizontal bracket with end-caps */
  function hBracket(x1: number, x2: number, y: number, color: string, cap = CAP, key?: string) {
    seg({ x: x1, y }, { x: x2, y }, color, BASE_STROKE + 0.35, key);
    seg({ x: x1, y: y - cap }, { x: x1, y: y + cap }, color, BASE_STROKE, key);
    seg({ x: x2, y: y - cap }, { x: x2, y: y + cap }, color, BASE_STROKE, key);
    capDot(x1, y, color, 2.1);
    capDot(x2, y, color, 2.1);
  }

  /** Vertical bracket with end-caps */
  function vBracket(x: number, y1: number, y2: number, color: string, cap = CAP, key?: string) {
    seg({ x, y: y1 }, { x, y: y2 }, color, BASE_STROKE + 0.35, key);
    seg({ x: x - cap, y: y1 }, { x: x + cap, y: y1 }, color, BASE_STROKE, key);
    seg({ x: x - cap, y: y2 }, { x: x + cap, y: y2 }, color, BASE_STROKE, key);
    capDot(x, y1, color, 2.1);
    capDot(x, y2, color, 2.1);
  }

  /** Polyline through landmark indices */
  function poly(ids: number[], color: string, lw = BASE_STROKE, key?: string) {
    if (ids.length < 2) return;
    for (let i = 1; i < ids.length; i += 1) {
      const a = c(ids[i - 1]);
      const b = c(ids[i]);
      // Skip degenerate segment artifacts.
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < EPS) continue;
      seg(a, b, color, lw, key);
    }
  }

  /** Dashed horizontal line across full width */
  function hLine(y: number, color: string) {
    ctx.save();
    const isRef = color === ALPHA_REF;
    ctx.setLineDash(isRef ? [3, 6] : [5, 5]);
    if (isRef) {
      ctx.globalAlpha = 0.82;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(dw, y);
      ctx.stroke();
    } else {
      lineGlow({ x: 0, y }, { x: dw, y }, color, BASE_STROKE - 0.1);
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  function marker(key: string, x: number, y: number, color: string) {
    if (hasActive && activeProportionKey !== key) return;
    const text = markerByKey[key];
    if (!text) return;
    ctx.save();
    ctx.font = '700 10px ui-sans-serif, system-ui, -apple-system';
    const padX = 5;
    const h = 14;
    const w = Math.max(14, ctx.measureText(text).width + padX * 2);
    const grad = ctx.createLinearGradient(x, y - h / 2, x, y + h / 2);
    grad.addColorStop(0, 'rgba(15,23,42,0.70)');
    grad.addColorStop(1, 'rgba(30,41,59,0.62)');
    ctx.fillStyle = grad;
    ctx.strokeStyle = 'rgba(250,204,21,0.32)';
    ctx.lineWidth = 1;
    ctx.shadowColor = 'rgba(15,23,42,0.35)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, 7);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }

  switch (name) {
    case 'Eyebrows': {
      // Right brow arc
      poly([70, 63, 105, 66, 107], C('rightArchAngle'), 2, 'rightArchAngle');
      // Left brow arc
      poly([300, 293, 334, 296, 336], C('leftArchAngle'), 2, 'leftArchAngle');
      // Brow-eye vertical bracket (right side)
      const browPeakR = c(105);
      const eyeTopR = c(159);
      vBracket(browPeakR.x, browPeakR.y, eyeTopR.y, C('browToEyeDistance'), 5, 'browToEyeDistance');
      // Brow-eye vertical bracket (left side)
      const browPeakL = c(334);
      const eyeTopL = c(386);
      vBracket(browPeakL.x, browPeakL.y, eyeTopL.y, C('browToEyeDistance'), 5, 'browToEyeDistance');
      // Measured zone highlight between brow and eye level
      const zoneTop = Math.min(browPeakR.y, browPeakL.y, eyeTopR.y, eyeTopL.y);
      const zoneBottom = Math.max(browPeakR.y, browPeakL.y, eyeTopR.y, eyeTopL.y);
      const zoneColor = C('browToEyeDistance');
      ctx.save();
      const zoneGrad = ctx.createLinearGradient(0, zoneTop, 0, zoneBottom);
      zoneGrad.addColorStop(0, 'rgba(255,255,255,0.02)');
      zoneGrad.addColorStop(0.5, `${zoneColor}22`);
      zoneGrad.addColorStop(1, 'rgba(255,255,255,0.02)');
      ctx.fillStyle = zoneGrad;
      ctx.fillRect(0, zoneTop, dw, Math.max(0, zoneBottom - zoneTop));
      ctx.restore();
      // Horizontal reference at brow level
      hLine((browPeakR.y + browPeakL.y) / 2, ALPHA_REF);
      // Horizontal reference at eye level
      hLine((eyeTopR.y + eyeTopL.y) / 2, ALPHA_REF);
      break;
    }

    case 'Eyes': {
      // Eye width brackets
      const reO = c(33); const reI = c(133);
      const leI = c(362); const leO = c(263);
      const eyeMidY = (reO.y + reI.y + leI.y + leO.y) / 4;
      hBracket(reO.x, reI.x, eyeMidY - 14, C('rightEAR'), CAP, 'rightEAR');
      hBracket(leI.x, leO.x, eyeMidY - 14, C('leftEAR'), CAP, 'leftEAR');
      marker('rightEAR', (reO.x + reI.x) / 2, eyeMidY - 24, C('rightEAR'));
      // Eye height brackets
      const reTop = c(159); const reBot = c(145);
      const leTop = c(386); const leBot = c(374);
      const rMidX = (reO.x + reI.x) / 2;
      const lMidX = (leI.x + leO.x) / 2;
      vBracket(rMidX, reTop.y, reBot.y, C('rightEAR'), CAP, 'rightEAR');
      vBracket(lMidX, leTop.y, leBot.y, C('leftEAR'), CAP, 'leftEAR');
      // Intercanthal bracket
      const icdY = (reI.y + leI.y) / 2 + 16;
      hBracket(reI.x, leI.x, icdY, C('intercanthalToEyeWidth'), CAP, 'intercanthalToEyeWidth');
      marker('intercanthalToEyeWidth', (reI.x + leI.x) / 2, icdY - 10, C('intercanthalToEyeWidth'));
      // Biocular width bracket (outer to outer) — faint reference
      hBracket(reO.x, leO.x, icdY + 12, C('facialWidthToEyeWidth', ALPHA_REF), CAP, 'facialWidthToEyeWidth');
      break;
    }

    case 'Nose': {
      const rAlar = c(129); const lAlar = c(358);
      const rInner = c(133); const lInner = c(362);
      const bridge = c(6); const sub = c(2);
      const fBot = c(152);

      // Alar width
      const alarY = (rAlar.y + lAlar.y) / 2;
      hBracket(rAlar.x, lAlar.x, alarY + 8, C('alarWidthToIntercanthal'), 5, 'alarWidthToIntercanthal');
      marker('alarWidthToIntercanthal', (rAlar.x + lAlar.x) / 2, alarY + 20, C('alarWidthToIntercanthal'));
      // Intercanthal reference line (for ratio comparison)
      const icdY = (rInner.y + lInner.y) / 2;
      ctx.save();
      ctx.setLineDash([3, 4]);
      hBracket(rInner.x, lInner.x, icdY - 8, C('alarWidthToIntercanthal', ALPHA_REF), 4, 'alarWidthToIntercanthal');
      ctx.setLineDash([]);
      ctx.restore();
      // Nose length vertical bracket
      vBracket(bridge.x + 2, bridge.y, sub.y, C('noseLengthRatio'), CAP, 'noseLengthRatio');
      marker('noseLengthRatio', bridge.x + 16, (bridge.y + sub.y) / 2, C('noseLengthRatio'));
      // Face height reference (faint vertical)
      ctx.save(); ctx.globalAlpha = 0.3;
      vBracket(bridge.x + 18, fTop.y, fBot.y, 'rgba(250,204,21,0.8)', 3);
      ctx.restore();
      // Nose ridge line
      poly([168, 6, 197, 195, 5, 4, 1], ALPHA_REF, 1);
      break;
    }

    case 'Lips': {
      const rC = c(61); const lC = c(291);
      const upperTop = c(0);
      const upperSeam = c(13);
      const lowerSeam = c(14);
      const lowerBottom = c(17);
      const rAlar = c(129); const lAlar = c(358);

      const mouthCenterX = (rC.x + lC.x) / 2;
      const mouthY = (rC.y + lC.y) / 2;
      const stomionY = (upperSeam.y + lowerSeam.y) / 2;

      // Mouth width
      hBracket(rC.x, lC.x, mouthY + 10, C('mouthWidthToIPD'), CAP, 'mouthWidthToIPD');
      marker('mouthWidthToIPD', (rC.x + lC.x) / 2, mouthY - 2, C('mouthWidthToIPD'));
      // Nose width comparison
      hBracket(rAlar.x, lAlar.x, mouthY + 22, C('mouthToNoseWidthRatio', ALPHA_REF), 4, 'mouthToNoseWidthRatio');
      // Upper/lower vermilion heights (same semantics as upperLowerRatio metric)
      vBracket(mouthCenterX - 8, upperTop.y, upperSeam.y, C('upperLowerRatio'), 5, 'upperLowerRatio');
      vBracket(mouthCenterX + 8, lowerSeam.y, lowerBottom.y, C('upperLowerRatio'), 5, 'upperLowerRatio');
      marker('upperLowerRatio', mouthCenterX + 20, mouthY, C('upperLowerRatio'));
      // Outer lip contour lines
      poly([61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291], ALPHA_REF, 1);
      poly([61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291], ALPHA_REF, 1);
      // Stomion guide (thin seam line)
      seg({ x: rC.x + 8, y: stomionY }, { x: lC.x - 8, y: stomionY }, C('upperLowerRatio', ALPHA_REF), 1, 'upperLowerRatio');
      // Corner tilt line
      seg(rC, lC, C('cornerTilt', ALPHA_REF), 1.5, 'cornerTilt');
      break;
    }

    case 'Jaw': {
      const rJ = c(234); const lJ = c(454);
      const rZ = c(123); const lZ = c(352);
      const fBot = c(152);

      // Jaw width
      hBracket(rJ.x, lJ.x, (rJ.y + lJ.y) / 2, C('jawWidthRatio'), CAP, 'jawWidthRatio');
      marker('jawWidthRatio', (rJ.x + lJ.x) / 2, (rJ.y + lJ.y) / 2 - 10, C('jawWidthRatio'));
      // Face (zygomatic) width
      hBracket(rZ.x, lZ.x, (rZ.y + lZ.y) / 2, C('vShapeProxy', ALPHA_REF), CAP, 'vShapeProxy');
      // Face height
      vBracket(dw * 0.5, fTop.y, fBot.y, C('faceHeightWidthRatio'), CAP, 'faceHeightWidthRatio');
      marker('faceHeightWidthRatio', dw * 0.5 + 14, (fTop.y + fBot.y) / 2, C('faceHeightWidthRatio'));
      // Jaw contour
      poly([234, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 454], ALPHA_REF, 1);
      // Horizontal reference at jaw angle level
      hLine((rJ.y + lJ.y) / 2, ALPHA_REF);
      break;
    }

    case 'Chin': {
      const fBot = c(152);
      const brow = c(105);   // right brow peak ~ upper-third marker
      const noseSub = c(2);  // subnasale ~ lower-third top
      const mouth = c(14);   // lower lip ~ mouth marker
      const rJ = c(234); const lJ = c(454);
      const centerX = dw * 0.5;

      // Three-thirds horizontal lines
      hLine(brow.y, C('faceThirdUpper', ALPHA_REF));
      hLine(noseSub.y, C('faceThirdMiddle', ALPHA_REF));
      // Face height bracket
      vBracket(centerX - 14, fTop.y, fBot.y, C('faceThirdLower'), CAP, 'faceThirdLower');
      // Upper third bracket
      vBracket(centerX - 22, fTop.y, brow.y, C('faceThirdUpper', ALPHA_REF), 4, 'faceThirdUpper');
      // Middle third bracket
      vBracket(centerX - 22, brow.y, noseSub.y, C('faceThirdMiddle', ALPHA_REF), 4, 'faceThirdMiddle');
      // Lower third bracket
      vBracket(centerX - 22, noseSub.y, fBot.y, C('faceThirdLower', ALPHA_REF), 4, 'faceThirdLower');
      // Chin height bracket
      vBracket(rJ.x + (lJ.x - rJ.x) * 0.3, mouth.y, fBot.y, C('chinHeightRatio'), 5, 'chinHeightRatio');
      // Lower face sub-ratio (nose-mouth vs mouth-chin)
      const noseBase = c(2);
      vBracket(centerX + 14, noseBase.y, mouth.y, C('lowerFaceRatio', ALPHA_REF), 4, 'lowerFaceRatio');
      vBracket(centerX + 22, mouth.y, fBot.y, C('lowerFaceRatio', ALPHA_REF), 4, 'lowerFaceRatio');
      // Jaw contour faint
      poly([234, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 454], ALPHA_REF, 1);
      break;
    }

    case 'Cheeks': {
      const rZ = c(123); const lZ = c(352);
      const rBio = c(33);  const lBio = c(263); // biocular = eye outer corners
      const fBot = c(152);

      // Face width (zygomatic)
      hBracket(rZ.x, lZ.x, (rZ.y + lZ.y) / 2, C('faceHeightWidthRatio'), CAP, 'faceHeightWidthRatio');
      marker('faceHeightWidthRatio', (rZ.x + lZ.x) / 2, (rZ.y + lZ.y) / 2 - 10, C('faceHeightWidthRatio'));
      // Biocular width
      hBracket(rBio.x, lBio.x, (rBio.y + lBio.y) / 2 - 10, C('biocularToFaceWidth'), CAP, 'biocularToFaceWidth');
      // Face height reference
      vBracket(dw * 0.5, fTop.y, fBot.y, C('faceHeightWidthRatio', ALPHA_REF), CAP, 'faceHeightWidthRatio');
      // Malar zone highlight (dots on cheek centers)
      [c(187), c(411)].forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,200,80,0.85)';
        ctx.fill();
      });
      // Jaw contour faint
      poly([234, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 454], ALPHA_REF, 1);
      break;
    }

    case 'Neck': {
      const chin = c(152);
      const rJ = c(234); const lJ = c(454);
      const centerX = (rJ.x + lJ.x) / 2;

      // Jaw contour
      poly([234, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 454], ALPHA_REF, 1.5);
      // Horizontal at jaw angle line
      hLine((rJ.y + lJ.y) / 2, C('submentalContourProxyAngle', ALPHA_REF));
      // Vertical center
      ctx.save(); ctx.globalAlpha = 0.25;
      seg({ x: centerX, y: 0 }, { x: centerX, y: dh }, '#facc15', 1);
      ctx.restore();
      // Angle arc hint at chin center
      const arcR = Math.min(dw, dh) * 0.15;
      ctx.strokeStyle = C('submentalContourProxyAngle');
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(chin.x, chin.y, arcR, -Math.PI * 0.15, Math.PI * 0.15);
      ctx.stroke();
      pushHit('submentalContourProxyAngle', { x: chin.x - arcR, y: chin.y }, { x: chin.x + arcR, y: chin.y });
      break;
    }

    default:
      break;
  }

  // ── Additional measurement annotations ──────────────────────────────────────
  // Drawn only when an extra (non-proportion) key is active
  if (hasActive && activeProportionKey && !col[activeProportionKey]) {
    const ak = activeProportionKey;
    const AC = '#f59e0b'; // amber — extra measurement highlight colour

    // Common landmark shortcuts
    const rOuterE = c(33);  const lOuterE = c(263);
    const rInnerE = c(133); const lInnerE = c(362);
    const rEyeTop = c(159); const lEyeTop = c(386);
    const rEyeBot = c(145); const lEyeBot = c(374);
    const rBrowIn = c(70);  const lBrowIn = c(300);
    const rBrowPk = c(105); const lBrowPk = c(334);
    const rBrowOt = c(107); const lBrowOt = c(336);
    const rIris   = c(468); const lIris   = c(473);
    const mCorR   = c(61);  const mCorL   = c(291);
    const chinTip = c(152);
    const rJawA   = c(234); const lJawA   = c(454);
    const nAlarR  = c(129); const nAlarL  = c(358);
    const stomion = c(13);
    const ctrX    = (rJawA.x + lJawA.x) / 2;

    switch (ak) {
      // ── Eyebrows ─────────────────────────────────────────────────────────
      case 'rightLengthProxy':
        seg(rBrowIn, rBrowOt, AC, 2.5, ak);
        capDot(rBrowIn.x, rBrowIn.y, AC); capDot(rBrowOt.x, rBrowOt.y, AC);
        break;
      case 'leftLengthProxy':
        seg(lBrowIn, lBrowOt, AC, 2.5, ak);
        capDot(lBrowIn.x, lBrowIn.y, AC); capDot(lBrowOt.x, lBrowOt.y, AC);
        break;
      case 'browToEyeDistance':
        seg(rBrowPk, c(160), AC, 2, ak); seg(lBrowPk, c(385), AC, 2, ak);
        capDot(rBrowPk.x, rBrowPk.y, AC); capDot(lBrowPk.x, lBrowPk.y, AC);
        break;

      // ── Eyes ─────────────────────────────────────────────────────────────
      case 'rightEAR':
        seg(rEyeTop, rEyeBot, AC, 2.5, ak);
        seg(rOuterE, rInnerE, withAlpha(AC, 0.4), 1.5);
        capDot(rEyeTop.x, rEyeTop.y, AC); capDot(rEyeBot.x, rEyeBot.y, AC);
        break;
      case 'leftEAR':
        seg(lEyeTop, lEyeBot, AC, 2.5, ak);
        seg(lOuterE, lInnerE, withAlpha(AC, 0.4), 1.5);
        capDot(lEyeTop.x, lEyeTop.y, AC); capDot(lEyeBot.x, lEyeBot.y, AC);
        break;
      case 'rightWidthRatio':
        hBracket(rOuterE.x, rInnerE.x, (rOuterE.y + rInnerE.y) / 2, AC, 4, ak);
        break;
      case 'leftWidthRatio':
        hBracket(lOuterE.x, lInnerE.x, (lOuterE.y + lInnerE.y) / 2, AC, 4, ak);
        break;
      case 'interpupillaryDistance':
        hBracket(rIris.x, lIris.x, (rIris.y + lIris.y) / 2, AC, 4, ak);
        capDot(rIris.x, rIris.y, AC, 3.5); capDot(lIris.x, lIris.y, AC, 3.5);
        break;
      case 'intercanthalToEyeWidth':
        hBracket(rInnerE.x, lInnerE.x, (rInnerE.y + lInnerE.y) / 2, AC, 4, ak);
        break;
      case 'facialWidthToEyeWidth':
        hBracket(rOuterE.x, lOuterE.x, (rOuterE.y + lOuterE.y) / 2, AC, 4, ak);
        break;
      case 'canthalTiltRight':
        seg(rOuterE, rInnerE, AC, 2, ak);
        capDot(rOuterE.x, rOuterE.y, AC); capDot(rInnerE.x, rInnerE.y, AC);
        break;
      case 'canthalTiltLeft':
        seg(lOuterE, lInnerE, AC, 2, ak);
        capDot(lOuterE.x, lOuterE.y, AC); capDot(lInnerE.x, lInnerE.y, AC);
        break;
      case 'canthalTiltAvg':
        seg(rOuterE, rInnerE, AC, 2, ak);
        seg(lOuterE, lInnerE, AC, 2, ak);
        capDot(rOuterE.x, rOuterE.y, AC); capDot(rInnerE.x, rInnerE.y, AC);
        capDot(lOuterE.x, lOuterE.y, AC); capDot(lInnerE.x, lInnerE.y, AC);
        break;

      // ── Nose ─────────────────────────────────────────────────────────────
      case 'alarWidthToIPD':
        hBracket(nAlarR.x, nAlarL.x, (nAlarR.y + nAlarL.y) / 2, AC, 4, ak);
        hBracket(rIris.x, lIris.x, (rIris.y + lIris.y) / 2, withAlpha(AC, 0.45), 4);
        break;
      case 'alarWidthToIntercanthal':
        hBracket(nAlarR.x, nAlarL.x, (nAlarR.y + nAlarL.y) / 2, AC, 4, ak);
        hBracket(rInnerE.x, lInnerE.x, (rInnerE.y + lInnerE.y) / 2, withAlpha(AC, 0.45), 4);
        break;

      // ── Face / Cheeks ─────────────────────────────────────────────────────
      case 'biocularToFaceWidth':
        hBracket(rOuterE.x, lOuterE.x, (rOuterE.y + lOuterE.y) / 2, AC, 4, ak);
        break;
      case 'jawWidthRatio':
        hBracket(c(172).x, c(397).x, (c(172).y + c(397).y) / 2, AC, 4, ak);
        break;
      case 'vShapeProxy':
        seg(rJawA, chinTip, AC, 2, ak); seg(lJawA, chinTip, AC, 2, ak);
        capDot(chinTip.x, chinTip.y, AC);
        break;
      case 'faceHeightWidthRatio':
        vBracket(ctrX, Math.max(0, c(10).y), chinTip.y, AC, 4, ak);
        break;
      case 'symmetryIndex':
        seg({ x: ctrX, y: 0 }, { x: ctrX, y: dh }, AC, 1.5, ak);
        break;

      // ── Lips ─────────────────────────────────────────────────────────────
      case 'upperLowerRatio': {
        const upperTop = c(0); const seam = c(13); const lowerBot = c(17);
        seg(upperTop, seam, AC, 2, ak);
        seg(seam, lowerBot, withAlpha(AC, 0.55), 2);
        capDot(upperTop.x, upperTop.y, AC);
        capDot(seam.x, seam.y, AC);
        capDot(lowerBot.x, lowerBot.y, AC);
        break;
      }
      case 'mouthWidthToIPD':
        hBracket(mCorR.x, mCorL.x, (mCorR.y + mCorL.y) / 2, AC, 4, ak);
        hBracket(rIris.x, lIris.x, (rIris.y + lIris.y) / 2, withAlpha(AC, 0.45), 4);
        break;
      case 'mouthToNoseWidthRatio':
        hBracket(mCorR.x, mCorL.x, (mCorR.y + mCorL.y) / 2, AC, 4, ak);
        hBracket(nAlarR.x, nAlarL.x, (nAlarR.y + nAlarL.y) / 2, withAlpha(AC, 0.45), 4);
        break;
      case 'cornerTilt':
        seg(mCorR, mCorL, AC, 2, ak);
        capDot(mCorR.x, mCorR.y, AC); capDot(mCorL.x, mCorL.y, AC);
        break;

      // ── Chin ─────────────────────────────────────────────────────────────
      case 'chinHeightRatio':
        vBracket(ctrX, stomion.y, chinTip.y, AC, 4, ak);
        break;

      default:
        break;
    }
  }

  ctx.restore();
  return Array.from(hitMap.values()).filter((h) => h.segments.length > 0);
}

function drawGlobalBlueprint(
  ctx: CanvasRenderingContext2D,
  lm: NormalizedLandmark[],
  region: Region,
  dw: number,
  dh: number,
  imgW: number,
  imgH: number,
) {
  const c = (i: number): Pt => ({
    x: ((lm[i]?.x ?? 0) * imgW - region.x) / region.w * dw,
    y: ((lm[i]?.y ?? 0) * imgH - region.y) / region.h * dh,
  });
  const top = c(10);
  const chin = c(152);
  const rJaw = c(234);
  const lJaw = c(454);
  const rBrow = c(105);
  const lBrow = c(334);
  const noseBase = c(2);
  const centerX = (rJaw.x + lJaw.x) / 2;
  const browY = (rBrow.y + lBrow.y) / 2;

  ctx.save();
  ctx.strokeStyle = 'rgba(226,232,240,0.78)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(centerX, Math.max(0, top.y - 8));
  ctx.lineTo(centerX, Math.min(dh, chin.y + 8));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(56,189,248,0.88)';
  ctx.lineWidth = 1.35;
  ctx.beginPath();
  ctx.moveTo(rJaw.x, browY);
  ctx.lineTo(lJaw.x, browY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(centerX, top.y);
  ctx.lineTo(centerX, chin.y);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(226,232,240,0.52)';
  ctx.lineWidth = 1;
  [browY, noseBase.y].forEach((y) => {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(dw, y);
    ctx.stroke();
  });

  ctx.fillStyle = 'rgba(226,232,240,0.86)';
  ctx.font = '600 10px ui-sans-serif, system-ui, -apple-system';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('1', centerX + 6, (top.y + browY) / 2);
  ctx.fillText('2', centerX + 6, (browY + noseBase.y) / 2);
  ctx.fillText('3', centerX + 6, (noseBase.y + chin.y) / 2);
  ctx.restore();
}

function drawPanel(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  region: Region,
  x: number,
  y: number,
  w: number,
  h: number,
  drawOnTop?: () => void,
) {
  // Keep geometry faithful: match destination aspect by cropping source,
  // never by stretching.
  const targetAspect = w / h;
  const src = { ...region };
  const srcAspect = src.w / src.h;
  if (srcAspect > targetAspect) {
    const newW = src.h * targetAspect;
    const dx = (src.w - newW) / 2;
    src.x += dx;
    src.w = newW;
  } else if (srcAspect < targetAspect) {
    const newH = src.w / targetAspect;
    const dy = (src.h - newH) / 2;
    src.y += dy;
    src.h = newH;
  }

  const r = 14;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.clip();
  ctx.drawImage(img, src.x, src.y, src.w, src.h, x, y, w, h);
  const grd = ctx.createLinearGradient(x, y, x, y + h);
  grd.addColorStop(0, 'rgba(15,23,42,0.06)');
  grd.addColorStop(1, 'rgba(15,23,42,0.12)');
  ctx.fillStyle = grd;
  ctx.fillRect(x, y, w, h);
  drawOnTop?.();
  ctx.restore();
}

// ─── Component ────────────────────────────────────────────────────────────────

const DISPLAY_HEIGHT = 164; // px — fixed rendered height

export default function ProportionOverlay({
  imageDataUrl,
  landmarks,
  featureName,
  proportions,
  activeProportionKey,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitTargetsRef = useRef<OverlayHit[]>([]);
  const [activeHint, setActiveHint] = useState<{ label: string; x: number; y: number } | null>(null);
  const t = useT();

  const handleCanvasPointer = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = (event.clientX - rect.left) * (canvas.width / rect.width);
    const y = (event.clientY - rect.top) * (canvas.height / rect.height);

    const p = { x, y };
    const threshold = Math.max(12, canvas.width * 0.026);
    let best: { label: string; dist: number; px: number; py: number } | null = null;

    for (const target of hitTargetsRef.current) {
      for (const seg of target.segments) {
        const d = pointToSegmentDistance(p, seg.a, seg.b);
        if (!best || d < best.dist) {
          best = {
            label: target.label,
            dist: d,
            px: (seg.a.x + seg.b.x) / 2,
            py: (seg.a.y + seg.b.y) / 2,
          };
        }
      }
    }

    if (!best || best.dist > threshold) {
      setActiveHint(null);
      return;
    }

    const sx = rect.width / canvas.width;
    const sy = rect.height / canvas.height;
    const displayX = best.px * sx;
    const displayY = (best.py - 18) * sy;

    setActiveHint({
      label: best.label,
      x: Math.max(14, Math.min(rect.width - 14, displayX)),
      y: Math.max(16, Math.min(rect.height - 8, displayY)),
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageDataUrl || !landmarks || landmarks.length < 10) return;

    const img = new Image();
    img.onload = () => {
      const imgW = img.naturalWidth;
      const imgH = img.naturalHeight;

      const mainRegion = getRegion(featureName, landmarks, imgW, imgH);

      // Single panel — feature-specific crop with annotations
      const panelH = Math.round(DISPLAY_HEIGHT * 1.4);
      const panelW = Math.round(panelH * (mainRegion.w / mainRegion.h));
      const clampedW = Math.min(panelW, 520);

      canvas.width = clampedW;
      canvas.height = panelH;

      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, clampedW, panelH);

      drawPanel(ctx, img, mainRegion, 0, 0, clampedW, panelH, () => {
        hitTargetsRef.current = drawAnnotations(
          ctx,
          featureName,
          landmarks,
          proportions,
          activeProportionKey,
          mainRegion,
          clampedW,
          panelH,
          imgW,
          imgH,
        );
      });
      setActiveHint(null);
    };
    img.src = imageDataUrl;
  }, [imageDataUrl, landmarks, featureName, proportions, activeProportionKey]);

  return (
    <div className="flex justify-center">
      <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50 inline-block">
        <div className="relative">
          <canvas
            ref={canvasRef}
            className="block cursor-pointer"
            style={{ maxWidth: '100%', height: 'auto' }}
            aria-label={t('overlay.ariaLabel').replace('{feature}', featureName)}
            onPointerDown={handleCanvasPointer}
          />
          {activeHint && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-white/45 bg-slate-900/78 px-2.5 py-1 text-[11px] font-medium text-white shadow-md backdrop-blur-sm"
              style={{ left: activeHint.x, top: activeHint.y }}
            >
              {activeHint.label}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
