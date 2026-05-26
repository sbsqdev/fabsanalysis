import { describe, it, expect } from 'vitest';
// @ts-expect-error server-side ESM helper has no TypeScript declarations in app build.
import { __profileLandmarkInternals } from '../../../server/profile-landmarks-handler.mjs';

const { normalizeAiProfiles, validateIndices, inferDeterministicFromContour } = __profileLandmarkInternals;

function makeSyntheticLeftContour(width = 320, n = 220): { x: number; y: number }[] {
  const gauss = (x: number, c: number, s: number, a: number) => a * Math.exp(-((x - c) ** 2) / (2 * s * s));
  const contour: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const y = 20 + i;
    // Build projection (distance from far edge) with cephalometric-like shape.
    const projection =
      42 +
      gauss(i, 32, 9, 11) +      // glabella peak
      gauss(i, 95, 10, 24) +     // pronasale peak
      gauss(i, 142, 10, 10) +    // labiale superius peak
      gauss(i, 185, 12, 14) -    // pogonion peak
      gauss(i, 62, 8, 15) -      // nasion valley
      gauss(i, 126, 10, 13);     // subnasale valley

    const x = Math.max(1, Math.min(width - 2, width - 1 - projection));
    contour.push({ x, y });
  }
  return contour;
}

describe('profile-landmarks backend internals', () => {
  it('normalizes AI response with strict required keys', () => {
    const parsed = {
      profiles: [
        {
          side: 'left',
          overallConfidence: 0.82,
          landmarks: {
            g: { index: 10, confidence: 0.8 },
            n: { index: 20, confidence: 0.8 },
            prn: { index: 35, confidence: 0.9 },
            cm: { index: 40, confidence: 0.7 },
            sn: { index: 48, confidence: 0.8 },
            ls: { index: 55, confidence: 0.7 },
            pg: { index: 75, confidence: 0.8 },
          },
        },
      ],
    };

    const normalized = normalizeAiProfiles(parsed);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].side).toBe('left');
    expect(normalized[0].indices.prn).toBe(35);
    expect(normalized[0].overallConfidence).toBeCloseTo(0.82, 3);
  });

  it('rejects invalid order in index validation', () => {
    const contour = makeSyntheticLeftContour();
    const bad = { g: 10, n: 25, prn: 50, cm: 45, sn: 40, ls: 60, pg: 90 };
    const result = validateIndices(bad, contour, 320, 280, 'left');
    expect(result.ok).toBe(false);
  });

  it('produces deterministic landmarks from contour', () => {
    const contour = makeSyntheticLeftContour();
    const det = inferDeterministicFromContour(contour, 320, 'left');
    expect(det).not.toBeNull();
    if (!det) return;

    const { g, n, prn, cm, sn, ls, pg } = det.indices;
    expect(g).toBeLessThan(n);
    expect(n).toBeLessThan(prn);
    expect(prn).toBeLessThan(cm);
    expect(cm).toBeLessThan(sn);
    expect(sn).toBeLessThan(ls);
    expect(ls).toBeLessThan(pg);
    expect(det.overallConfidence).toBeGreaterThan(0.2);
  });
});
