/**
 * Data-driven consultation CTA for the lips-only report.
 *
 * Reads the client's actual lip measurements/status and produces a personalised
 * "book a consultation" block — headline, intro, data-backed bullet points, a
 * closing line, and a WhatsApp deep link with a pre-filled message.
 *
 * Used by both the on-screen ReportScreen and the PDF export so the copy stays
 * identical across surfaces.
 */
import type { FeatureAnalysis } from '../types';
import type { Lang } from '../lib/language';

// ProFace WhatsApp business line. Digits only for the wa.me deep link.
const WHATSAPP_DIGITS = '77015557893';
const WHATSAPP_DISPLAY = '+7 (701) 555-78-93';

export interface ConsultationCTA {
  headline: string;
  intro: string;
  /** Personalised, data-backed bullet points ("based on your data …"). */
  points: string[];
  closing: string;
  whatsappUrl: string;
  whatsappLabel: string;
  whatsappDisplay: string;
}

function num(feature: FeatureAnalysis, key: string): number | null {
  const v = feature.measurements?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function fmt(n: number, digits = 2): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

interface Copy {
  headlineImprove: string;
  headlineEnhance: string;
  introImprove: string;
  introEnhance: string;
  closing: string;
  whatsappLabel: string;
  upperThin: (r: string) => string;
  upperDominant: (r: string) => string;
  mouthNarrow: (m: string) => string;
  mouthWide: (m: string) => string;
  cornersDown: (t: string) => string;
  cornersUp: (t: string) => string;
  asymmetry: (s: string) => string;
  balanced: string;
  waMessage: (score: number | null, focus: string | null) => string;
}

const COPY: Record<Lang, Copy> = {
  ru: {
    headlineImprove: 'Что можно мягко улучшить по вашим губам',
    headlineEnhance: 'Как подчеркнуть форму ваших губ',
    introImprove:
      'По вашим измерениям мы выделили зоны, где небольшая коррекция даст самый заметный результат:',
    introEnhance:
      'Ваши губы хорошо сбалансированы. На консультации специалист ProFace покажет, как деликатно подчеркнуть форму:',
    closing:
      'Бесплатная консультация ProFace: разберём отчёт вместе и подберём мягкий план — без навязывания.',
    whatsappLabel: 'Записаться в WhatsApp',
    upperThin: (r) =>
      `Верхняя губа тоньше нижней (соотношение ${r}) — обсудим аккуратное добавление объёма для баланса.`,
    upperDominant: (r) =>
      `Верхняя губа выраженнее нижней (${r}) — подберём, как гармонизировать пропорцию.`,
    mouthNarrow: (m) =>
      `Ширина рта меньше типичной относительно носа (${m}) — обсудим, как визуально раскрыть форму.`,
    mouthWide: (m) =>
      `Ширина рта больше типичной относительно носа (${m}) — подчеркнём естественные контуры.`,
    cornersDown: (t) =>
      `Уголки рта слегка опущены (${t}°) — есть мягкие техники, которые приподнимают уголки.`,
    cornersUp: (t) =>
      `Уголки рта приподняты (${t}°) — сохраним эту приятную черту при коррекции.`,
    asymmetry: (s) =>
      `Заметна лёгкая асимметрия губ (индекс ${s}) — выравнивание контура обычно даёт естественный результат.`,
    balanced:
      'Пропорции верхней и нижней губы в гармоничном диапазоне — можно мягко усилить объём и чёткость каймы по желанию.',
    waMessage: (score, focus) => {
      let m = 'Здравствуйте! Прошёл(ла) анализ губ FABS × ProFace';
      if (score !== null) m += `, мой результат ${score}/100`;
      m += '. Хочу записаться на консультацию по губам';
      if (focus) m += ` (${focus})`;
      m += '.';
      return m;
    },
  },
  en: {
    headlineImprove: 'What we can gently improve about your lips',
    headlineEnhance: 'How to enhance the shape of your lips',
    introImprove:
      'Based on your measurements, here are the areas where a small refinement would make the biggest difference:',
    introEnhance:
      'Your lips are nicely balanced. In a consultation a ProFace specialist will show how to subtly enhance their shape:',
    closing:
      'Free ProFace consultation: we will review your report together and suggest a gentle plan — no pressure.',
    whatsappLabel: 'Book on WhatsApp',
    upperThin: (r) =>
      `Your upper lip is thinner than the lower one (ratio ${r}) — we can discuss adding subtle volume for balance.`,
    upperDominant: (r) =>
      `Your upper lip is more prominent than the lower one (${r}) — we can harmonise the proportion.`,
    mouthNarrow: (m) =>
      `Your mouth is narrower than typical relative to the nose (${m}) — we can discuss opening up the shape visually.`,
    mouthWide: (m) =>
      `Your mouth is wider than typical relative to the nose (${m}) — we will accentuate your natural contour.`,
    cornersDown: (t) =>
      `Your mouth corners turn slightly down (${t}°) — gentle techniques can lift them.`,
    cornersUp: (t) =>
      `Your mouth corners turn slightly up (${t}°) — we will preserve this pleasant trait.`,
    asymmetry: (s) =>
      `There is mild lip asymmetry (index ${s}) — evening out the contour usually looks very natural.`,
    balanced:
      'Your upper-to-lower lip proportion sits in a harmonious range — volume and border definition can be gently enhanced if you wish.',
    waMessage: (score, focus) => {
      let m = 'Hi! I just completed the FABS × ProFace lip analysis';
      if (score !== null) m += `, my result is ${score}/100`;
      m += '. I would like to book a lip consultation';
      if (focus) m += ` (${focus})`;
      m += '.';
      return m;
    },
  },
};

/**
 * Build the personalised consultation CTA from the lips feature.
 * @param feature  the 'Lips' FeatureAnalysis from the report
 * @param lang     'ru' | 'en'
 * @param overallScore optional 0–100 score to reference in the WhatsApp message
 */
export function buildLipConsultationCTA(
  feature: FeatureAnalysis,
  lang: Lang,
  overallScore?: number,
): ConsultationCTA {
  const c = COPY[lang] ?? COPY.ru;
  const points: string[] = [];
  let primaryFocus: string | null = null;

  const ratio = num(feature, 'upperLowerRatio');
  const mouthToNose = num(feature, 'mouthToNoseWidthRatio');
  const tilt = num(feature, 'cornerTilt');
  const symmetry = num(feature, 'symmetryIndex');

  if (ratio !== null) {
    if (ratio < 0.64) {
      points.push(c.upperThin(fmt(ratio)));
      primaryFocus = lang === 'en' ? 'upper lip volume' : 'объём верхней губы';
    } else if (ratio > 1.08) {
      points.push(c.upperDominant(fmt(ratio)));
      primaryFocus = primaryFocus ?? (lang === 'en' ? 'lip proportion' : 'пропорция губ');
    }
  }
  if (mouthToNose !== null) {
    if (mouthToNose < 1.28) points.push(c.mouthNarrow(fmt(mouthToNose)));
    else if (mouthToNose > 1.62) points.push(c.mouthWide(fmt(mouthToNose)));
  }
  if (symmetry !== null && symmetry < 0.85) {
    points.push(c.asymmetry(fmt(symmetry)));
    primaryFocus = primaryFocus ?? (lang === 'en' ? 'symmetry' : 'симметрия');
  }
  if (tilt !== null) {
    if (tilt < -2.0) {
      points.push(c.cornersDown(fmt(tilt, 1)));
      primaryFocus = primaryFocus ?? (lang === 'en' ? 'mouth corners' : 'уголки рта');
    } else if (tilt > 4.0) {
      points.push(c.cornersUp(fmt(tilt, 1)));
    }
  }

  const hasFindings = points.length > 0 && feature.status === 'attention';
  if (points.length === 0) points.push(c.balanced);

  const score = typeof overallScore === 'number' ? Math.round(overallScore) : null;

  return {
    headline: hasFindings ? c.headlineImprove : c.headlineEnhance,
    intro: hasFindings ? c.introImprove : c.introEnhance,
    points,
    closing: c.closing,
    whatsappUrl: `https://wa.me/${WHATSAPP_DIGITS}?text=${encodeURIComponent(
      c.waMessage(score, primaryFocus),
    )}`,
    whatsappLabel: c.whatsappLabel,
    whatsappDisplay: WHATSAPP_DISPLAY,
  };
}
