import { useMemo, useState } from 'react';
import type { AnalysisReport, NormalizedLandmark, UserProfile } from '../types';
import type { LLMAnalysisResult, LLMStatus } from '../analysis/llm';
import FeatureCard from './FeatureCard';
import SurveyPanel from './SurveyPanel';
import KaspiUpload from './KaspiUpload';
import { downloadPDF } from '../analysis/exportPdf';
import { useLanguage } from '../lib/language';
import { useAuth } from '../lib/auth';

const PROFACE_BOOKING_URL =
  'https://api.whatsapp.com/send/?phone=77015557893&text=%D0%94%D0%BE%D0%B1%D1%80%D1%8B%D0%B9+%D0%B4%D0%B5%D0%BD%D1%8C%21+%D0%A5%D0%BE%D1%87%D1%83+%D0%B7%D0%B0%D0%BF%D0%B8%D1%81%D0%B0%D1%82%D1%8C%D1%81%D1%8F+%D0%BD%D0%B0+%D0%BA%D0%BE%D0%BD%D1%81%D1%83%D0%BB%D1%8C%D1%82%D0%B0%D1%86%D0%B8%D1%8E+%D0%B2+ProFace+%F0%9F%92%8B&type=phone_number&app_absent=0';

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
  onSurveyComplete: (profile: UserProfile) => void;
  onRetake?: () => void;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function getStatusMeta(status: string) {
  const map: Record<string, { emoji: string; label: string; color: string; bar: string; summary: string }> = {
    strength: {
      emoji: '✨',
      label: 'Сильная сторона',
      color: 'text-emerald-700',
      bar: 'bg-emerald-400',
      summary: 'AI нашёл у тебя выраженные сильные стороны. Это здорово — есть с чем работать и что подчеркнуть.',
    },
    attention: {
      emoji: '💡',
      label: 'Есть потенциал',
      color: 'text-rose-600',
      bar: 'bg-rose-400',
      summary: 'AI видит зоны, которые можно улучшить. Это не недостаток — это возможность выглядеть ещё лучше.',
    },
    within_norm: {
      emoji: '👍',
      label: 'Всё в норме',
      color: 'text-blue-600',
      bar: 'bg-blue-400',
      summary: 'Показатели в пределах нормы. Всё сбалансировано — это хорошая база для любых процедур.',
    },
    insufficient_data: {
      emoji: '🔍',
      label: 'Мало данных',
      color: 'text-gray-500',
      bar: 'bg-gray-300',
      summary: 'Качество фото не позволило сделать точный анализ. Попробуй сделать снимок при хорошем освещении.',
    },
  };
  return map[status] ?? map['within_norm'];
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

function LockedPreview({ status }: { status: string }) {
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
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/70 backdrop-blur-[3px]">
        <div className="text-center px-6 max-w-xs">
          <div className="text-4xl mb-3">🔒</div>
          <p className="font-bold text-gray-900 text-lg mb-2">Анализ готов</p>
          <p className="text-sm text-gray-500 leading-relaxed">
            Оплати 3 000 ₸ через Kaspi — загрузи чек ниже и отчёт откроется сразу
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

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
  aiResult,
  userProfile,
  onSurveyComplete,
  onRetake,
}: Props) {
  const { lang } = useLanguage();
  const { hasAccess, refreshAccess } = useAuth();
  const [surveyCompletedInReport, setSurveyCompletedInReport] = useState(false);
  const [techOpen, setTechOpen] = useState(false);
  const [paymentVerified, setPaymentVerified] = useState(false);

  const isLocked = !hasAccess && !paymentVerified;

  async function handlePaymentVerified() {
    await refreshAccess();
    setPaymentVerified(true);
  }

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

  // AI recommendations as clean bullets
  const aiRecs: string[] = aiResult?.features.find(
    (a) => a.name === lipsFeature.name
  )?.aiRecommendations ?? enhancedLipsFeature.recommendations ?? [];

  return (
    <div className="max-w-xl mx-auto px-4 py-6 space-y-5">

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

      {/* ── 1. Emotional hero ── */}
      <div className="rounded-2xl bg-gradient-to-br from-gray-50 to-white border border-gray-100 shadow-sm px-6 pt-6 pb-5">
        <p className="text-xs text-gray-400 uppercase tracking-widest mb-3 font-medium">AI-анализ губ</p>
        <div className="flex items-start gap-4 mb-4">
          <span className="text-5xl leading-none">{meta.emoji}</span>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 leading-tight mb-1">{meta.label}</h1>
            <p className="text-sm text-gray-500 leading-relaxed">{meta.summary}</p>
          </div>
        </div>

        {/* Score bars */}
        <div className="space-y-3 mt-4">
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Точность анализа</span>
              <span className="font-semibold text-gray-700">{confidencePct}%</span>
            </div>
            <ScoreBar value={lipsFeature.confidence} color={meta.bar} />
          </div>
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Качество фото</span>
              <span className="font-semibold text-gray-700">{qualityPct}%</span>
            </div>
            <ScoreBar value={report.inputs.qualityScore} color="bg-gray-300" />
          </div>
        </div>
      </div>

      {/* ── 2. Locked or full report ── */}
      {isLocked ? (
        <>
          <LockedPreview status={lipsFeature.status} />
          <KaspiUpload onVerified={handlePaymentVerified} />
        </>
      ) : (
        <>
          {/* AI key takeaways — shown before full card */}
          {aiRecs.length > 0 && (
            <div className="rounded-2xl bg-white border border-gray-100 shadow-sm px-5 py-5">
              <p className="text-xs text-gray-400 uppercase tracking-widest font-medium mb-4">
                💬 Что это значит для тебя
              </p>
              <ul className="space-y-3">
                {aiRecs.slice(0, 4).map((rec, i) => (
                  <li key={i} className="flex gap-3 text-sm text-gray-700 leading-relaxed">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center flex-shrink-0 text-xs font-bold">{i + 1}</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
          />

          {/* ── ProFace CTA ── */}
          <div className="rounded-2xl overflow-hidden bg-gradient-to-br from-rose-500 to-rose-600 text-white shadow-md">
            <div className="px-6 py-6">
              <p className="text-rose-200 text-xs font-semibold uppercase tracking-widest mb-2">Следующий шаг</p>
              <h3 className="text-xl font-bold mb-2 leading-tight">
                Хочешь увидеть результат ещё до процедуры?
              </h3>
              <p className="text-rose-100 text-sm leading-relaxed mb-5">
                Специалисты ProFace посмотрят твой анализ и покажут, как будут выглядеть губы после коррекции — без догадок и сюрпризов.
              </p>
              <a
                href={PROFACE_BOOKING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2.5 bg-white text-rose-600 font-bold px-5 py-3 rounded-xl text-sm hover:bg-rose-50 active:scale-95 transition-all shadow-sm"
              >
                {/* WhatsApp icon */}
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

          {/* ── PDF ── */}
          <button
            onClick={() => downloadPDF({
              report: { ...report, features: enhancedLipsFeature ? [enhancedLipsFeature] : [] },
              frontImageDataUrl,
              profileImageDataUrls,
              aiResult,
            })}
            className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors text-sm font-medium text-gray-500"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Скачать PDF-отчёт
          </button>
        </>
      )}
    </div>
  );
}
