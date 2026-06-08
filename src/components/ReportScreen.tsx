import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AnalysisReport, NormalizedLandmark, UserProfile } from '../types';
import type { FeatureForLLM, LLMAnalysisResult, LLMStatus } from '../analysis/llm';
import { fetchFaceSummary } from '../analysis/llm';
import { computeProportions } from '../analysis/proportions';
import { getLipVerdict } from '../analysis/lipVerdicts';
import { buildLipConsultationCTA } from '../analysis/consultation';
import FeatureCard from './FeatureCard';
import SurveyPanel from './SurveyPanel';
import KaspiUpload from './KaspiUpload';
import { downloadPDF } from '../analysis/exportPdf';
import { useLanguage } from '../lib/language';
import { useAuth } from '../lib/auth';
import { track, EVENTS } from '../lib/analytics';
import { computeOverallScore, countByStatus } from '../analysis/scoring';

const PROFACE_BOOKING_URL =
  'https://api.whatsapp.com/send/?phone=77015557893&text=%D0%94%D0%BE%D0%B1%D1%80%D1%8B%D0%B9+%D0%B4%D0%B5%D0%BD%D1%8C%21+%D0%A5%D0%BE%D1%87%D1%83+%D0%B7%D0%B0%D0%BF%D0%B8%D1%81%D0%B0%D1%82%D1%8C%D1%81%D1%8F+%D0%BD%D0%B0+%D0%BA%D0%BE%D0%BD%D1%81%D1%83%D0%BB%D1%8C%D1%82%D0%B0%D1%86%D0%B8%D1%8E+%D0%B2+ProFace+%F0%9F%92%8B&type=phone_number&app_absent=0';

const LOADER_STAGES = [
  { icon: '🔍', text: 'Считываем контур губ...' },
  { icon: '📐', text: 'Вычисляем пропорции и отклонения...' },
  { icon: '🎨', text: 'Подбираем параметры коррекции...' },
  { icon: '✨', text: 'Генерируем визуализацию...' },
];

const LIP_FACTS = [
  '💧 Гиалуроновая кислота удерживает воду в 1000 раз больше своего веса',
  '⏱️ Процедура коррекции губ занимает всего 20–30 минут',
  '📅 Результат от филлера сохраняется от 6 до 12 месяцев',
  '💉 Современные филлеры содержат лидокаин — больно практически не бывает',
  '🌟 Идеальное соотношение верхней и нижней губы — 1 : 1.6',
  '🔬 Форму идеальной верхней губы врачи называют «лук Купидона»',
  '✨ 78% клиентов отмечают рост уверенности в себе после коррекции губ',
  '🧬 Гиалуроновая кислота — натуральное вещество, уже присутствующее в организме',
];

interface Props {
  report: AnalysisReport;
  frontImageDataUrl: string | null;
  profileImageDataUrls: { left?: string; right?: string };
  profileMaskDataUrls?: { left?: string; right?: string };
  profileLandmarks?: { left?: NormalizedLandmark[] | null; right?: NormalizedLandmark[] | null };
  profileLandmarkSource?: { left?: 'ai' | 'contour' | 'mediapipe'; right?: 'ai' | 'contour' | 'mediapipe' };
  profileLandmarkConfidence?: { left?: number; right?: number };
  landmarks: NormalizedLandmark[] | null;
  precomputedTransforms: Partial<Record<string, string>>;
  aiStatus: LLMStatus;
  aiResult: LLMAnalysisResult | null;
  aiError: string | null;
  userProfile: UserProfile | null;
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  onSurveyComplete: (profile: UserProfile) => void;
  onRetake?: () => void;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function getStatusMeta(status: string) {
  const map: Record<string, { emoji: string; label: string; color: string; bar: string; summary: string }> = {
    strength: {
      emoji: '✨',
      label: 'Выраженный потенциал',
      color: 'text-emerald-700',
      bar: 'bg-emerald-400',
      summary: 'У тебя есть чёткие особенности, которые стоит подчеркнуть. Специалист увидит, как именно — и покажет ещё до процедуры.',
    },
    attention: {
      emoji: '💋',
      label: 'Есть что улучшить',
      color: 'text-rose-600',
      bar: 'bg-rose-400',
      summary: 'AI выявил зоны, где небольшая коррекция даст заметный результат. Это не недостаток — это конкретный план действий.',
    },
    within_norm: {
      emoji: '👍',
      label: 'Хорошая база',
      color: 'text-blue-600',
      bar: 'bg-blue-400',
      summary: 'Параметры в норме — это отличная отправная точка. Специалист покажет, что можно подчеркнуть и сделать образ завершённее.',
    },
    insufficient_data: {
      emoji: '🔍',
      label: 'Нужно больше данных',
      color: 'text-gray-500',
      bar: 'bg-gray-300',
      summary: 'Фото не дало достаточно точных данных. Попробуй пересфотографировать при хорошем освещении — результат будет точнее.',
    },
  };
  return map[status] ?? map['within_norm'];
}

// ── WA icon ───────────────────────────────────────────────────────────────────
function WaIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current shrink-0">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}

// ── Overall score card ────────────────────────────────────────────────────────
function SummaryScoreCard({ score, counts }: {
  score: number;
  counts: { strength: number; within_norm: number; attention: number };
}) {
  const scoreColor =
    score >= 80 ? 'text-emerald-600' :
    score >= 65 ? 'text-brand-500' :
    'text-amber-500';
  const ringColor =
    score >= 80 ? '#34d399' :
    score >= 65 ? '#6366f1' :
    '#fbbf24';
  const label =
    score >= 80 ? 'Отличный результат' :
    score >= 65 ? 'Хороший результат' :
    'Есть над чем работать';

  const circumference = 2 * Math.PI * 28;
  const offset = circumference * (1 - score / 100);

  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm px-5 py-5">
      <p className="text-xs text-gray-400 font-semibold tracking-widest uppercase mb-4">Общий результат</p>
      <div className="flex items-center gap-5">
        {/* Circular progress */}
        <div className="relative flex-shrink-0 w-20 h-20">
          <svg className="w-20 h-20 -rotate-90" viewBox="0 0 72 72">
            <circle cx="36" cy="36" r="28" fill="none" stroke="#f3f4f6" strokeWidth="7" />
            <circle
              cx="36" cy="36" r="28" fill="none"
              stroke={ringColor} strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              style={{ transition: 'stroke-dashoffset 1s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-2xl font-bold font-serif ${scoreColor}`}>{score}</span>
          </div>
        </div>

        {/* Breakdown */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-800 text-sm mb-2.5">{label}</p>
          <div className="space-y-1.5">
            {counts.strength > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                <span className="text-gray-600">
                  <span className="font-semibold text-emerald-600">{counts.strength}</span> сильных стороны
                </span>
              </div>
            )}
            {counts.within_norm > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" />
                <span className="text-gray-600">
                  <span className="font-semibold text-indigo-500">{counts.within_norm}</span> в норме
                </span>
              </div>
            )}
            {counts.attention > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                <span className="text-gray-600">
                  <span className="font-semibold text-amber-600">{counts.attention}</span> точки роста
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
      <div
        className={`h-2 rounded-full transition-all duration-700 ${color}`}
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}

// ── Locked preview ────────────────────────────────────────────────────────────

function pluralZon(n: number) {
  if (n === 1) return '1 зона внимания';
  if (n >= 2 && n <= 4) return `${n} зоны внимания`;
  return `${n} зон внимания`;
}

function LockedPreview({ status, attentionCount }: { status: string; attentionCount: number }) {
  const meta = getStatusMeta(status);
  return (
    <div className="relative rounded-2xl border border-gray-100 bg-white overflow-hidden shadow-sm">
      {/* blurred content */}
      <div className="p-6 select-none pointer-events-none">
        <div className="flex items-center gap-3 mb-5">
          <span className="text-3xl">{meta.emoji}</span>
          <div>
            <div className="h-4 bg-gray-200 rounded w-32 blur-sm mb-1" />
            <div className="h-3 bg-gray-100 rounded w-48 blur-sm" />
          </div>
        </div>
        {[90, 70, 82].map((w, i) => (
          <div key={i} className="mb-3">
            <div className="flex justify-between mb-1">
              <div className="h-3 bg-gray-200 rounded blur-sm" style={{ width: `${w * 0.6}%` }} />
              <div className="h-3 bg-gray-200 rounded w-8 blur-sm" />
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div className={`h-2 rounded-full blur-sm ${meta.bar}`} style={{ width: `${w}%` }} />
            </div>
          </div>
        ))}
        <div className="mt-4 bg-gray-50 rounded-xl p-4 space-y-2">
          <div className="h-3 bg-gray-200 rounded blur-sm w-full" />
          <div className="h-3 bg-gray-200 rounded blur-sm w-4/5" />
          <div className="h-3 bg-gray-200 rounded blur-sm w-3/4" />
        </div>
      </div>
      {/* overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 backdrop-blur-[4px]">
        <div className="text-center px-6 max-w-xs">
          <div className="text-3xl mb-3">🔒</div>
          {attentionCount > 0 ? (
            <>
              <p className="text-2xl font-black text-gray-900 mb-1 tracking-tight">
                {pluralZon(attentionCount)}
              </p>
              <p className="text-sm text-gray-500 leading-relaxed">
                Параметры, которые влияют на форму твоих губ — скрыты в отчёте
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-bold text-gray-900 mb-1">Результат готов</p>
              <p className="text-sm text-gray-500 leading-relaxed">
                Полный разбор пропорций скрыт — открой отчёт ниже
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

// Status-based fallback when AI hasn't run and no human observations available
const STATUS_FALLBACK: Record<string, string> = {
  within_norm:
    'Губы хорошо сбалансированы — пропорции верхней и нижней части в норме, уголки ровные. Это отличная база: специалист ProFace покажет, как подчеркнуть форму.',
  strength:
    'Выразительные губы — заметная особенность лица. Правильная тонкая коррекция усилит эффект. Специалист покажет результат ещё до процедуры.',
  attention:
    'Есть конкретные зоны, где точечная коррекция даст заметный результат. Запишитесь — специалист составит персональный план именно под ваши параметры.',
  insufficient_data:
    'Для точного анализа сделайте снимок при хорошем равномерном освещении — без теней и с лицом строго в кадре.',
};

export default function ReportScreen({
  report,
  frontImageDataUrl,
  profileImageDataUrls,
  profileMaskDataUrls,
  profileLandmarks,
  profileLandmarkSource,
  profileLandmarkConfidence,
  landmarks,
  precomputedTransforms,
  aiStatus,
  aiResult,
  userProfile,
  saveStatus = 'idle',
  onSurveyComplete,
  onRetake,
}: Props) {
  const { lang, t } = useLanguage();
  const { hasAccess, refreshAccess } = useAuth();
  const [surveyCompletedInReport, setSurveyCompletedInReport] = useState(false);
  const [techOpen, setTechOpen] = useState(false);
  const [paymentVerified, setPaymentVerified] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [faceSummary, setFaceSummary] = useState<string | null>(null);
  const [faceSummaryLoading, setFaceSummaryLoading] = useState(false);
  const [lipVisUrl, setLipVisUrl] = useState<string | null>(null);
  const [lipVisLoading, setLipVisLoading] = useState(false);
  const [lipVisError, setLipVisError] = useState<string | null>(null);
  const [loaderStage, setLoaderStage] = useState(0);
  const [loaderFact, setLoaderFact] = useState(0);
  const [loaderProgress, setLoaderProgress] = useState(0);

  const isLocked = !hasAccess && !paymentVerified;

  // Funnel: distinguish users who hit the paywall vs. who see the full report.
  useEffect(() => {
    track(isLocked ? EVENTS.PAYWALL_VIEWED : EVENTS.REPORT_VIEWED);
  }, [isLocked]);

  async function handlePaymentVerified() {
    await refreshAccess();
    setPaymentVerified(true);
  }

  const overallScore = useMemo(() => computeOverallScore(report.features), [report.features]);
  const statusCounts = useMemo(() => countByStatus(report.features), [report.features]);

  // DeepSeek: short plain-language summary of the whole face (measurements only).
  useEffect(() => {
    if (report.features.length === 0) return;
    const controller = new AbortController();
    setFaceSummaryLoading(true);
    setFaceSummary(null);

    const featureInput: FeatureForLLM[] = report.features.map((f) => {
      let proportions: FeatureForLLM['proportions'] = [];
      try {
        const result = computeProportions(
          f.name,
          f.measurements,
          userProfile?.gender ?? null,
          userProfile?.population ?? 'default',
        );
        proportions = (result?.items ?? []).map((item) => ({
          key: item.key,
          label: item.label,
          userValue: item.userValue,
          idealMin: item.idealMin,
          idealMax: item.idealMax,
          status: item.status,
          unit: item.unit,
        }));
      } catch {
        // proportions optional — summary still works from status alone
      }
      return {
        name: f.name,
        status: f.status,
        observations: f.observations,
        measurements: f.measurements,
        proportions,
        confidence: f.confidence,
      };
    });

    void fetchFaceSummary(
      featureInput,
      { overallScore, gender: userProfile?.gender, population: userProfile?.population },
      controller.signal,
    )
      .then((summary) => { if (!controller.signal.aborted) setFaceSummary(summary); })
      .finally(() => { if (!controller.signal.aborted) setFaceSummaryLoading(false); });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, userProfile?.gender, userProfile?.population]);

  const lipsFeature = useMemo(
    () => report.features.find((f) => f.name === 'Lips') ?? report.features[0] ?? null,
    [report.features],
  );

  const enhancedLipsFeature = useMemo(() => {
    if (!lipsFeature) return null;
    if (aiResult) {
      const ai = aiResult.features.find((a) => a.name === lipsFeature.name);
      return ai ? { ...lipsFeature, recommendations: ai.aiRecommendations } : lipsFeature;
    }
    return lipsFeature;
  }, [aiResult, lipsFeature]);

  if (!lipsFeature || !enhancedLipsFeature) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center text-gray-400">
        {lang === 'ru' ? 'Данные анализа не найдены.' : 'Analysis data not found.'}
      </div>
    );
  }

  const meta = getStatusMeta(lipsFeature.status);
  const confidencePct = Math.round(lipsFeature.confidence * 100);
  const qualityPct = Math.round(report.inputs.qualityScore * 100);

  // Personalised, data-driven consultation transition (built from lip measurements)
  const consultCta = buildLipConsultationCTA(lipsFeature, lang, overallScore);

  // AI recommendations (GPT-generated — best quality)
  const aiRecs: string[] = useMemo(
    () => aiResult?.features.find((a) => a.name === lipsFeature.name)?.aiRecommendations ?? [],
    [aiResult, lipsFeature],
  );

  // Human-readable observations: filter out raw "Label: number" measurement lines
  const humanInsights: string[] = useMemo(
    () => lipsFeature.observations.filter((obs) => !/:\s*-?[\d.]/.test(obs)),
    [lipsFeature],
  );

  // What shows in "Что это значит лично для тебя":
  // 1) AI recs if available  2) filtered observations  3) status-based fallback (shown if both empty)
  const insights = aiRecs.length > 0 ? aiRecs : humanInsights;

  // Key conclusions — one plain-language verdict per measured parameter.
  // Deterministic (doctor copy, not AI), so they surface even if AI is offline.
  const keyVerdicts = useMemo(() => {
    const props = computeProportions(
      lipsFeature.name,
      lipsFeature.measurements,
      userProfile?.gender ?? null,
      userProfile?.population ?? 'default',
    );
    if (!props?.items?.length) return [] as { key: string; label: string; ideal: boolean; verdict: string }[];
    return props.items.flatMap((item) => {
      const v = getLipVerdict(item.key, item.status, item.userValue, item.idealMin, item.idealMax, lang);
      if (!v) return [];
      return [{ key: item.key, label: item.label, ideal: item.status === 'ideal', verdict: v.verdict }];
    });
  }, [lipsFeature, userProfile?.gender, userProfile?.population, lang]);

  const attentionVerdicts = keyVerdicts.filter((v) => !v.ideal);

  // Full measurement data sent to the API for GPT prompt engineering
  const lipVisMetrics = useMemo(() => {
    const props = computeProportions(
      lipsFeature.name,
      lipsFeature.measurements,
      userProfile?.gender ?? null,
      userProfile?.population ?? 'default',
    );
    return props?.items ?? [];
  }, [lipsFeature, userProfile?.gender, userProfile?.population]);

  const handleGenerateLipVis = useCallback(async () => {
    if (lipVisLoading) return;
    setLipVisLoading(true);
    setLipVisError(null);
    try {
      const res = await fetch('/api/lip-visualize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metrics: lipVisMetrics,
          imageDataUrl: frontImageDataUrl ?? undefined,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      const json = await res.json() as { imageUrl: string };
      setLipVisUrl(json.imageUrl);
    } catch (err) {
      setLipVisError(err instanceof Error ? err.message : 'Ошибка генерации');
    } finally {
      setLipVisLoading(false);
    }
  }, [lipVisMetrics, frontImageDataUrl, lipVisLoading]);

  useEffect(() => {
    if (!lipVisLoading) {
      setLoaderStage(0);
      setLoaderFact(0);
      setLoaderProgress(0);
      return;
    }
    const start = Date.now();
    const DURATION = 30_000;
    const progressTimer = setInterval(() => {
      setLoaderProgress(Math.min(95, ((Date.now() - start) / DURATION) * 100));
    }, 200);
    const stageTimer = setInterval(() => {
      setLoaderStage((s) => Math.min(LOADER_STAGES.length - 1, s + 1));
    }, 7500);
    const factTimer = setInterval(() => {
      setLoaderFact((f) => (f + 1) % LIP_FACTS.length);
    }, 5000);
    return () => {
      clearInterval(progressTimer);
      clearInterval(stageTimer);
      clearInterval(factTimer);
    };
  }, [lipVisLoading]);

  return (
    <>
    {/* ── Sticky mobile WA CTA ── */}
    {!isLocked && (
      <div className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-100 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.07)]">
        <a
          href={PROFACE_BOOKING_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track(EVENTS.WHATSAPP_CTA_CLICKED, { location: 'sticky_mobile' })}
          className="flex items-center justify-center gap-2 w-full bg-[#25D366] hover:bg-[#22c55e] active:scale-[0.98] text-white font-bold py-3.5 rounded-xl text-sm transition-all"
        >
          <WaIcon />
          Записаться в ProFace — бесплатная консультация
        </a>
      </div>
    )}

    <div className="max-w-xl mx-auto px-4 py-6 space-y-5 pb-24 sm:pb-6">

      {/* ── Retake button ── */}
      {onRetake && (
        <div className="flex justify-end">
          <button
            onClick={onRetake}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors rounded-lg px-3 py-1.5 hover:bg-gray-100"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Новый скан
          </button>
        </div>
      )}

      {/* ── 0. Summary score — only AFTER unlock (no positive reveal before paying) ── */}
      {!isLocked && overallScore > 0 && (
        <SummaryScoreCard score={overallScore} counts={statusCounts} />
      )}

      {/* ── 1. Personal hero ── */}
      <div className="rounded-2xl bg-gradient-to-br from-gray-50 to-white border border-gray-100 shadow-sm px-6 pt-6 pb-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
          <p className="text-xs text-gray-400 font-semibold tracking-widest uppercase">Анализ завершён</p>
        </div>

        <div className="flex items-start gap-3.5 mb-5">
          <span className="text-4xl leading-none mt-0.5">{isLocked ? '🔍' : meta.emoji}</span>
          <div>
            <h1 className="text-xl font-bold text-gray-900 leading-snug mb-1.5">
              {isLocked ? 'Твои губы уже измерены' : meta.label}
            </h1>
            <p className="text-sm text-gray-500 leading-relaxed">
              {isLocked
                ? attentionVerdicts.length > 0
                  ? `Нейросеть нашла ${pluralZon(attentionVerdicts.length)} — что именно и что с этим делать, скрыто в отчёте. Это то, что косметолог скажет на консультации за 15 000 ₸.`
                  : 'Нейросеть проверила все ключевые пропорции твоих губ. Полный разбор уже готов — открой отчёт, чтобы увидеть результат.'
                : meta.summary}
            </p>
          </div>
        </div>

        {/* AI face summary (DeepSeek) — warm, plain-language overview (hidden before payment) */}
        {!isLocked && (faceSummaryLoading || faceSummary) && (
          <div className="mb-5 rounded-xl bg-indigo-50/60 border border-indigo-100 px-4 py-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm">✨</span>
              <p className="text-xs font-semibold text-indigo-700 tracking-wide">{t('report.aiSummaryTitle')}</p>
            </div>
            {faceSummaryLoading && !faceSummary ? (
              <div className="flex items-center gap-2 text-sm text-indigo-400/80 py-0.5">
                <div className="w-3.5 h-3.5 border-2 border-indigo-300 border-t-transparent rounded-full animate-spin shrink-0" />
                <span>{t('report.aiSummaryLoading')}</span>
              </div>
            ) : (
              <p className="text-sm text-gray-700 leading-relaxed">{faceSummary}</p>
            )}
          </div>
        )}

        {/* ── Data-driven consultation transition — only after payment (no positive reveal before paying) ── */}
        {!isLocked && (
        <div className="mb-5 rounded-xl bg-gradient-to-br from-indigo-50 to-white border border-indigo-100 px-4 py-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white text-[10px] font-bold shrink-0">PF</span>
            <p className="text-sm font-bold text-indigo-900 leading-snug">{consultCta.headline}</p>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed mb-2.5">{consultCta.intro}</p>
          <ul className="space-y-1.5 mb-3">
            {consultCta.points.map((point, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-700 leading-relaxed">
                <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500 leading-relaxed mb-3">{consultCta.closing}</p>
          <a
            href={consultCta.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track(EVENTS.WHATSAPP_CTA_CLICKED, { location: 'consultation_card' })}
            className="flex items-center justify-center gap-2 w-full bg-[#25D366] hover:bg-[#22c55e] active:scale-[0.98] text-white font-bold py-3 rounded-xl text-sm transition-all"
          >
            <WaIcon />
            {consultCta.whatsappLabel}
          </a>
        </div>
        )}

        {/* Confidence + quality with context */}
        <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-3">
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-gray-500">Точность анализа</span>
              <span className={`font-bold ${confidencePct >= 80 ? 'text-emerald-600' : confidencePct >= 60 ? 'text-amber-600' : 'text-gray-500'}`}>
                {confidencePct}%
              </span>
            </div>
            <ScoreBar value={lipsFeature.confidence} color={meta.bar} />
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-gray-500">Качество фото</span>
              <span className={`font-bold ${qualityPct >= 70 ? 'text-emerald-600' : 'text-amber-600'}`}>{qualityPct}%</span>
            </div>
            <ScoreBar value={report.inputs.qualityScore} color="bg-blue-300" />
          </div>
          {qualityPct < 65 && (
            <p className="text-[11px] text-amber-600 pt-0.5">
              💡 При лучшем освещении точность вырастет — результат будет детальнее
            </p>
          )}
        </div>
      </div>

      {/* ── 2. Locked or full report ── */}
      {isLocked ? (
        <>
          <LockedPreview status={lipsFeature.status} attentionCount={attentionVerdicts.length} />
          <KaspiUpload onVerified={handlePaymentVerified} />
        </>
      ) : (
        <>
          {/* ── Key conclusions — front and center, one verdict per parameter ── */}
          {keyVerdicts.length > 0 && (
            <div className="rounded-2xl bg-white border border-gray-100 shadow-sm px-5 py-5">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-base">📋</span>
                  <p className="text-sm font-semibold text-gray-800">Ключевые выводы</p>
                </div>
                <span className="text-[11px] text-gray-400">
                  {attentionVerdicts.length > 0
                    ? `${attentionVerdicts.length} ${attentionVerdicts.length === 1 ? 'зона внимания' : 'зоны внимания'}`
                    : 'всё в норме'}
                </span>
              </div>
              <ul className="space-y-3">
                {keyVerdicts.map((v) => (
                  <li key={v.key} className="flex items-start gap-2.5">
                    {v.ideal ? (
                      <svg className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                      </svg>
                    )}
                    <div className="min-w-0">
                      <span className="text-[11px] text-gray-400 block leading-tight">{v.label}</span>
                      <p className={`text-sm leading-snug ${v.ideal ? 'text-gray-700' : 'text-amber-800 font-medium'}`}>
                        {v.verdict}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-4 pt-3 border-t border-gray-50">
                <p className="text-xs text-gray-400 leading-relaxed">
                  Полное объяснение по каждому пункту — ниже, в разборе параметров (кнопка «Подробнее»)
                </p>
              </div>
            </div>
          )}

          {/* AI key takeaways */}
          <div className="rounded-2xl bg-white border border-gray-100 shadow-sm px-5 py-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-base">💬</span>
              <p className="text-sm font-semibold text-gray-800">Что это значит лично для тебя</p>
            </div>

            {aiStatus === 'streaming' ? (
              /* AI is generating — show spinner */
              <div className="flex items-center gap-2.5 text-sm text-gray-400 py-1">
                <div className="w-3.5 h-3.5 border-2 border-indigo-300 border-t-transparent rounded-full animate-spin shrink-0" />
                <span>AI анализирует параметры…</span>
              </div>
            ) : insights.length > 0 ? (
              /* Show AI recs or human-readable observations */
              <ul className="space-y-3.5">
                {insights.slice(0, 4).map((rec, i) => (
                  <li key={i} className="flex gap-3 text-sm text-gray-700 leading-relaxed">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-rose-50 text-rose-400 flex items-center justify-center flex-shrink-0 text-xs font-bold shrink-0">{i + 1}</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            ) : (
              /* Status-based human-friendly fallback */
              <p className="text-sm text-gray-700 leading-relaxed">
                {STATUS_FALLBACK[lipsFeature.status] ?? STATUS_FALLBACK.within_norm}
              </p>
            )}

            <div className="mt-4 pt-4 border-t border-gray-50">
              <p className="text-xs text-gray-400 leading-relaxed">
                Ниже — полный разбор по каждому параметру с конкретными цифрами
              </p>
            </div>
          </div>

          {/* Full FeatureCard — detailed measurements */}
          <FeatureCard
            feature={enhancedLipsFeature}
            index={0}
            aiResult={aiResult?.features.find((a) => a.name === enhancedLipsFeature.name)}
            frontImageDataUrl={frontImageDataUrl}
            landmarks={landmarks}
            profileImageDataUrls={profileImageDataUrls}
            profileMaskDataUrls={profileMaskDataUrls}
            profileLandmarks={profileLandmarks}
            profileLandmarkSource={profileLandmarkSource}
            profileLandmarkConfidence={profileLandmarkConfidence}
            precomputedTransformDataUrl={precomputedTransforms[enhancedLipsFeature.name] ?? null}
            gender={userProfile?.gender}
            population={userProfile?.population ?? 'default'}
            defaultExpanded
            hideTransform
          />

          {/* ── AI Lip Visualization ── */}
          <div className="rounded-2xl border border-purple-100 bg-gradient-to-br from-purple-50 to-white shadow-sm px-5 py-5">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-base">✨</span>
                <p className="text-sm font-semibold text-gray-800">AI-визуализация губ</p>
              </div>
              {lipVisUrl && !lipVisLoading && (
                <button
                  onClick={() => { setLipVisUrl(null); setLipVisError(null); void handleGenerateLipVis(); }}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Обновить
                </button>
              )}
            </div>

            <p className="text-xs text-gray-400 mb-4 leading-relaxed">
              Нейросеть редактирует твоё фото с учётом отклонений — как ориентир для консультации.
            </p>

            {/* Idle — show generate button */}
            {!lipVisLoading && !lipVisUrl && !lipVisError && (
              <button
                onClick={() => void handleGenerateLipVis()}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-purple-500 to-rose-400 hover:from-purple-600 hover:to-rose-500 active:scale-[0.98] text-white font-semibold text-sm shadow-md shadow-purple-200 transition-all flex items-center justify-center gap-2"
              >
                <span className="text-base">💋</span>
                Показать результат процедуры
              </button>
            )}

            {/* Loading — rich animated loader */}
            {lipVisLoading && (
              <div className="rounded-xl border border-purple-100 bg-purple-50/40 flex flex-col items-center px-4 py-6 gap-5">
                {/* Pulsing rings */}
                <div className="relative flex items-center justify-center w-20 h-20">
                  <div
                    className="absolute rounded-full bg-purple-200/50 animate-ping"
                    style={{ width: 80, height: 80, animationDuration: '2s' }}
                  />
                  <div
                    className="absolute rounded-full bg-rose-200/40 animate-ping"
                    style={{ width: 60, height: 60, animationDuration: '2s', animationDelay: '0.4s' }}
                  />
                  <div className="relative w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-rose-400 shadow-lg flex items-center justify-center text-lg">
                    💋
                  </div>
                </div>

                {/* Current stage */}
                <div className="text-center">
                  <p className="text-sm font-semibold text-purple-700 transition-all">
                    {LOADER_STAGES[loaderStage].icon} {LOADER_STAGES[loaderStage].text}
                  </p>
                  <p className="text-[10px] text-purple-400 mt-0.5">Обычно занимает 20–30 секунд</p>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-purple-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-purple-400 to-rose-400 transition-all duration-200"
                    style={{ width: `${loaderProgress}%` }}
                  />
                </div>

                {/* Rotating fact */}
                <div className="w-full bg-white/70 border border-purple-100 rounded-xl px-3 py-2.5">
                  <p className="text-[11px] text-gray-500 leading-relaxed text-center">
                    {LIP_FACTS[loaderFact]}
                  </p>
                </div>
              </div>
            )}

            {/* Error */}
            {lipVisError && !lipVisLoading && (
              <div className="rounded-xl bg-red-50 px-3 py-3 flex items-center justify-between gap-3">
                <p className="text-xs text-red-500">{lipVisError}</p>
                <button
                  onClick={() => { setLipVisError(null); void handleGenerateLipVis(); }}
                  className="text-xs px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg shrink-0 transition-colors"
                >
                  Повторить
                </button>
              </div>
            )}

            {/* Result */}
            {lipVisUrl && !lipVisLoading && (
              <figure className="rounded-xl overflow-hidden border border-purple-100">
                <img src={lipVisUrl} alt="AI визуализация губ" className="w-full object-cover" />
                <figcaption className="text-[10px] text-purple-400 text-center py-1.5 border-t border-purple-50 bg-white">
                  Сгенерировано нейросетью на основе твоего анализа · Не медицинский совет
                </figcaption>
              </figure>
            )}
          </div>

          {/* ── ProFace CTA ── */}
          <div className="rounded-2xl overflow-hidden border border-rose-100 bg-gradient-to-br from-rose-50 to-white shadow-sm">
            <div className="px-5 py-5">
              <div className="flex items-start gap-3 mb-4">
                <span className="text-2xl leading-none mt-0.5 flex-shrink-0">💋</span>
                <div>
                  <p className="font-bold text-gray-900 text-base leading-snug mb-1">
                    Хочешь увидеть результат ещё до процедуры?
                  </p>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    Специалист ProFace изучит твой отчёт и покажет, как изменятся губы после коррекции — конкретно, без догадок.
                  </p>
                </div>
              </div>

              {/* Social proof row */}
              <div className="flex gap-4 mb-4 text-xs text-gray-400">
                <span>✓ Консультация бесплатно</span>
                <span>✓ Алматы · Астана</span>
              </div>

              <a
                href={PROFACE_BOOKING_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track(EVENTS.WHATSAPP_CTA_CLICKED, { location: 'paywall' })}
                className="flex items-center justify-center gap-2.5 w-full bg-[#25D366] hover:bg-[#22c55e] active:scale-[0.98] text-white font-bold px-5 py-3.5 rounded-xl text-sm transition-all shadow-sm"
              >
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Записаться в WhatsApp
              </a>
            </div>
          </div>

          {/* ── Survey ── */}
          {!userProfile && !surveyCompletedInReport && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 overflow-hidden">
              <div className="px-5 py-4 border-b border-amber-200 flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">Уточни данные — получи точнее</p>
                  <p className="text-xs text-amber-600 mt-0.5">Пол и популяция влияют на нормы анализа</p>
                </div>
              </div>
              <div className="p-5 bg-white">
                <SurveyPanel
                  context="report"
                  onComplete={(profile) => {
                    onSurveyComplete(profile);
                    setSurveyCompletedInReport(true);
                  }}
                />
              </div>
            </div>
          )}

          {/* ── Technical details (collapsed) ── */}
          <div>
            <button
              onClick={() => setTechOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-white border border-gray-100 rounded-xl text-sm text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <span>Технические детали анализа</span>
              <svg className={`w-4 h-4 transition-transform ${techOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {techOpen && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {[
                  { label: 'Точность', value: `${confidencePct}%` },
                  { label: 'Качество фото', value: `${qualityPct}%` },
                  { label: 'Точки лица', value: `${report.landmarks.count}` },
                  { label: 'Обработка', value: `${report.meta.processingTime}мс` },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-white border border-gray-100 rounded-xl p-3">
                    <div className="text-xs text-gray-400 mb-0.5">{label}</div>
                    <div className="text-base font-bold text-gray-800">{value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Save status ── */}
          {saveStatus === 'saved' && (
            <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-2.5">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Анализ сохранён в личный кабинет
            </div>
          )}
          {saveStatus === 'saving' && (
            <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5">
              <div className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin shrink-0" />
              Сохранение анализа…
            </div>
          )}
          {saveStatus === 'error' && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 3h.01M12 3a9 9 0 110 18A9 9 0 0112 3z" />
              </svg>
              Не удалось сохранить. Войдите в аккаунт и повторите анализ.
            </div>
          )}

          {/* ── PDF ── */}
          <button
            disabled={pdfExporting}
            onClick={async () => {
              if (pdfExporting) return;
              setPdfExporting(true);
              try {
                await downloadPDF({ report, frontImageDataUrl, profileImageDataUrls, aiResult });
              } catch (e) {
                console.error('[PDF] export failed:', e);
              } finally {
                setPdfExporting(false);
              }
            }}
            className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors text-sm font-medium text-gray-500 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {pdfExporting ? (
              <>
                <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                Генерация PDF…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Скачать PDF-отчёт
              </>
            )}
          </button>
        </>
      )}
    </div>
    </>
  );
}
