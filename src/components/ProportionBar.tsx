import { useState, useRef, useEffect } from 'react';
import type { ProportionItem } from '../analysis/proportions';
import { useLanguage, useT } from '../lib/language';

interface Props {
  item: ProportionItem;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

interface ExtraInfo {
  standards?: string;
  celebrities?: string;
}

const KEY_GROUP: Record<string, string> = {
  rightArchAngle: 'brow_arch',
  leftArchAngle: 'brow_arch',
  browToEyeDistance: 'brow_opening',
  rightEAR: 'eye_aperture',
  leftEAR: 'eye_aperture',
  intercanthalToEyeWidth: 'eye_spacing',
  facialWidthToEyeWidth: 'eye_spacing',
  alarWidthToIntercanthal: 'nose_width',
  alarWidthToIPD: 'nose_width',
  noseLengthRatio: 'nose_width',
  noseProjectionRatio: 'nose_profile',
  nasofrontalAngle: 'nose_profile',
  nasolabialAngle: 'nose_profile',
  softTissue_nPrnRatio: 'nose_profile',
  softTissue_cmSnRatio: 'nose_profile',
  upperLowerRatio: 'lip_balance',
  mouthWidthToIPD: 'mouth_balance',
  mouthToNoseWidthRatio: 'mouth_balance',
  cornerTilt: 'lip_balance',
  lipProjectionRatio: 'lip_balance',
  softTissue_snLsRatio: 'lip_balance',
  softTissue_lipProtrusion: 'lip_balance',
  faceHeightWidthRatio: 'face_shape',
  jawWidthRatio: 'face_shape',
  vShapeProxy: 'face_shape',
  chinHeightRatio: 'face_shape',
  biocularToFaceWidth: 'face_shape',
  faceThirdUpper: 'facial_thirds',
  faceThirdMiddle: 'facial_thirds',
  faceThirdLower: 'facial_thirds',
  lowerFaceRatio: 'facial_thirds',
  chinProjectionRatio: 'chin_profile',
  softTissue_lsPgRatio: 'chin_profile',
  softTissue_gNRatio: 'chin_profile',
  submentalContourProxyAngle: 'neck_contour',
  _goldenRatioVertical: 'golden_ratio',
};

const EXTRA_INFO_RU: Record<string, ExtraInfo> = {
  brow_opening: {
    standards:
      'Европейские референсы обычно допускают более нейтральный зазор бровь-глаз и мягкую динамику верхнего века. В корейских эстетических трендах чаще стремятся к чистой, открытой зоне верхнего века и аккуратной линии брови без тяжёлого нависания.',
    celebrities:
      'В качестве референсов открытого, “свежего” взгляда часто приводят Энн Хэтэуэй и Сон Хе-гё.',
  },
  brow_arch: {
    standards:
      'В европейской эстетике чаще ценится умеренная, естественная арка с мягким изломом. В корейских трендах нередко предпочитают более прямую и деликатную линию брови, которая делает выражение спокойнее и моложе.',
    celebrities:
      'Более выраженная арка: Меган Фокс, Зендея. Более мягкая/прямая линия: АйЮ, Джису.',
  },
  eye_aperture: {
    standards:
      'Европейские ориентиры чаще допускают более “высокое” раскрытие глаза и контраст в верхнем веке. В корейских стандартах чаще ценится чистый контур глаз, горизонтальный баланс и аккуратное раскрытие без избыточной “круглости”.',
    celebrities:
      'Для более открытого взгляда часто упоминают Аманду Сейфрид; для более мягкого, вытянутого силуэта — Хан Со-хи.',
  },
  eye_spacing: {
    standards:
      'Европейские каноны обычно опираются на правило “одного глаза” между внутренними уголками. В корейских трендах допускают чуть более широкий межглазничный баланс при сохранении мягкой центральной зоны лица.',
    celebrities:
      'Сбалансированный “классический” интервал часто показывают на примерах Эммы Уотсон и Натали Портман.',
  },
  nose_width: {
    standards:
      'В европейских стандартах обычно стремятся к более узкому и чётко очерченному основанию носа. В корейских трендах чаще допускается немного более мягкая и широкая база носа при сохранении гармонии с глазами и скуловой зоной.',
    celebrities:
      'Для более узкого носового основания часто приводят Беллу Хадид; для более мягкого, естественного баланса — Пэ Су-джи.',
  },
  nose_profile: {
    standards:
      'Европейские референсы чаще подчеркивают выраженный профиль спинки и чёткий переход лоб-нос. В корейских трендах обычно предпочитают более мягкий профиль и аккуратный угол кончика без агрессивной проекции.',
    celebrities:
      'Более выраженный профиль: Адриана Лима. Более мягкий профиль: Сон Хе-гё.',
  },
  lip_balance: {
    standards:
      'Европейские ориентиры часто поддерживают умеренный объём и чёткий контур губ. В корейских трендах обычно акцент на более деликатном объёме, чистой линии Cupid’s bow и мягком переходе в профиль.',
    celebrities:
      'Более объёмный lip-balance часто иллюстрируют Анджелина Джоли; более деликатный и ровный — Ким Тхэ-ри.',
  },
  mouth_balance: {
    standards:
      'В европейских канонах ширина рта чаще балансируется относительно носа и межзрачкового расстояния. В корейских трендах визуально часто предпочитают более компактный рот при аккуратной симметрии уголков.',
    celebrities:
      'Шире и выразительнее: Джулия Робертс. Более компактный баланс: АйЮ.',
  },
  face_shape: {
    standards:
      'В европейских стандартах чаще поддерживают овально-сбалансированный контур с умеренной шириной челюсти. В корейских трендах обычно акцентируют более компактную нижнюю треть и V-line силуэт (более мягкий переход к подбородку).',
    celebrities:
      'Овальный контур: Джессика Альба, Эмма Уотсон. Более квадратный контур: Анджелина Джоли, Оливия Уайлд. Более мягкий/круглый контур: Селена Гомес.',
  },
  facial_thirds: {
    standards:
      'Европейские пропорциональные каноны часто опираются на правило трёх третей (лоб/средняя/нижняя зона близки по доле). В корейских трендах чаще визуально смягчают нижнюю треть и подчеркивают более чистую среднюю зону.',
    celebrities:
      'Сбалансированные трети часто показывают на примерах Натали Портман и Эммы Стоун.',
  },
  chin_profile: {
    standards:
      'Европейские стандарты чаще стремятся к чёткой, но не гипервыраженной проекции подбородка. В корейских трендах обычно предпочитают мягкую V-line проекцию с более деликатным контуром нижней трети.',
    celebrities:
      'Более выраженная проекция: Шарлиз Терон. Более мягкий контур: Пак Мин-ён.',
  },
  neck_contour: {
    standards:
      'В европейских референсах обычно ценится читаемый шейно-подбородочный угол с хорошей отделённостью линии челюсти. В корейских трендах также важен чистый угол, но чаще с более мягкой общей линией контура.',
    celebrities:
      'Чёткий neck-jaw contour часто показывают на примерах Киры Найтли и Сон Е-джин.',
  },
  golden_ratio: {
    standards:
      'Золотое сечение (φ) — исторический ориентир, который чаще используют как “рамку” для обсуждения гармонии. И в европейских, и в корейских современных подходах важнее общий визуальный баланс, чем точное попадание в число.',
    celebrities:
      'В медиа часто приводят разные “golden ratio” сравнения для Беллы Хадид и других знаменитостей.',
  },
};

const EXTRA_INFO_EN: Record<string, ExtraInfo> = {
  brow_opening: {
    standards:
      'European references often allow a neutral brow-to-eye gap with a soft upper-lid dynamic. Korean beauty trends more often favor a cleaner, open upper-lid zone with a neat brow line and less heavy hooding.',
    celebrities:
      'For an open, fresh eye look, references often include Anne Hathaway and Song Hye-kyo.',
  },
  brow_arch: {
    standards:
      'European aesthetics often favor a moderate natural arch with a soft peak. Korean trends frequently prefer a straighter and gentler brow line that reads calmer and younger.',
    celebrities:
      'More defined arch: Megan Fox, Zendaya. Softer/straighter line: IU, Jisoo.',
  },
  eye_aperture: {
    standards:
      'European references often tolerate a more vertically open eye and stronger upper-lid contrast. Korean standards often emphasize clean contour, horizontal balance, and controlled openness without excessive roundness.',
    celebrities:
      'For a more open look, Amanda Seyfried is often cited; for a softer elongated silhouette, Han So-hee.',
  },
  eye_spacing: {
    standards:
      'European canons typically align with the one-eye-width rule between inner canthi. Korean trends may allow a slightly wider interocular balance while preserving a soft central facial zone.',
    celebrities:
      'Balanced classic spacing is often illustrated with Emma Watson and Natalie Portman.',
  },
  nose_width: {
    standards:
      'European references often favor a narrower, more defined nasal base. Korean trends may accept a slightly softer/wider base when it remains harmonious with the eyes and cheek width.',
    celebrities:
      'A narrower nasal-base look is often referenced with Bella Hadid; a softer natural balance with Bae Suzy.',
  },
  nose_profile: {
    standards:
      'European references often emphasize a more defined dorsum profile and forehead-nose transition. Korean trends often prefer a smoother profile and a refined tip angle without excessive projection.',
    celebrities:
      'More defined profile: Adriana Lima. Softer profile: Song Hye-kyo.',
  },
  lip_balance: {
    standards:
      'European references often support moderate fullness with clearer contour definition. Korean trends often prefer a cleaner cupid’s bow and softer profile transition with controlled volume.',
    celebrities:
      'Fuller lip balance is often illustrated with Angelina Jolie; softer controlled balance with Kim Tae-ri.',
  },
  mouth_balance: {
    standards:
      'European canons often balance mouth width against nose width and interpupillary distance. Korean trends often favor a slightly more compact mouth with clean corner symmetry.',
    celebrities:
      'Wider expressive mouth example: Julia Roberts. More compact balance: IU.',
  },
  face_shape: {
    standards:
      'European standards often favor an oval-balanced contour with moderate jaw width. Korean trends typically prioritize a more compact lower third and a V-line silhouette (softer transition toward the chin).',
    celebrities:
      'Oval contour: Jessica Alba, Emma Watson. More square contour: Angelina Jolie, Olivia Wilde. Softer/round contour: Selena Gomez.',
  },
  facial_thirds: {
    standards:
      'European proportion canons often use the rule of thirds (upper/middle/lower segments close in share). Korean trends often visually soften the lower third and keep the midface cleaner and more compact.',
    celebrities:
      'Balanced-third examples are often illustrated with Natalie Portman and Emma Stone.',
  },
  chin_profile: {
    standards:
      'European references often aim for a defined but not over-projected chin. Korean trends usually prefer a softer V-line projection with a cleaner lower-third contour.',
    celebrities:
      'More projected chin profile: Charlize Theron. Softer contour profile: Park Min-young.',
  },
  neck_contour: {
    standards:
      'European references often value a readable cervicomental angle and jaw-neck separation. Korean trends also value a clean angle, typically with an overall softer contour line.',
    celebrities:
      'Clear neck-jaw contour examples often include Keira Knightley and Son Ye-jin.',
  },
  golden_ratio: {
    standards:
      'The golden ratio (φ) is mostly a historical framing tool. In both European and Korean modern aesthetics, overall visual harmony is prioritized over exact numeric matching.',
    celebrities:
      'Media frequently cites “golden ratio” comparisons for Bella Hadid and others.',
  },
};

function getExtraInfo(key: string, lang: 'ru' | 'en'): ExtraInfo | null {
  const group = KEY_GROUP[key];
  if (!group) return null;
  const bucket = lang === 'en' ? EXTRA_INFO_EN : EXTRA_INFO_RU;
  return bucket[group] ?? null;
}

/**
 * Visual proportion bar with expandable detail card.
 *
 * Layout (collapsed):
 * ┌─ Label ⓘ ──────────── Status  Value ─┐
 * │  [====|====█====|====]                │
 * │       min  ↑   max                   │
 * └───────────────────────────────────────┘
 *
 * Layout (expanded — click ⓘ):
 * ┌─ Label ⓘ ──────────── Status  Value ─┐
 * │  [====|====█====|====]                │
 * │       min  ↑   max                   │
 * ├───────────────────────────────────────┤
 * │  Что измеряется: ...                 │
 * │  Как читать: ...                     │
 * │  Почему это важно: ...               │
 * └───────────────────────────────────────┘
 */
export default function ProportionBar({ item, expanded: controlledExpanded, onExpandedChange }: Props) {
  const { label, userValue, idealMin, idealMax, unit, status, description, howToRead, whyImportant } = item;
  const t = useT();
  const { lang } = useLanguage();
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = typeof controlledExpanded === 'boolean' ? controlledExpanded : internalExpanded;
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const extraInfo = getExtraInfo(item.key, lang);

  const setExpanded = (next: boolean) => {
    if (typeof controlledExpanded !== 'boolean') {
      setInternalExpanded(next);
    }
    onExpandedChange?.(next);
  };

  // Measure content height for smooth animation
  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [expanded, description, howToRead, whyImportant, extraInfo?.standards, extraInfo?.celebrities]);

  // Compute bar extent: 80% padding beyond ideal range on each side
  const idealSpan = idealMax - idealMin || 0.01;
  const padding = idealSpan * 0.8;
  const barMin = idealMin - padding;
  const barMax = idealMax + padding;
  const barSpan = barMax - barMin;

  // Clamp user value position to bar bounds
  const userPos = Math.max(0, Math.min(100, ((userValue - barMin) / barSpan) * 100));
  const idealLeftPct = Math.max(0, ((idealMin - barMin) / barSpan) * 100);
  const idealRightPct = Math.min(100, ((idealMax - barMin) / barSpan) * 100);
  const idealWidthPct = idealRightPct - idealLeftPct;

  // Dot color based on status; ideal zone always green
  const dotColors = {
    ideal: 'bg-emerald-500',
    close: 'bg-amber-500',
    deviation: 'bg-amber-500',
  };
  const statusTextColors = {
    ideal: 'text-emerald-600',
    close: 'text-amber-600',
    deviation: 'text-amber-600',
  };
  const statusLabels = {
    ideal: t('proportion.ideal'),
    close: t('proportion.close'),
    deviation: t('proportion.deviation'),
  };

  const formatValue = (v: number): string => {
    if (unit === '°') return `${v.toFixed(1)}°`;
    if (Number.isInteger(v)) return v.toString();
    return v.toFixed(3);
  };

  const hasDetails = !!(description || howToRead || whyImportant);
  const wrapperClass = expanded
    ? 'rounded-2xl border border-brand-200/70 bg-gradient-to-b from-brand-50/45 to-white px-2.5 py-3 sm:px-3 sm:py-3.5 shadow-[0_1px_2px_rgba(59,130,246,0.08)]'
    : 'rounded-2xl border border-gray-200/90 bg-white px-2.5 py-3 sm:px-3 sm:py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]';

  return (
    <div className={wrapperClass}>
      {/* Label row */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs text-gray-600 min-w-0 truncate">{label}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[10px] font-medium ${statusTextColors[status]}`}>
            {statusLabels[status]}
          </span>
          <span className="text-xs font-mono font-semibold text-gray-900">
            {formatValue(userValue)}
          </span>
        </div>
      </div>

      {/* Bar */}
      <div className="relative h-2.5 bg-gray-100 rounded-full overflow-hidden">
        {/* Ideal zone — always green */}
        <div
          className="absolute top-0 h-full rounded-full bg-emerald-100/80"
          style={{
            left: `${idealLeftPct}%`,
            width: `${idealWidthPct}%`,
          }}
        />

        {/* User value marker — color depends on status */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full ${dotColors[status]} shadow-sm border border-white ring-1 ring-black/5`}
          style={{ left: `calc(${userPos}% - 5px)` }}
        />
      </div>

      {/* Ideal range labels */}
      <div className="flex justify-between mt-0.5">
        <span className="text-[9px] text-gray-400 font-mono">
          {formatValue(idealMin)}
        </span>
        <span className="text-[9px] text-gray-400">{t('proportion.idealLabel')}</span>
        <span className="text-[9px] text-gray-400 font-mono">
          {formatValue(idealMax)}
        </span>
      </div>

      {/* "Подробнее" toggle + expandable detail card */}
      {hasDetails && (
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
              <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
            </svg>
          </button>

          <div
            className="overflow-hidden transition-all duration-300 ease-in-out"
            style={{ maxHeight: expanded ? `${contentHeight}px` : '0px' }}
          >
            <div
              ref={contentRef}
              className="text-[11px] leading-relaxed font-sans divide-y divide-gray-200/60"
            >
            {/* Section 1 — What it measures */}
            {description && (
              <div className="px-2.5 pt-2.5 pb-2 sm:px-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-0.5">
                  {t('proportion.whatMeasured')}
                </p>
                <p className="text-gray-700">{description}</p>
              </div>
            )}

            {/* Section 2 — How to read */}
            {howToRead && (
              <div className="px-2.5 py-2 sm:px-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-0.5">
                  {t('proportion.howToRead')}
                </p>
                <p className="text-gray-600">{howToRead}</p>
              </div>
            )}

            {/* Section 3 — Why it matters */}
            {whyImportant && (
              <div className="px-2.5 py-2 sm:px-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-500 mb-0.5">
                  {t('proportion.whyImportant')}
                </p>
                <p className="text-gray-600">{whyImportant}</p>
              </div>
            )}

            {/* Section 4 — Standards context */}
            {extraInfo?.standards && (
              <div className="px-2.5 py-2 sm:px-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-500 mb-0.5">
                  {lang === 'en' ? 'Standards Context' : 'Стандарты и тренды'}
                </p>
                <p className="text-gray-600">{extraInfo.standards}</p>
              </div>
            )}

            {/* Section 5 — Pop culture references */}
            {extraInfo?.celebrities && (
              <div className="px-2.5 py-2 sm:px-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-fuchsia-500 mb-0.5">
                  {lang === 'en' ? 'Pop-Culture References' : 'Референсы (Celebrities)'}
                </p>
                <p className="text-gray-600">{extraInfo.celebrities}</p>
              </div>
            )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
