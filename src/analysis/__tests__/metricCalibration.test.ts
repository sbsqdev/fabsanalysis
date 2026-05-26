import { describe, it, expect } from 'vitest';
import * as M from '../metrics';
import * as L from '../landmarks';
import { computeSoftTissueMetrics, extractSoftTissueProfile } from '../softTissueProfile';
import { makeLandmarks, makeLeftProfileLandmarks } from './helpers';

function d(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('Metric calibration regressions', () => {
  it('eyeAspectRatio is stable across frame aspect ratios when compensation is provided', () => {
    const square = makeLandmarks();
    square[33] = { x: 0.40, y: 0.40, z: 0 };
    square[133] = { x: 0.60, y: 0.40, z: 0 };
    square[160] = { x: 0.45, y: 0.37, z: 0 };
    square[144] = { x: 0.45, y: 0.43, z: 0 };
    square[158] = { x: 0.55, y: 0.37, z: 0 };
    square[153] = { x: 0.55, y: 0.43, z: 0 };
    square[263] = { x: 0.70, y: 0.40, z: 0 };
    square[362] = { x: 0.80, y: 0.40, z: 0 };

    const squareEar = M.eyeAspectRatio(square, 'right', 1);

    const landscape = square.map((p) => ({ ...p }));
    const compressX = (x: number) => 0.5 + (x - 0.5) / 2;
    for (const idx of [33, 133, 160, 144, 158, 153, 263, 362]) {
      landscape[idx].x = compressX(landscape[idx].x);
    }

    const rawLandscapeEar = M.eyeAspectRatio(landscape, 'right', 1);
    const correctedLandscapeEar = M.eyeAspectRatio(landscape, 'right', 2);

    expect(rawLandscapeEar).toBeGreaterThan(squareEar * 1.8);
    expect(Math.abs(correctedLandscapeEar - squareEar)).toBeLessThan(0.02);
  });

  it('mouthCornerTilt stays near 0 for a neutral horizontal mouth', () => {
    const lm = makeLandmarks();
    const tilt = M.mouthCornerTilt(lm);
    expect(Math.abs(tilt)).toBeLessThan(10);
  });

  it('lipRatio stays bounded when lower-lip inner contour collapses', () => {
    const lm = makeLandmarks();
    // Simulate a noisy frame where lower inner contour points collapse.
    for (const idx of [87, 14, 317]) {
      lm[idx].y = lm[17].y;
    }
    const ratio = M.lipRatio(lm);
    expect(Number.isFinite(ratio)).toBe(true);
    expect(ratio).toBeGreaterThan(0.1);
    expect(ratio).toBeLessThan(2.5);
  });

  it('lipRatio is near balanced for neutral synthetic lips', () => {
    const lm = makeLandmarks();
    const ratio = M.lipRatio(lm);
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.3);
  });

  it('jawWidthRatio changes when lower-jaw width changes (not constant vs face width)', () => {
    const base = makeLandmarks();
    const wider = base.map((p) => ({ ...p }));

    wider[L.JAW.rightBody].x -= 0.03;
    wider[L.JAW.leftBody].x += 0.03;

    const baseRatio = M.jawWidthRatio(base);
    const widerRatio = M.jawWidthRatio(wider);
    expect(widerRatio).toBeGreaterThan(baseRatio);
  });

  it('faceWidth is blended between zygomatic and lateral proxies', () => {
    const lm = makeLandmarks();
    const zygomatic = d(lm[L.ZYGION.right], lm[L.ZYGION.left]);
    const lateral = d(lm[L.REFERENCE.rightCheekbone], lm[L.REFERENCE.leftCheekbone]);
    const width = M.faceWidth(lm);

    expect(width).toBeGreaterThan(Math.min(zygomatic, lateral));
    expect(width).toBeLessThan(Math.max(zygomatic, lateral));
  });

  it('lowerFaceRatio uses stomion midpoint between upper/lower lip centers', () => {
    const lm = makeLandmarks();
    lm[L.NOSE.bottom].y = 0.50;
    lm[L.LIPS.upperCenter].y = 0.60;
    lm[L.LIPS.lowerCenter].y = 0.70;
    lm[L.CHIN.tip].y = 0.90;

    const ratio = M.lowerFaceRatio(lm);
    expect(ratio).toBeGreaterThan(0.55);
    expect(ratio).toBeLessThan(0.65);
  });

  it('profile nasolabial + cmSn soft-tissue metrics are finite and non-degenerate', () => {
    const profileLm = makeLeftProfileLandmarks();
    const nasolabial = M.nasolabialAngleProxy(profileLm);
    expect(Number.isFinite(nasolabial)).toBe(true);
    expect(nasolabial).toBeGreaterThan(40);
    expect(nasolabial).toBeLessThan(180);

    const profile = extractSoftTissueProfile(profileLm, 'left');
    const st = computeSoftTissueMetrics(profile);
    expect(st.cmSnRatio).toBeGreaterThan(0);
    expect(st.cmSnRatio).toBeLessThan(0.5);
  });

  it('profile metrics are stable if landmark 0 is noisy when 164/167 are present', () => {
    const lm = makeLeftProfileLandmarks();
    const baseNla = M.nasolabialAngleProxy(lm);
    const baseChin = M.chinProjectionRatio(lm, 1, 'left');
    const baseLip = M.lipProjectionRatio(lm, 1, 'left');

    // Landmark 0 can be noisy on profile frames; sn extraction should not depend on it.
    lm[0] = { x: 0.96, y: 0.10, z: 0 };

    const noisyNla = M.nasolabialAngleProxy(lm);
    const noisyChin = M.chinProjectionRatio(lm, 1, 'left');
    const noisyLip = M.lipProjectionRatio(lm, 1, 'left');

    expect(Math.abs(noisyNla - baseNla)).toBeLessThan(0.001);
    expect(Math.abs(noisyChin - baseChin)).toBeLessThan(0.001);
    expect(Math.abs(noisyLip - baseLip)).toBeLessThan(0.001);
  });
});
