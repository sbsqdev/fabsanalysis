import { describe, it, expect } from 'vitest';
import {
  normalizeLandmarksToCanonical,
  detectProfileDirection,
  validateProfileSide,
} from '../normalizeLandmarks';
import { makeLandmarks, mirrorLandmarks, makeLeftProfileLandmarks, makeRightProfileLandmarks } from './helpers';

describe('normalizeLandmarksToCanonical', () => {
  it('returns landmarks unchanged when not mirrored', () => {
    const lm = makeLandmarks();
    const result = normalizeLandmarksToCanonical(lm, 'front', false);
    expect(result).toBe(lm); // Same reference
  });

  it('flips x = 1 - x when mirrored', () => {
    const lm = makeLandmarks();
    const result = normalizeLandmarksToCanonical(lm, 'front', true);
    expect(result).not.toBe(lm);
    for (let i = 0; i < lm.length; i++) {
      expect(result[i].x).toBeCloseTo(1 - lm[i].x, 10);
      expect(result[i].y).toBe(lm[i].y);
      expect(result[i].z).toBe(lm[i].z);
    }
  });

  it('round-trips: mirror → normalize → mirror → normalize = original', () => {
    const original = makeLandmarks();
    const mirrored = mirrorLandmarks(original);
    const normalized = normalizeLandmarksToCanonical(mirrored, 'front', true);
    for (let i = 0; i < original.length; i++) {
      expect(normalized[i].x).toBeCloseTo(original[i].x, 10);
      expect(normalized[i].y).toBeCloseTo(original[i].y, 10);
    }
  });
});

describe('detectProfileDirection', () => {
  it('detects frontal face', () => {
    const lm = makeLandmarks();
    expect(detectProfileDirection(lm)).toBe('frontal');
  });

  it('detects left profile', () => {
    const lm = makeLeftProfileLandmarks();
    expect(detectProfileDirection(lm)).toBe('left');
  });

  it('detects right profile', () => {
    const lm = makeRightProfileLandmarks();
    expect(detectProfileDirection(lm)).toBe('right');
  });

  it('returns frontal for insufficient landmarks', () => {
    expect(detectProfileDirection([])).toBe('frontal');
    expect(detectProfileDirection(new Array(100).fill({ x: 0, y: 0, z: 0 }))).toBe('frontal');
  });
});

describe('validateProfileSide', () => {
  it('consistent when declared front and detected frontal', () => {
    const lm = makeLandmarks();
    const result = validateProfileSide(lm, 'front');
    expect(result.consistent).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('consistent when declared left and detected left', () => {
    const lm = makeLeftProfileLandmarks();
    const result = validateProfileSide(lm, 'left');
    expect(result.consistent).toBe(true);
  });

  it('inconsistent when declared left but detected right', () => {
    const lm = makeRightProfileLandmarks();
    const result = validateProfileSide(lm, 'left');
    expect(result.consistent).toBe(false);
    expect(result.warning).toBeTruthy();
  });
});
