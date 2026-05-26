import { describe, it, expect } from 'vitest';
import * as M from '../metrics';
import { makeLandmarks } from './helpers';
import type { NormalizedLandmark } from '../../types';

/**
 * Apply a small rotation (roll) to landmarks around the face center.
 */
function applyRoll(lm: NormalizedLandmark[], degrees: number): NormalizedLandmark[] {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Use face center as rotation origin
  const cx = 0.5;
  const cy = 0.5;

  return lm.map((p) => ({
    x: cos * (p.x - cx) - sin * (p.y - cy) + cx,
    y: sin * (p.x - cx) + cos * (p.y - cy) + cy,
    z: p.z,
  }));
}

describe('Metric stability under head roll (±15°)', () => {
  const baseLm = makeLandmarks();

  const baseNoseWidth = M.noseWidthRatio(baseLm);
  const baseNoseLength = M.noseLengthRatio(baseLm);
  const baseEAR = M.eyeAspectRatio(baseLm, 'right');
  const baseIPD = M.interpupillaryDistance(baseLm);

  for (const roll of [-15, -10, -5, 5, 10, 15]) {
    const rolled = applyRoll(baseLm, roll);

    it(`noseWidthRatio varies < 30% at ${roll}° roll`, () => {
      const val = M.noseWidthRatio(rolled);
      const diff = Math.abs(val - baseNoseWidth) / baseNoseWidth;
      expect(diff).toBeLessThan(0.3);
    });

    it(`noseLengthRatio varies < 30% at ${roll}° roll`, () => {
      const val = M.noseLengthRatio(rolled);
      if (baseNoseLength > 0) {
        const diff = Math.abs(val - baseNoseLength) / baseNoseLength;
        expect(diff).toBeLessThan(0.3);
      }
    });

    it(`eyeAspectRatio varies < 40% at ${roll}° roll`, () => {
      const val = M.eyeAspectRatio(rolled, 'right');
      if (baseEAR > 0) {
        const diff = Math.abs(val - baseEAR) / baseEAR;
        expect(diff).toBeLessThan(0.4);
      }
    });

    it(`interpupillaryDistance varies < 10% at ${roll}° roll`, () => {
      const val = M.interpupillaryDistance(rolled);
      if (baseIPD > 0) {
        const diff = Math.abs(val - baseIPD) / baseIPD;
        expect(diff).toBeLessThan(0.1);
      }
    });
  }
});
