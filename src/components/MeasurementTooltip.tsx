import { useState, useRef, useEffect } from 'react';
import { measurementInfo } from '../i18n';
import { useT } from '../lib/language';

interface Props {
  measurementKey: string;
  value: number | string;
}

export default function MeasurementTooltip({ measurementKey, value }: Props) {
  const info = measurementInfo(measurementKey);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const t = useT();

  // Close on outside click (mobile)
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="flex justify-between text-xs sm:text-sm gap-2 items-baseline">
      <span className="flex items-center gap-1.5 text-gray-500 min-w-0">
        <span className="truncate">{info.label}</span>
        {info.description && (
          <span ref={ref} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={t('tooltip.moreInfo')}
              className="text-gray-400 hover:text-amber-500 transition-colors cursor-help focus:outline-none focus:text-amber-500 flex items-center"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                <path fillRule="evenodd" d="M15 8A7 7 0 1 1 1 8a7 7 0 0 1 14 0ZM9 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM6.75 8a.75.75 0 0 0 0 1.5h.75v1.75a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8.25 8h-1.5Z" clipRule="evenodd" />
              </svg>
            </button>
            <span
              className={`
                absolute z-50
                bottom-full left-1/2 -translate-x-1/2 mb-2
                w-64 sm:w-72 p-3
                text-xs leading-relaxed text-gray-600 font-sans font-normal
                bg-white border border-gray-200 rounded-xl shadow-lg
                transition-all duration-150
                ${open ? 'opacity-100 visible' : 'opacity-0 invisible'}
                [overflow-wrap:break-word]
              `}
              style={{ pointerEvents: open ? 'auto' : 'none' }}
              role="tooltip"
            >
              {info.description}
              {/* Arrow */}
              <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-[5px] border-transparent border-t-white drop-shadow-sm" />
            </span>
          </span>
        )}
      </span>
      <span className="text-gray-900 font-mono font-medium shrink-0">
        {typeof value === 'number' ? (Number.isInteger(value) ? value : value.toFixed(3)) : value}
      </span>
    </div>
  );
}
