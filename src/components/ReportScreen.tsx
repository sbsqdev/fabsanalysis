import { useMemo, useState } from 'react';
import type { AnalysisReport, NormalizedLandmark, UserProfile } from '../types';
import type { LLMAnalysisResult, LLMStatus } from '../analysis/llm';
import FeatureCard from './FeatureCard';
import SurveyPanel from './SurveyPanel';
import KaspiUpload from './KaspiUpload';
import { downloadPDF } from '../analysis/exportPdf';
import { lightingLabel } from '../i18n';
import { useLanguage, useT } from '../lib/language';
import { localizeNarrativeText } from '../lib/narrativeLocalization';
import { useAuth } from '../lib/auth';

// ProFace booking URL — update to actual link when available
const PROFACE_BOOKING_URL = 'https://proface.kz';

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
}

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
}: Props) {
  const t = useT();
  const { lang } = useLanguage();
  const { hasAccess, refreshAccess } = useAuth();
  const [surveyCompletedInReport, setSurveyCompletedInReport] = useState(false);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [accuracyOpen, setAccuracyOpen] = useState(false);
  const [paymentVerified, setPaymentVerified] = useState(false);

  const isLocked = !hasAccess && !paymentVerified;

  async function handlePaymentVerified() {
    await refreshAccess();
    setPaymentVerified(true);
  }

  // Only Lips feature
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

  const statusColor = (status: string) => {
    if (status === 'strength') return 'bg-emerald-100 text-emerald-700';
    if (status === 'attention') return 'bg-rose-100 text-rose-700';
    if (status === 'within_norm') return 'bg-blue-100 text-blue-700';
    return 'bg-gray-100 text-gray-600';
  };

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      strength: lang === 'ru' ? 'Сильная сторона' : 'Strength',
      attention: lang === 'ru' ? 'Есть потенциал' : 'Has Potential',
      within_norm: lang === 'ru' ? 'В норме' : 'Within Norm',
      insufficient_data: lang === 'ru' ? 'Недостаточно данных' : 'Insufficient Data',
    };
    return map[status] ?? status;
  };

  const qualityLabel = (score: number) => {
    if (score >= 0.7) return lang === 'ru' ? 'Хорошее' : 'Good';
    if (score >= 0.4) return lang === 'ru' ? 'Среднее' : 'Moderate';
    return lang === 'ru' ? 'Слабое' : 'Poor';
  };

  if (!lipsFeature || !enhancedLipsFeature) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center text-gray-500">
        {lang === 'ru' ? 'Данные анализа губ не найдены.' : 'Lip analysis data not found.'}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-4 py-6 sm:py-8">

      {/* ── Header ── */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1">{t('report.title')}</h1>
        <p className="text-sm text-gray-400">
          {t('report.createdAt')} {new Date(report.meta.date).toLocaleString(t('locale.code'))}
        </p>
      </div>

      {/* ── Quick-stats strip ── */}
      <div className="flex flex-wrap gap-2 mb-6">
        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${statusColor(lipsFeature.status)}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
          {statusLabel(lipsFeature.status)}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-gray-100 text-gray-600">
          {t('report.confidenceLabel')}: {Math.round(lipsFeature.confidence * 100)}%
        </span>
        {isLocked ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-amber-100 text-amber-700">
            🔒 Требуется оплата
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-gray-100 text-gray-600">
            {t('report.qualityLabel')}: {qualityLabel(report.inputs.qualityScore)}
          </span>
        )}
      </div>

      {/* ── Lips Feature Card — locked preview or full ── */}
      {isLocked ? (
        <LockedPreview statusColor={statusColor(lipsFeature.status)} statusLabel={statusLabel(lipsFeature.status)} />
      ) : (
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
      )}

      {/* ── Kaspi payment gate (when locked) ── */}
      {isLocked && (
        <div className="mt-6 mb-6">
          <KaspiUpload onVerified={handlePaymentVerified} />
        </div>
      )}

      {/* ── Profile completion card ── */}
      {!userProfile && !surveyCompletedInReport && (
        <div className="mb-6 mt-6 border-2 border-dashed border-amber-300 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-3 bg-amber-50 px-5 py-3.5 border-b border-amber-200">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800 font-sans">{t('report.profileTitle')}</p>
              <p className="text-xs text-amber-600 font-sans mt-0.5">{t('report.profileHint')}</p>
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

      {/* ── ProFace Booking CTA ── */}
      {!isLocked && (
        <div className="mt-8 mb-6 rounded-2xl overflow-hidden bg-gradient-to-br from-rose-50 to-amber-50 border border-rose-100">
          <div className="px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-rose-500 text-lg">💋</span>
                <h3 className="font-semibold text-gray-900 text-base">{t('report.bookingTitle')}</h3>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed mb-1">
                {t('report.bookingSubtitle')}
              </p>
              <p className="text-xs text-gray-400">{t('report.bookingNote')}</p>
            </div>
            <a
              href={PROFACE_BOOKING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 inline-flex items-center gap-2 bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold px-5 py-3 rounded-xl transition-colors shadow-sm"
            >
              {t('report.bookingCta')}
            </a>
          </div>
        </div>
      )}

      {/* ── Collapsible Disclaimer ── */}
      {!isLocked && (
        <div className="mb-3">
          <button
            onClick={() => setDisclaimerOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {t('report.disclaimerToggle')}
            </span>
            <svg
              className={`w-4 h-4 transition-transform ${disclaimerOpen ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {disclaimerOpen && (
            <div className="mt-1 px-4 py-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700 leading-relaxed">
              {localizeNarrativeText(report.disclaimer, lang)}
            </div>
          )}
        </div>
      )}

      {/* ── Collapsible Data Accuracy ── */}
      {!isLocked && (
        <div className="mb-6">
          <button
            onClick={() => setAccuracyOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              {t('report.dataAccuracyToggle')}
            </span>
            <svg
              className={`w-4 h-4 transition-transform ${accuracyOpen ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {accuracyOpen && (
            <div className="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <SummaryCard
                label={t('report.quality')}
                value={`${Math.round(report.inputs.qualityScore * 100)}%`}
                sub={`${lightingLabel(report.inputs.lightingHeuristic)} ${t('report.lighting')}`}
              />
              <SummaryCard
                label={t('report.faceAccuracy')}
                value={`${Math.round(report.faceDetection.confidence * 100)}%`}
                sub={`${report.landmarks.count} ${t('report.points')}`}
              />
              <SummaryCard
                label={t('report.avgAccuracy')}
                value={`${Math.round(lipsFeature.confidence * 100)}%`}
                sub={t('report.byFeatures')}
              />
              <SummaryCard
                label={t('report.processing')}
                value={`${report.meta.processingTime}ms`}
                sub={report.meta.device}
              />
            </div>
          )}
        </div>
      )}

      {/* ── PDF Export ── */}
      {!isLocked && (
        <div className="flex gap-2.5">
          <button
            onClick={() => downloadPDF({
              report: { ...report, features: enhancedLipsFeature ? [enhancedLipsFeature] : [] },
              frontImageDataUrl,
              profileImageDataUrls,
              aiResult,
            })}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            {t('report.downloadPdf')}
          </button>
        </div>
      )}
    </div>
  );
}


// ── Locked preview shown before Kaspi payment ────────────────────────────────
function LockedPreview({ statusColor, statusLabel }: { statusColor: string; statusLabel: string }) {
  const mockParams = [
    { label: 'Симметрия контура', hint: 'точное значение скрыто' },
    { label: 'Соотношение верх / низ', hint: 'точное значение скрыто' },
    { label: 'Лук Купидона', hint: 'точное значение скрыто' },
    { label: 'Проекция и объём', hint: 'точное значение скрыто' },
    { label: 'Уголки губ', hint: 'точное значение скрыто' },
    { label: 'Ширина', hint: 'точное значение скрыто' },
  ];

  return (
    <div className="relative rounded-2xl border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-gray-900">Губы</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor}`}>{statusLabel}</span>
        </div>
        <span className="text-xs text-amber-600 font-medium bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
          🔒 Требует оплаты
        </span>
      </div>

      {/* Blurred parameter list */}
      <div className="p-5 space-y-3">
        <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-4">Ключевые параметры</p>
        {mockParams.map((p) => (
          <div key={p.label} className="flex items-center justify-between py-2 border-b border-gray-50">
            <span className="text-sm text-gray-700">{p.label}</span>
            <span className="text-sm font-semibold text-gray-300 blur-sm select-none">██████</span>
          </div>
        ))}
      </div>

      {/* AI insight blurred */}
      <div className="px-5 pb-5">
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">AI-заключение</p>
          <div className="space-y-1.5">
            <div className="h-3 bg-gray-200 rounded blur-sm" style={{ width: '90%' }} />
            <div className="h-3 bg-gray-200 rounded blur-sm" style={{ width: '75%' }} />
            <div className="h-3 bg-gray-200 rounded blur-sm" style={{ width: '82%' }} />
          </div>
        </div>
      </div>

      {/* Overlay prompt */}
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/60 backdrop-blur-[2px]">
        <div className="text-center px-6 py-8 max-w-xs">
          <div className="text-3xl mb-3">🔒</div>
          <p className="font-semibold text-gray-900 text-base mb-1">Анализ готов</p>
          <p className="text-sm text-gray-500 mb-4">
            Оплатите 3 000 ₸ через Kaspi и загрузите чек ниже — отчёт откроется сразу
          </p>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 sm:p-4">
      <div className="text-[10px] sm:text-xs text-gray-400 uppercase tracking-wide mb-0.5 sm:mb-1">{label}</div>
      <div className="text-lg sm:text-xl font-bold text-gray-900">{value}</div>
      <div className="text-[10px] sm:text-xs text-gray-500 mt-0.5">{sub}</div>
    </div>
  );
}
