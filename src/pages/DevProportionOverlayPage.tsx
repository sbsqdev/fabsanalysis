import { useMemo, useState } from 'react';
import ProportionOverlay from '../components/ProportionOverlay';
import type { FeatureName, NormalizedLandmark } from '../types';
import type { ProportionItem } from '../analysis/proportions';

const FEATURE_OPTIONS: FeatureName[] = [
  'Eyebrows',
  'Eyes',
  'Nose',
  'Cheeks',
  'Jaw',
  'Lips',
  'Chin',
  'Neck',
];

const FEATURE_KEYS: Record<FeatureName, string[]> = {
  Eyebrows: ['browToEyeDistance', 'rightArchAngle', 'leftArchAngle'],
  Eyes: ['rightEAR', 'leftEAR', 'intercanthalToEyeWidth', 'facialWidthToEyeWidth'],
  Nose: ['alarWidthToIntercanthal', 'noseLengthRatio'],
  Cheeks: ['faceHeightWidthRatio', 'biocularToFaceWidth'],
  Jaw: ['jawWidthRatio', 'vShapeProxy', 'faceHeightWidthRatio'],
  Lips: ['mouthWidthToIPD', 'upperLowerRatio', 'mouthToNoseWidthRatio', 'cornerTilt'],
  Chin: ['faceThirdUpper', 'faceThirdMiddle', 'faceThirdLower', 'chinHeightRatio', 'lowerFaceRatio'],
  Skin: ['avgBrightness'],
  Neck: ['submentalContourProxyAngle'],
  Ears: ['earVisibilityScore'],
};

type PaletteMode = 'mixed' | 'ideal' | 'close' | 'deviation';

const MOCK_IMAGE_DATA_URL = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="720" viewBox="0 0 1080 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#243247"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <radialGradient id="face" cx="50%" cy="38%" r="54%">
      <stop offset="0%" stop-color="#f3d7c2"/>
      <stop offset="70%" stop-color="#eac2a7"/>
      <stop offset="100%" stop-color="#c9977a"/>
    </radialGradient>
    <linearGradient id="shirt" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0ea5e9"/>
      <stop offset="100%" stop-color="#1e3a8a"/>
    </linearGradient>
  </defs>

  <rect width="1080" height="720" fill="url(#bg)"/>
  <ellipse cx="540" cy="170" rx="250" ry="120" fill="#111827"/>
  <ellipse cx="540" cy="350" rx="270" ry="270" fill="url(#face)"/>
  <ellipse cx="540" cy="560" rx="300" ry="120" fill="url(#shirt)" opacity="0.9"/>

  <rect x="365" y="255" width="120" height="16" rx="8" fill="#2d3748"/>
  <rect x="595" y="255" width="120" height="16" rx="8" fill="#2d3748"/>
  <ellipse cx="430" cy="300" rx="36" ry="24" fill="#0f172a"/>
  <ellipse cx="650" cy="300" rx="36" ry="24" fill="#0f172a"/>
  <rect x="526" y="290" width="28" height="84" rx="14" fill="#d7aa8d" opacity="0.92"/>
  <path d="M430 430 C500 470,580 470,650 430" fill="none" stroke="#9f3b3b" stroke-width="14" stroke-linecap="round"/>
</svg>
`)}`;

function buildMockLandmarks(): NormalizedLandmark[] {
  const points: NormalizedLandmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const set = (i: number, x: number, y: number) => {
    if (i >= 0 && i < points.length) points[i] = { x, y, z: 0 };
  };

  // Forehead / face bounds
  set(10, 0.50, 0.14); set(338, 0.56, 0.15); set(297, 0.60, 0.16); set(332, 0.64, 0.19);
  set(284, 0.67, 0.22); set(251, 0.70, 0.24); set(389, 0.72, 0.28); set(356, 0.73, 0.33);
  set(127, 0.27, 0.33); set(162, 0.28, 0.28); set(21, 0.30, 0.24); set(54, 0.33, 0.22);
  set(103, 0.36, 0.19); set(67, 0.40, 0.16); set(109, 0.44, 0.15);

  // Brows
  set(70, 0.34, 0.36); set(63, 0.36, 0.34); set(105, 0.39, 0.335); set(66, 0.43, 0.34); set(107, 0.45, 0.36);
  set(300, 0.55, 0.36); set(293, 0.57, 0.34); set(334, 0.60, 0.335); set(296, 0.64, 0.34); set(336, 0.66, 0.36);

  // Eyes
  set(33, 0.34, 0.44); set(133, 0.44, 0.44); set(159, 0.39, 0.42); set(145, 0.39, 0.465);
  set(263, 0.66, 0.44); set(362, 0.56, 0.44); set(386, 0.61, 0.42); set(374, 0.61, 0.465);

  // Nose
  set(168, 0.50, 0.35); set(6, 0.50, 0.40); set(197, 0.50, 0.44); set(195, 0.50, 0.47);
  set(5, 0.50, 0.505); set(4, 0.50, 0.53); set(1, 0.50, 0.555); set(2, 0.50, 0.585);
  set(129, 0.46, 0.58); set(358, 0.54, 0.58);

  // Lips
  set(61, 0.43, 0.665); set(291, 0.57, 0.665); set(0, 0.50, 0.62); set(13, 0.50, 0.645);
  set(14, 0.50, 0.665); set(17, 0.50, 0.695); set(185, 0.45, 0.635); set(40, 0.47, 0.632);
  set(39, 0.48, 0.631); set(37, 0.49, 0.63); set(267, 0.51, 0.63); set(269, 0.52, 0.631);
  set(270, 0.53, 0.632); set(409, 0.55, 0.635); set(146, 0.45, 0.68); set(91, 0.47, 0.685);
  set(181, 0.48, 0.69); set(84, 0.49, 0.693); set(314, 0.51, 0.693); set(405, 0.52, 0.69);
  set(321, 0.53, 0.685); set(375, 0.55, 0.68);

  // Cheeks / jaw / chin contour
  set(123, 0.32, 0.54); set(352, 0.68, 0.54); set(187, 0.37, 0.58); set(411, 0.63, 0.58);
  set(234, 0.30, 0.74); set(172, 0.33, 0.78); set(136, 0.36, 0.805); set(150, 0.40, 0.825);
  set(149, 0.43, 0.835); set(176, 0.46, 0.842); set(148, 0.48, 0.846); set(152, 0.50, 0.85);
  set(377, 0.52, 0.846); set(400, 0.54, 0.842); set(378, 0.57, 0.835); set(379, 0.60, 0.825);
  set(365, 0.64, 0.805); set(397, 0.67, 0.78); set(454, 0.70, 0.74);

  return points;
}

function buildMockProportions(featureName: FeatureName, mode: PaletteMode): ProportionItem[] {
  const keys = FEATURE_KEYS[featureName] ?? ['demoMetricA', 'demoMetricB', 'demoMetricC'];
  return keys.map((key, idx) => {
    const status =
      mode === 'ideal' ? 'ideal' :
      mode === 'close' ? 'close' :
      mode === 'deviation' ? 'deviation' :
      (idx % 3 === 0 ? 'ideal' : idx % 3 === 1 ? 'close' : 'deviation');
    return {
      key,
      label: key,
      userValue: idx + 1,
      idealMin: 0,
      idealMax: 1,
      idealCenter: 0.5,
      unit: '',
      description: 'Dev preview metric',
      howToRead: 'Dev preview metric',
      whyImportant: 'Dev preview metric',
      status,
    };
  });
}

export default function DevProportionOverlayPage() {
  const [featureName, setFeatureName] = useState<FeatureName>('Eyebrows');
  const [mode, setMode] = useState<PaletteMode>('mixed');

  const landmarks = useMemo(() => buildMockLandmarks(), []);
  const proportions = useMemo(() => buildMockProportions(featureName, mode), [featureName, mode]);

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900 py-6 px-4">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h1 className="text-lg font-semibold">Dev: ProportionOverlay playground</h1>
          <p className="text-sm text-slate-500 mt-1">
            Локальная страница для теста оверлея. Работает только в dev-режиме.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="text-sm text-slate-600">
              Feature:
              <select
                value={featureName}
                onChange={(e) => setFeatureName(e.target.value as FeatureName)}
                className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
              >
                {FEATURE_OPTIONS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-600">
              Palette:
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as PaletteMode)}
                className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
              >
                <option value="mixed">mixed</option>
                <option value="ideal">all ideal</option>
                <option value="close">all close</option>
                <option value="deviation">all deviation</option>
              </select>
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <ProportionOverlay
            imageDataUrl={MOCK_IMAGE_DATA_URL}
            landmarks={landmarks}
            featureName={featureName}
            proportions={proportions}
          />
        </div>
      </div>
    </main>
  );
}

