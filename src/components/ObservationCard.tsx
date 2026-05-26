import { useState, useRef, useEffect } from 'react';
import { useT } from '../lib/language';
import { localizeNarrativeText } from '../lib/narrativeLocalization';
import { useLanguage } from '../lib/language';

interface Props {
  text: string;
  obsKey: string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

const DESCRIPTION_RU =
  'Это вывод на основе замеров, которые система сделала по вашей фотографии. Результат зависит от угла съёмки, освещения и выражения лица — воспринимайте его как ориентир, а не точный диагноз.';

const DESCRIPTION_EN =
  'This is a finding based on measurements taken from your photo. Results can vary with shooting angle, lighting, and facial expression — treat it as a reference point, not an exact diagnosis.';

export default function ObservationCard({ text, expanded: controlledExpanded, onExpandedChange }: Props) {
  const t = useT();
  const { lang } = useLanguage();
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
  }, [expanded]);

  const description = lang === 'en' ? DESCRIPTION_EN : DESCRIPTION_RU;

  return (
    <div
      className={
        expanded
          ? 'rounded-2xl border border-brand-200/70 bg-gradient-to-b from-brand-50/45 to-white px-2.5 py-3 sm:px-3 sm:py-3.5 shadow-[0_1px_2px_rgba(59,130,246,0.08)]'
          : 'rounded-2xl border border-gray-200/90 bg-white px-2.5 py-3 sm:px-3 sm:py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]'
      }
    >
      <p className="text-xs text-gray-600">{localizeNarrativeText(text, lang)}</p>

      <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 overflow-hidden">
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
            <p className="text-[11px] leading-relaxed text-gray-600">{description}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
