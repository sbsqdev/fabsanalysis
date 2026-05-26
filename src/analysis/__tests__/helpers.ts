/**
 * Shared test helpers: synthetic landmark generators.
 */
import type { NormalizedLandmark } from '../../types';

/**
 * Generate a synthetic 478-point landmark array.
 * Points are arranged in a rough face-like distribution.
 * @param opts.centerX  Horizontal center of face (default 0.5)
 * @param opts.centerY  Vertical center of face (default 0.5)
 * @param opts.width    Face width (default 0.3)
 * @param opts.height   Face height (default 0.5)
 */
export function makeLandmarks(opts?: {
  centerX?: number;
  centerY?: number;
  width?: number;
  height?: number;
}): NormalizedLandmark[] {
  const cx = opts?.centerX ?? 0.5;
  const cy = opts?.centerY ?? 0.5;
  const w = opts?.width ?? 0.3;
  const h = opts?.height ?? 0.5;

  const lm: NormalizedLandmark[] = [];
  for (let i = 0; i < 478; i++) {
    // Distribute points in an elliptical pattern
    const angle = (i / 478) * Math.PI * 2;
    const r = 0.3 + (i % 7) * 0.1;
    lm.push({
      x: cx + Math.cos(angle) * w * r,
      y: cy + Math.sin(angle) * h * r,
      z: (Math.random() - 0.5) * 0.05,
    });
  }

  // Override key landmarks used by metrics to create realistic positions

  // Nose tip (1) — centered, middle of face
  lm[1] = { x: cx, y: cy + 0.05, z: -0.05 };
  // Nose bridge (6)
  lm[6] = { x: cx, y: cy - 0.05, z: -0.03 };
  // Nose bottom (2)
  lm[2] = { x: cx, y: cy + 0.07, z: -0.03 };
  // Nose alars
  lm[129] = { x: cx - 0.04, y: cy + 0.06, z: 0 };
  lm[358] = { x: cx + 0.04, y: cy + 0.06, z: 0 };

  // Jaw angles
  lm[234] = { x: cx - w * 0.8, y: cy + 0.05, z: 0 };
  lm[454] = { x: cx + w * 0.8, y: cy + 0.05, z: 0 };

  // Chin tip (152)
  lm[152] = { x: cx, y: cy + h * 0.5, z: 0 };
  // Chin sides
  lm[148] = { x: cx - 0.02, y: cy + h * 0.48, z: 0 };
  lm[377] = { x: cx + 0.02, y: cy + h * 0.48, z: 0 };

  // Face top (10)
  lm[10] = { x: cx, y: cy - h * 0.5, z: 0 };

  // Forehead
  lm[109] = { x: cx - 0.06, y: cy - h * 0.4, z: 0 };
  lm[338] = { x: cx + 0.06, y: cy - h * 0.4, z: 0 };

  // Eyes
  lm[33] = { x: cx - 0.07, y: cy - 0.03, z: 0 };   // right outer
  lm[133] = { x: cx - 0.03, y: cy - 0.03, z: 0 };  // right inner
  lm[263] = { x: cx + 0.07, y: cy - 0.03, z: 0 };  // left outer
  lm[362] = { x: cx + 0.03, y: cy - 0.03, z: 0 };  // left inner
  lm[160] = { x: cx - 0.055, y: cy - 0.041, z: 0 }; // right top-medial
  lm[159] = { x: cx - 0.05, y: cy - 0.04, z: 0 };   // right top
  lm[145] = { x: cx - 0.05, y: cy - 0.02, z: 0 };   // right bottom
  lm[144] = { x: cx - 0.055, y: cy - 0.019, z: 0 }; // right bottom-medial
  lm[158] = { x: cx - 0.06, y: cy - 0.04, z: 0 };
  lm[153] = { x: cx - 0.06, y: cy - 0.02, z: 0 };
  lm[385] = { x: cx + 0.055, y: cy - 0.041, z: 0 };
  lm[386] = { x: cx + 0.05, y: cy - 0.04, z: 0 };
  lm[387] = { x: cx + 0.06, y: cy - 0.04, z: 0 };
  lm[373] = { x: cx + 0.06, y: cy - 0.02, z: 0 };
  lm[374] = { x: cx + 0.05, y: cy - 0.02, z: 0 };
  lm[380] = { x: cx + 0.06, y: cy - 0.02, z: 0 };

  // Iris centers
  lm[468] = { x: cx - 0.05, y: cy - 0.03, z: -0.01 };
  lm[473] = { x: cx + 0.05, y: cy - 0.03, z: -0.01 };

  // Eyebrows
  lm[70] = { x: cx - 0.08, y: cy - 0.07, z: 0 };
  lm[63] = { x: cx - 0.06, y: cy - 0.08, z: 0 };
  lm[105] = { x: cx - 0.05, y: cy - 0.085, z: 0 };
  lm[66] = { x: cx - 0.04, y: cy - 0.08, z: 0 };
  lm[107] = { x: cx - 0.03, y: cy - 0.07, z: 0 };
  lm[300] = { x: cx + 0.08, y: cy - 0.07, z: 0 };
  lm[293] = { x: cx + 0.06, y: cy - 0.08, z: 0 };
  lm[334] = { x: cx + 0.05, y: cy - 0.085, z: 0 };
  lm[296] = { x: cx + 0.04, y: cy - 0.08, z: 0 };
  lm[336] = { x: cx + 0.03, y: cy - 0.07, z: 0 };

  // Lips
  lm[13] = { x: cx, y: cy + 0.11, z: -0.02 };      // upper center
  lm[14] = { x: cx, y: cy + 0.13, z: -0.02 };      // lower center
  lm[61] = { x: cx - 0.04, y: cy + 0.12, z: 0 };   // right corner
  lm[291] = { x: cx + 0.04, y: cy + 0.12, z: 0 };  // left corner
  lm[0] = { x: cx, y: cy + 0.10, z: -0.02 };       // upper outer
  lm[17] = { x: cx, y: cy + 0.14, z: -0.01 };      // lower outer

  // Glabella candidates (9, 8, 168)
  lm[9] = { x: cx, y: cy - 0.08, z: -0.02 };
  lm[8] = { x: cx, y: cy - 0.07, z: -0.02 };
  lm[168] = { x: cx, y: cy - 0.06, z: -0.03 };

  // Nose dorsum (197, 195, 5, 4)
  lm[197] = { x: cx, y: cy - 0.02, z: -0.04 };
  lm[195] = { x: cx, y: cy, z: -0.045 };
  lm[5] = { x: cx, y: cy + 0.02, z: -0.048 };
  lm[4] = { x: cx, y: cy + 0.04, z: -0.049 };

  // Columella / subnasale
  lm[326] = { x: cx + 0.01, y: cy + 0.07, z: -0.02 };
  lm[97] = { x: cx - 0.01, y: cy + 0.07, z: -0.02 };
  lm[98] = { x: cx - 0.02, y: cy + 0.065, z: -0.03 };
  lm[327] = { x: cx + 0.02, y: cy + 0.065, z: -0.03 };
  lm[164] = { x: cx, y: cy + 0.08, z: -0.02 };

  // Philtrum
  lm[167] = { x: cx - 0.005, y: cy + 0.085, z: -0.02 };
  lm[165] = { x: cx + 0.005, y: cy + 0.085, z: -0.02 };
  lm[92] = { x: cx - 0.005, y: cy + 0.095, z: -0.02 };
  lm[186] = { x: cx + 0.005, y: cy + 0.095, z: -0.02 };

  // Chin soft tissue (additional)
  lm[176] = { x: cx - 0.01, y: cy + h * 0.47, z: 0 };
  lm[149] = { x: cx - 0.015, y: cy + h * 0.46, z: 0 };
  lm[150] = { x: cx - 0.02, y: cy + h * 0.45, z: 0 };
  lm[136] = { x: cx - 0.025, y: cy + h * 0.44, z: 0 };
  lm[400] = { x: cx + 0.01, y: cy + h * 0.47, z: 0 };
  lm[378] = { x: cx + 0.015, y: cy + h * 0.46, z: 0 };
  lm[379] = { x: cx + 0.02, y: cy + h * 0.45, z: 0 };

  // Malar
  lm[187] = { x: cx - 0.08, y: cy, z: 0 };
  lm[123] = { x: cx - 0.10, y: cy, z: 0 };
  lm[117] = { x: cx - 0.07, y: cy - 0.01, z: 0 };
  lm[118] = { x: cx - 0.075, y: cy - 0.005, z: 0 };
  lm[101] = { x: cx - 0.09, y: cy - 0.01, z: 0 };
  lm[411] = { x: cx + 0.08, y: cy, z: 0 };
  lm[352] = { x: cx + 0.10, y: cy, z: 0 };
  lm[346] = { x: cx + 0.07, y: cy - 0.01, z: 0 };
  lm[347] = { x: cx + 0.075, y: cy - 0.005, z: 0 };
  lm[330] = { x: cx + 0.09, y: cy - 0.01, z: 0 };

  // Mentolabial (18, 175)
  lm[18] = { x: cx, y: cy + 0.15, z: -0.01 };
  lm[175] = { x: cx, y: cy + 0.17, z: 0 };

  // Jawline contour intermediate points
  lm[93] = { x: cx - w * 0.75, y: cy + 0.06, z: 0 };
  lm[132] = { x: cx - w * 0.7, y: cy + 0.08, z: 0 };
  lm[58] = { x: cx - w * 0.6, y: cy + 0.12, z: 0 };
  lm[172] = { x: cx - w * 0.5, y: cy + 0.15, z: 0 };
  lm[288] = { x: cx + w * 0.75, y: cy + 0.06, z: 0 };
  lm[361] = { x: cx + w * 0.7, y: cy + 0.08, z: 0 };
  lm[323] = { x: cx + w * 0.6, y: cy + 0.12, z: 0 };
  lm[397] = { x: cx + w * 0.5, y: cy + 0.15, z: 0 };
  lm[365] = { x: cx + w * 0.4, y: cy + 0.18, z: 0 };

  // Face contour points
  lm[127] = { x: cx - w * 0.85, y: cy - h * 0.2, z: 0 };
  lm[162] = { x: cx - w * 0.5, y: cy - h * 0.35, z: 0 };
  lm[21] = { x: cx - w * 0.3, y: cy - h * 0.4, z: 0 };
  lm[54] = { x: cx - w * 0.15, y: cy - h * 0.42, z: 0 };
  lm[103] = { x: cx - w * 0.1, y: cy - h * 0.44, z: 0 };
  lm[67] = { x: cx - w * 0.05, y: cy - h * 0.43, z: 0 };

  // Lip contour points for outer lip paths
  lm[37] = { x: cx - 0.015, y: cy + 0.10, z: -0.02 };
  lm[267] = { x: cx + 0.015, y: cy + 0.10, z: -0.02 };
  lm[82] = { x: cx - 0.01, y: cy + 0.115, z: -0.02 };
  lm[312] = { x: cx + 0.01, y: cy + 0.115, z: -0.02 };
  lm[87] = { x: cx - 0.01, y: cy + 0.125, z: -0.02 };
  lm[317] = { x: cx + 0.01, y: cy + 0.125, z: -0.02 };
  lm[84] = { x: cx - 0.012, y: cy + 0.14, z: -0.01 };
  lm[314] = { x: cx + 0.012, y: cy + 0.14, z: -0.01 };
  lm[96] = { x: cx - 0.015, y: cy + 0.14, z: -0.01 };
  lm[326] = { x: cx + 0.015, y: cy + 0.14, z: -0.01 };

  return lm;
}

/**
 * Create a "left profile" variant: nose tip shifted left of jaw midpoint.
 */
export function makeLeftProfileLandmarks(): NormalizedLandmark[] {
  const lm = makeLandmarks({ centerX: 0.4 });
  // Shift nose tip far left to simulate left profile
  lm[1].x = 0.2;
  lm[2].x = 0.22;
  lm[4].x = 0.22;
  lm[5].x = 0.23;
  return lm;
}

/**
 * Create a "right profile" variant: nose tip shifted right of jaw midpoint.
 */
export function makeRightProfileLandmarks(): NormalizedLandmark[] {
  const lm = makeLandmarks({ centerX: 0.6 });
  lm[1].x = 0.8;
  lm[2].x = 0.78;
  lm[4].x = 0.78;
  lm[5].x = 0.77;
  return lm;
}

/**
 * Mirror landmarks: x' = 1 - x (simulating selfie-mode capture).
 */
export function mirrorLandmarks(lm: NormalizedLandmark[]): NormalizedLandmark[] {
  return lm.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
}
