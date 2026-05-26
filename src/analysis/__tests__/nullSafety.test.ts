import { describe, it, expect } from 'vitest';
import * as M from '../metrics';
import { extractSoftTissueProfile, computeSoftTissueMetrics, fuseSoftTissueMetrics } from '../softTissueProfile';
import type { NormalizedLandmark } from '../../types';

function emptyLandmarks(count: number): NormalizedLandmark[] {
  return Array.from({ length: count }, () => ({ x: 0, y: 0, z: 0 }));
}

describe('Null safety: empty/zero landmarks don\'t crash', () => {
  it('robustMedian with empty indices returns zero point', () => {
    const lm = emptyLandmarks(478);
    const result = M.robustMedian(lm, []);
    expect(result).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('weightedCentroid with empty indices returns zero point', () => {
    const lm = emptyLandmarks(478);
    const result = M.weightedCentroid(lm, []);
    expect(result).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('noseProjectionRatio with zero landmarks returns 0', () => {
    const lm = emptyLandmarks(478);
    expect(M.noseProjectionRatio(lm)).toBe(0);
  });

  it('chinProjectionRatio with zero landmarks returns 0', () => {
    const lm = emptyLandmarks(478);
    expect(M.chinProjectionRatio(lm)).toBe(0);
  });

  it('lipProjectionRatio with zero landmarks returns 0', () => {
    const lm = emptyLandmarks(478);
    expect(M.lipProjectionRatio(lm)).toBe(0);
  });

  it('extractSoftTissueProfile with zero landmarks produces low confidence', () => {
    const lm = emptyLandmarks(478);
    const profile = extractSoftTissueProfile(lm, 'left');
    expect(profile.overallConfidence).toBeLessThan(0.3);
    expect(profile.qualityFlags.length).toBeGreaterThan(0);
  });

  it('computeSoftTissueMetrics with zero-distance profile returns valid structure', () => {
    const lm = emptyLandmarks(478);
    const profile = extractSoftTissueProfile(lm, 'left');
    const metrics = computeSoftTissueMetrics(profile);
    expect(isFinite(metrics.nasolabialAngle)).toBe(true);
    expect(isFinite(metrics.nasofrontalAngle)).toBe(true);
    expect(metrics.confidence).toBeLessThan(0.3);
  });

  it('fuseSoftTissueMetrics with both null returns null', () => {
    expect(fuseSoftTissueMetrics(null, null)).toBeNull();
  });
});
