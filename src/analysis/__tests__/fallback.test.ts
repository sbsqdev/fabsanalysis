import { describe, it, expect } from 'vitest';
import * as F from '../features';
import { makeLandmarks } from './helpers';

describe('Fallback: null profiles = same behavior as frontal-only', () => {
  const lm = makeLandmarks();

  it('analyzeNose: identical with and without null profiles', () => {
    const base = F.analyzeNose(lm, 1);
    const withNulls = F.analyzeNose(lm, 1, false, null, null);
    expect(base.measurements).toEqual(withNulls.measurements);
    expect(base.status).toBe(withNulls.status);
  });

  it('analyzeChin: identical with and without null profiles', () => {
    const base = F.analyzeChin(lm, 1);
    const withNulls = F.analyzeChin(lm, 1, false, null, null);
    expect(base.measurements).toEqual(withNulls.measurements);
    expect(base.status).toBe(withNulls.status);
  });

  it('analyzeLips: identical with and without null profiles', () => {
    const base = F.analyzeLips(lm, 1);
    const withNulls = F.analyzeLips(lm, 1, false, null, null);
    expect(base.measurements).toEqual(withNulls.measurements);
    expect(base.status).toBe(withNulls.status);
  });

  it('analyzeJaw: identical with and without null profiles', () => {
    const base = F.analyzeJaw(lm, 1);
    const withNulls = F.analyzeJaw(lm, 1, false, null, null);
    expect(base.measurements).toEqual(withNulls.measurements);
    expect(base.status).toBe(withNulls.status);
  });

  it('analyzeCheeks: identical with and without null profiles', () => {
    const base = F.analyzeCheeks(lm, undefined, 1);
    const withNulls = F.analyzeCheeks(lm, undefined, 1, false, null, null);
    expect(base.measurements).toEqual(withNulls.measurements);
    expect(base.status).toBe(withNulls.status);
  });
});
