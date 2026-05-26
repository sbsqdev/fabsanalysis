import { describe, it, expect } from 'vitest';
import * as M from '../metrics';
import * as L from '../landmarks';
import { makeLeftProfileLandmarks, makeRightProfileLandmarks } from './helpers';

function angleAt(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magAB = Math.hypot(abx, aby);
  const magCB = Math.hypot(cbx, cby);
  if (magAB === 0 || magCB === 0) return 0;
  const cosTheta = Math.max(-1, Math.min(1, dot / (magAB * magCB)));
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

describe('Profile metric consistency (left vs right)', () => {
  const left = makeLeftProfileLandmarks();
  const right = makeRightProfileLandmarks();

  it('noseProjectionRatio: left and right within 50% of each other', () => {
    const lVal = M.noseProjectionRatio(left);
    const rVal = M.noseProjectionRatio(right);
    expect(lVal).toBeGreaterThan(0);
    expect(rVal).toBeGreaterThan(0);
    const diff = Math.abs(lVal - rVal) / Math.max(lVal, rVal);
    expect(diff).toBeLessThan(0.5);
  });

  it('chinProjectionRatio: both produce finite values', () => {
    const lVal = M.chinProjectionRatio(left);
    const rVal = M.chinProjectionRatio(right);
    expect(isFinite(lVal)).toBe(true);
    expect(isFinite(rVal)).toBe(true);
  });

  it('lipProjectionRatio: both produce finite values', () => {
    const lVal = M.lipProjectionRatio(left);
    const rVal = M.lipProjectionRatio(right);
    expect(isFinite(lVal)).toBe(true);
    expect(isFinite(rVal)).toBe(true);
  });

  it('nasofrontalDepthProxy: both produce angles > 0', () => {
    const lVal = M.nasofrontalDepthProxy(left);
    const rVal = M.nasofrontalDepthProxy(right);
    expect(lVal).toBeGreaterThan(0);
    expect(rVal).toBeGreaterThan(0);
  });

  it('nasolabialAngleProxy: both produce angles > 0', () => {
    const lVal = M.nasolabialAngleProxy(left);
    const rVal = M.nasolabialAngleProxy(right);
    expect(lVal).toBeGreaterThan(0);
    expect(rVal).toBeGreaterThan(0);
  });

  it('side-normalized signed profile ratios keep consistent sign across left/right', () => {
    const lChin = M.chinProjectionRatio(left, 1, 'left');
    const rChin = M.chinProjectionRatio(right, 1, 'right');
    expect(lChin * rChin).toBeGreaterThanOrEqual(0);

    const lLip = M.lipProjectionRatio(left, 1, 'left');
    const rLip = M.lipProjectionRatio(right, 1, 'right');
    expect(lLip * rLip).toBeGreaterThanOrEqual(0);
  });

  it('jawProfileAngleProxy uses near jaw index for SAM-mapped landmarks', () => {
    const lm = makeLeftProfileLandmarks();
    lm[L.REFERENCE.faceTop] = { x: 0.45, y: 0.12, z: 0 };
    lm[L.NOSE.bottom] = { x: 0.30, y: 0.45, z: 0 };
    lm[L.CHIN.tip] = { x: 0.40, y: 0.90, z: 0 };
    // SAM mapping for left profile: near jaw -> rightAngle, far jaw -> leftAngle
    lm[L.JAW.rightAngle] = { x: 0.26, y: 0.72, z: 0 };
    lm[L.JAW.leftAngle] = { x: 0.82, y: 0.72, z: 0 };

    const jawAngle = M.jawProfileAngleProxy(lm, 'left');
    const expectedJaw = angleAt(lm[L.REFERENCE.faceTop], lm[L.JAW.rightAngle], lm[L.CHIN.tip]);
    expect(Math.abs(jawAngle - expectedJaw)).toBeLessThan(1e-6);

    const neckProxy = M.lowerFaceProfileAngle(lm, 'left');
    const expectedNeckProxy = angleAt(lm[L.NOSE.bottom], lm[L.CHIN.tip], lm[L.JAW.rightAngle]);
    expect(Math.abs(neckProxy - expectedNeckProxy)).toBeLessThan(1e-6);
  });

  it('fuseMetric produces valid output with both views', () => {
    const fused = M.fuseMetric(null, 0.5, 0.6);
    expect(fused.value).toBeGreaterThan(0);
    expect(fused.confidence).toBeGreaterThan(0);
    expect(fused.sourceViews).toContain('left');
    expect(fused.sourceViews).toContain('right');
  });

  it('fuseMetric works with single view', () => {
    const fused = M.fuseMetric(null, 0.5, null);
    expect(fused.value).toBe(0.5);
    expect(fused.sourceViews).toEqual(['left']);
  });
});
