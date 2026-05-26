import type { FeatureName, FeatureAnalysis } from '../types';
import { featureLabel } from '../i18n';
import { useT } from '../lib/language';

interface Props {
  features: FeatureAnalysis[];
}

interface RadarPoint {
  name: FeatureName;
  label: string;
  client: number;
  potential: number;
}

const RADAR_ORDER: FeatureName[] = [
  'Lips',
  'Jaw',
  'Cheeks',
  'Nose',
  'Eyes',
  'Eyebrows',
  'Ears',
  'Neck',
  'Skin',
  'Chin',
];

const STATUS_BASE: Record<FeatureAnalysis['status'], number> = {
  within_norm: 70,
  strength: 76,
  attention: 62,
  insufficient_data: 56,
};

const CONF_SCALE: Record<FeatureAnalysis['status'], number> = {
  within_norm: 22,
  strength: 20,
  attention: 18,
  insufficient_data: 8,
};

const POTENTIAL_GAIN: Record<FeatureAnalysis['status'], (confidence: number) => number> = {
  within_norm: () => 6,
  strength: () => 5,
  attention: (confidence) => 10 + Math.round((1 - confidence) * 10),
  insufficient_data: () => 4,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

function buildPoints(features: FeatureAnalysis[]): RadarPoint[] {
  const byName = new Map<FeatureName, FeatureAnalysis>(
    features.map((feature) => [feature.name, feature]),
  );

  return RADAR_ORDER.map((name) => {
    const feature = byName.get(name);
    if (!feature) {
      return {
        name,
        label: featureLabel(name),
        client: 20,
        potential: 40,
      };
    }

    const confidence = clamp(feature.confidence, 0, 1);
    const client = clamp(
      STATUS_BASE[feature.status] + confidence * CONF_SCALE[feature.status],
      42,
      94,
    );
    const gain = POTENTIAL_GAIN[feature.status](confidence);
    const potential = clamp(
      client + gain,
      client + 3,
      98,
    );

    return {
      name,
      label: featureLabel(name),
      client,
      potential,
    };
  });
}

export default function RadarInfographic({ features }: Props) {
  const t = useT();
  const points = buildPoints(features);
  const levels = 5;
  const width = 760;
  const height = 620;
  const cx = 380;
  const cy = 270;
  const maxRadius = 190;
  const startAngle = -Math.PI / 2;
  const angleStep = (Math.PI * 2) / points.length;

  const pointAt = (value: number, index: number) => {
    const radius = (value / 100) * maxRadius;
    const angle = startAngle + index * angleStep;
    return {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      cos: Math.cos(angle),
      sin: Math.sin(angle),
    };
  };

  const axisPoints = points.map((_, i) => pointAt(100, i));
  const clientPath = points
    .map((point, i) => {
      const p = pointAt(point.client, i);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <section className="mb-8 bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="text-base font-semibold text-gray-900">{t('radar.title')}</h3>
      </div>

      <div className="p-2 sm:p-6">
        <div className="w-full">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto"
            role="img"
            aria-label={t('radar.ariaLabel')}
          >
            <rect x="0" y="0" width={width} height={height} fill="#ffffff" />

            {Array.from({ length: levels }, (_, i) => {
              const radius = ((i + 1) / levels) * maxRadius;
              return (
                <circle
                  key={`grid-${radius}`}
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill="none"
                  stroke="#e5e7eb"
                  strokeWidth="1"
                />
              );
            })}

            {axisPoints.map((p, i) => (
              <line
                key={`axis-${i}`}
                x1={cx}
                y1={cy}
                x2={p.x}
                y2={p.y}
                stroke="#e5e7eb"
                strokeWidth="1"
              />
            ))}

            <polygon
              points={clientPath}
              fill="rgba(130, 156, 171, 0.25)"
              stroke="#7e99ab"
              strokeWidth="2"
            />

            {points.map((point, i) => {
              const anchor =
                axisPoints[i].cos > 0.25
                  ? 'start'
                  : axisPoints[i].cos < -0.25
                    ? 'end'
                    : 'middle';

              let dy = '0.35em';
              if (axisPoints[i].sin < -0.35) dy = '-0.35em';
              if (axisPoints[i].sin > 0.35) dy = '0.95em';

              const lx = cx + axisPoints[i].cos * (maxRadius + 44);
              const ly = cy + axisPoints[i].sin * (maxRadius + 44);

              return (
                <text
                  key={`label-${point.name}`}
                  x={lx}
                  y={ly}
                  textAnchor={anchor}
                  dy={dy}
                  fontSize="13"
                  fill="#6b7280"
                  fontWeight="500"
                >
                  {point.label}
                </text>
              );
            })}
          </svg>
        </div>
      </div>

      <div className="px-4 py-3 sm:px-5 sm:py-4 border-t border-gray-100 flex items-center gap-2 text-xs sm:text-sm text-gray-600">
        <span className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 border-2 border-[#7e99ab] bg-[rgba(130,156,171,0.25)]" />
        <span>{t('radar.legend')}</span>
      </div>
    </section>
  );
}
