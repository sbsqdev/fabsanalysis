import { useRef, useEffect, useState } from 'react';
import { measurementInfo } from '../i18n';
import { useT } from '../lib/language';
import type { StatusLevel } from '../types';

interface Props {
  measurementKey: string;
  value: number | string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  status?: StatusLevel;
}

// ─── Per-measurement range data ───────────────────────────────────────────────
// min/max  = full display range for the track
// normMin/normMax = "normal" (highlighted) zone
// ideal    = optional ideal point shown with a label
interface MRange { min: number; max: number; normMin: number; normMax: number; ideal?: number }

const RANGES: Record<string, MRange> = {
  // Brows
  rightArchAngle:         { min: 100, max: 180, normMin: 120, normMax: 160 },
  leftArchAngle:          { min: 100, max: 180, normMin: 120, normMax: 160 },
  symmetryIndex:          { min: 0,   max: 1,   normMin: 0.85, normMax: 1.0,  ideal: 1.0 },
  browToEyeDistance:      { min: 0,   max: 0.15, normMin: 0.02, normMax: 0.09 },
  // Eyes
  rightEAR:               { min: 0.10, max: 0.55, normMin: 0.18, normMax: 0.42 },
  leftEAR:                { min: 0.10, max: 0.55, normMin: 0.18, normMax: 0.42 },
  intercanthalToEyeWidth: { min: 0.5,  max: 1.6,  normMin: 0.7,  normMax: 1.4,  ideal: 1.0 },
  // Nose
  alarWidthToIPD:         { min: 0.3,  max: 1.2,  normMin: 0.50, normMax: 0.95 },
  alarWidthToIntercanthal:{ min: 0.5,  max: 1.7,  normMin: 0.8,  normMax: 1.35, ideal: 1.0 },
  noseLengthRatio:        { min: 0.06, max: 0.38, normMin: 0.12, normMax: 0.28 },
  nasofrontalAngle:       { min: 110,  max: 165,  normMin: 125,  normMax: 145 },
  nasolabialAngle:        { min: 75,   max: 140,  normMin: 88,   normMax: 115 },
  // Face shape
  faceHeightWidthRatio:   { min: 0.8,  max: 2.0,  normMin: 1.15, normMax: 1.58 },
  vShapeProxy:            { min: 0.5,  max: 1.4,  normMin: 0.72, normMax: 1.18 },
  jawWidthRatio:          { min: 0.4,  max: 1.0,  normMin: 0.55, normMax: 0.85 },
  gonialAngle:            { min: 100,  max: 155,  normMin: 120,  normMax: 135 },
  // Cheeks / skin
  skinUniformity:         { min: 0,   max: 1,    normMin: 0.7,  normMax: 1.0 },
  colorUniformity:        { min: 0,   max: 1,    normMin: 0.7,  normMax: 1.0 },
  rednessIndex:           { min: 0,   max: 0.15, normMin: 0,    normMax: 0.06 },
  textureVariance:        { min: 0,   max: 1000, normMin: 0,    normMax: 500 },
  brightnessVariance:     { min: 0,   max: 1000, normMin: 0,    normMax: 500 },
  // Lips
  upperLowerRatio:        { min: 0.2,  max: 1.5,  normMin: 0.45, normMax: 1.05, ideal: 0.625 },
  mouthWidthToIPD:        { min: 0.4,  max: 1.4,  normMin: 0.65, normMax: 0.92, ideal: 0.785 },
  mouthToNoseWidthRatio:  { min: 0.8,  max: 2.4,  normMin: 1.15, normMax: 1.95 },
  cornerTilt:             { min: -15,  max: 15,   normMin: -6,   normMax: 6,    ideal: 0 },
  // Chin / thirds
  chinHeightRatio:        { min: 0.05, max: 0.35, normMin: 0.10, normMax: 0.27 },
  faceThirdUpper:         { min: 0.15, max: 0.50, normMin: 0.28, normMax: 0.38, ideal: 0.333 },
  faceThirdMiddle:        { min: 0.15, max: 0.50, normMin: 0.28, normMax: 0.38, ideal: 0.333 },
  faceThirdLower:         { min: 0.15, max: 0.50, normMin: 0.28, normMax: 0.38, ideal: 0.333 },
  lowerFaceRatio:         { min: 0.1,  max: 1.1,  normMin: 0.25, normMax: 0.80 },
  // Neck / profile
  submentalContourProxyAngle: { min: 70, max: 170, normMin: 95,  normMax: 145 },
};

function toPercent(v: number, min: number, max: number) {
  return Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
}

function formatNum(v: number): string {
  if (Math.abs(v) >= 10) return v.toFixed(1);
  if (Math.abs(v) >= 1)  return v.toFixed(2);
  return v.toFixed(3);
}

// ─── Range slider component ────────────────────────────────────────────────────
function RangeSlider({
  value,
  range,
  status,
}: {
  value: number;
  range: MRange;
  status?: StatusLevel;
}) {
  const { min, max, normMin, normMax, ideal } = range;
  const valuePct   = toPercent(value, min, max);
  const normLeftPct = toPercent(normMin, min, max);
  const normWidthPct = toPercent(normMax, min, max) - normLeftPct;
  const idealPct   = ideal != null ? toPercent(ideal, min, max) : null;

  const inNorm = value >= normMin && value <= normMax;

  // Dot colour
  const dotBg =
    status === 'strength'  ? '#34d399' :  // emerald
    status === 'attention' ? '#fbbf24' :  // amber
    inNorm                 ? '#34d399' :  // emerald when in range
    '#fbbf24';                            // amber when out of range

  // Norm zone colour
  const normBg =
    status === 'strength'  ? 'rgba(52,211,153,0.20)' :
    status === 'attention' ? 'rgba(251,191,36,0.18)' :
    'rgba(52,211,153,0.20)';

  return (
    <div className="mt-2.5">
      {/* Track */}
      <div className="relative h-2 bg-gray-100 rounded-full">
        {/* Normal-range highlight */}
        <div
          className="absolute h-full rounded-full"
          style={{
            left: `${normLeftPct}%`,
            width: `${normWidthPct}%`,
            background: normBg,
          }}
        />

        {/* Ideal marker — thin vertical tick */}
        {idealPct != null && (
          <div
            className="absolute w-0.5 h-3 -translate-y-0.5 rounded-full bg-gray-300/80"
            style={{ left: `${idealPct}%`, top: '50%', transform: 'translate(-50%, -50%)' }}
          />
        )}

        {/* Value dot */}
        <div
          className="absolute w-3.5 h-3.5 rounded-full border-2 border-white shadow-sm"
          style={{
            left: `${valuePct}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            background: dotBg,
            boxShadow: `0 0 0 2px white, 0 1px 4px rgba(0,0,0,0.18)`,
          }}
        />
      </div>

      {/* Labels */}
      <div className="relative flex justify-between mt-1">
        <span className="text-[10px] text-gray-400">{formatNum(normMin)}</span>
        {idealPct != null && (
          <span
            className="absolute text-[10px] text-gray-400 -translate-x-1/2"
            style={{ left: `${idealPct}%` }}
          >
            идеал
          </span>
        )}
        <span className="text-[10px] text-gray-400">{formatNum(normMax)}</span>
      </div>
    </div>
  );
}

// ─── Simple fill bar (fallback for measurements without range data) ────────────
function FillBar({ value, status }: { value: number | string; status?: StatusLevel }) {
  const v = typeof value === 'number' ? value : parseFloat(String(value));
  let pct = 0;
  if (isFinite(v) && v >= 0) {
    if (v <= 1)   pct = v * 100;
    else if (v <= 2) pct = (v / 2) * 100;
    else pct = Math.min((v / 180) * 100, 100);
  }
  const barColor =
    status === 'strength'  ? 'bg-emerald-400' :
    status === 'attention' ? 'bg-amber-400'   :
    'bg-indigo-300';

  return (
    <div className="mt-1.5 h-1 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full ${barColor} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function MeasurementCard({
  measurementKey,
  value,
  expanded: controlledExpanded,
  onExpandedChange,
  status,
}: Props) {
  const info = measurementInfo(measurementKey);
  const t = useT();
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = typeof controlledExpanded === 'boolean' ? controlledExpanded : internalExpanded;
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  const setExpanded = (next: boolean) => {
    if (typeof controlledExpanded !== 'boolean') setInternalExpanded(next);
    onExpandedChange?.(next);
  };

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [expanded, info.description]);

  const numVal = typeof value === 'number' ? value : parseFloat(String(value));
  const hasRange = measurementKey in RANGES && isFinite(numVal);
  const range = hasRange ? RANGES[measurementKey] : null;

  const formattedValue =
    typeof value === 'number'
      ? Number.isInteger(value)
        ? value.toString()
        : value.toFixed(3)
      : value;

  const wrapperClass = expanded
    ? 'rounded-2xl border border-brand-200/70 bg-gradient-to-b from-brand-50/45 to-white px-3 py-3 sm:px-3.5 sm:py-3.5 shadow-[0_1px_2px_rgba(59,130,246,0.08)]'
    : 'rounded-2xl border border-gray-200/90 bg-white px-3 py-3 sm:px-3.5 sm:py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]';

  return (
    <div className={wrapperClass}>
      {/* Label + value row */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-600 min-w-0 truncate">{info.label}</span>
        <span className="text-xs font-mono font-semibold text-gray-900 shrink-0">{formattedValue}</span>
      </div>

      {/* Slider or fill bar */}
      {range ? (
        <RangeSlider value={numVal} range={range} status={status} />
      ) : (
        <FillBar value={value} status={status} />
      )}

      {/* Expandable description */}
      {info.description && (
        <div className="mt-2.5 rounded-xl border border-gray-200 bg-gray-50 overflow-hidden">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-label={expanded ? t('proportion.hide') : t('proportion.showMore')}
            className="w-full flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-700 transition-colors focus:outline-none"
          >
            {!expanded && <span>{t('proportion.showMore')}</span>}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              className={`w-3 h-3 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
            >
              <path
                fillRule="evenodd"
                d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </button>

          <div
            className="overflow-hidden transition-all duration-300 ease-in-out"
            style={{ maxHeight: expanded ? `${contentHeight}px` : '0px' }}
          >
            <div ref={contentRef} className="px-2.5 pt-0.5 pb-2.5 sm:px-3">
              <p className="text-[11px] leading-relaxed text-gray-600">{info.description}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
