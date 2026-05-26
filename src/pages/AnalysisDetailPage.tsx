import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deleteAnalysisById, fetchAnalysisById } from '../lib/analysisStore';
import RadarInfographic from '../components/RadarInfographic';
import type { FeatureAnalysis, StatusLevel } from '../types';
import { computeOverallScore, countByStatus, averageConfidence } from '../analysis/scoring';
import { featureLabel, statusLabel } from '../i18n';
import type { StoredAnalysisRecord } from '../lib/analysisStore';
import { useAuth } from '../lib/auth';
import { downloadPDF } from '../analysis/exportPdf';
import { useLanguage } from '../lib/language';
import { localizeNarrativeText } from '../lib/narrativeLocalization';

const STATUS_CHIP: Record<StatusLevel, string> = {
  strength: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  within_norm: 'bg-brand-50 text-brand-600 border-brand-200',
  attention: 'bg-amber-100 text-amber-700 border-amber-200',
  insufficient_data: 'bg-gray-100 text-gray-500 border-gray-200',
};

const STATUS_DOT: Record<StatusLevel, string> = {
  strength: 'bg-emerald-500',
  within_norm: 'bg-brand-400',
  attention: 'bg-amber-400',
  insufficient_data: 'bg-gray-300',
};

const FEATURE_ICON: Record<string, string> = {
  Eyebrows: '⌢',
  Eyes: '◉',
  Nose: '▿',
  Cheeks: '◌',
  Jaw: '⬡',
  Lips: '♡',
  Chin: '∧',
  Skin: '✦',
  Neck: '≡',
  Ears: '◗',
};

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-600';
  if (score >= 60) return 'text-brand-500';
  return 'text-amber-500';
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 text-center shadow-sm">
      <p className="text-xs font-sans text-gray-400 mb-1">{label}</p>
      <p className="text-2xl font-serif font-semibold text-charcoal leading-none">{value}</p>
      {sub && <p className="text-[10px] font-sans text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function FeatureTile({
  analysisId,
  feature,
  t,
  lang,
}: {
  analysisId: string;
  feature: FeatureAnalysis;
  t: (key: string) => string;
  lang: 'ru' | 'en';
}) {
  const icon = FEATURE_ICON[feature.name] ?? '○';
  const obs = feature.observations[0]
    ? localizeNarrativeText(feature.observations[0], lang)
    : t('detail.clickToOpen');

  return (
    <Link
      to={`/analysis/${analysisId}/feature/${encodeURIComponent(feature.name)}`}
      className="block rounded-2xl border border-gray-100 bg-white p-4 shadow-sm hover:shadow-md hover:border-brand-100 transition-all duration-200"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center text-sm flex-shrink-0">
            {icon}
          </div>
          <p className="text-sm font-sans font-semibold text-charcoal truncate">{featureLabel(feature.name)}</p>
        </div>
        {feature.status !== 'attention' && (
          <span className={`text-[10px] px-2 py-1 rounded-full border font-sans font-medium whitespace-nowrap ${STATUS_CHIP[feature.status]}`}>
            {statusLabel(feature.status)}
          </span>
        )}
      </div>

      <p className="text-xs font-sans text-gray-500 line-clamp-2 min-h-[2rem]">{obs}</p>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[feature.status]}`} />
          <span className="text-[11px] font-sans text-gray-500">
            {t('detail.scoreLabel')} {Math.round(feature.confidence * 100)}%
          </span>
        </div>
        <span className="text-[11px] font-sans font-medium text-brand-500">{t('detail.more')}</span>
      </div>
    </Link>
  );
}

export default function AnalysisDetailPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useLanguage();
  const [data, setData] = useState<StoredAnalysisRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const localeCode = lang === 'en' ? 'en-US' : 'ru-RU';

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(localeCode, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const row = await fetchAnalysisById(id);
        setData(row);
      } catch (e) {
        console.error('[AnalysisDetail] failed to load analysis:', e);
        setError(t('detail.notFound'));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, t]);

  if (loading) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted">
          <div className="w-5 h-5 border-2 border-muted border-t-transparent rounded-full animate-spin" />
          <span className="font-sans text-sm">{t('detail.loading')}</span>
        </div>
      </div>
    );
  }

  if (error || !data?.report_json) {
    return (
      <div className="min-h-screen bg-cream flex flex-col items-center justify-center gap-4">
        <p className="font-sans text-muted text-sm">{error ?? t('detail.dataUnavailable')}</p>
        <Link to="/dashboard" className="btn-outline text-sm">← {t('detail.dashboard')}</Link>
      </div>
    );
  }

  const report = data.report_json;
  const features = report.features ?? [];
  const score = data.overall_score ?? computeOverallScore(features);
  const counts = countByStatus(features);
  const avgConf = averageConfidence(features);
  const qualityPct = Math.round((data.quality_score ?? report.inputs.qualityScore ?? 0) * 100);

  async function handleDeleteAnalysis() {
    if (!data?.id || deleting) return;
    const ok = window.confirm(t('detail.confirmDelete'));
    if (!ok) return;

    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteAnalysisById(data.id, user?.id);
      navigate('/dashboard', { replace: true });
    } catch (e) {
      console.error('[AnalysisDetail] failed to delete analysis:', e);
      setDeleteError(t('detail.deleteError'));
      setDeleting(false);
    }
  }

  return (
    <div className="min-h-screen bg-cream">
      <div className="bg-white border-b border-cream-dark px-6 md:px-12 h-14 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <Link to="/dashboard" className="text-sm font-sans text-muted hover:text-charcoal transition-colors flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            {t('detail.dashboard')}
          </Link>
          <span className="text-cream-dark">|</span>
          <span className="font-sans text-sm font-semibold text-charcoal">{t('detail.historyTitle')}</span>
        </div>
        <span className="font-sans text-xs text-muted">{formatDate(data.created_at)}</span>
      </div>

      <div className="max-w-5xl mx-auto px-5 md:px-8 py-8 space-y-7">
        <section className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex flex-col sm:flex-row">
            {data.thumbnail_url && (
              <div className="sm:w-56 flex-shrink-0">
                <img src={data.thumbnail_url} alt={t('detail.photoAlt')} className="w-full h-48 sm:h-full object-cover" />
              </div>
            )}
            <div className="flex-1 p-6 flex flex-col justify-between gap-5">
              <div>
                <p className="text-xs font-sans text-gray-400 mb-1">{formatDate(data.created_at)}</p>
                <h1 className="font-serif text-2xl font-semibold text-charcoal">{t('detail.faceAnalysis')}</h1>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="text-[10px] font-sans font-medium px-2.5 py-1 rounded-full bg-brand-50 text-brand-600 border border-brand-200">
                  {t('detail.withinNorm')}: {counts.within_norm + counts.strength}
                </span>
                {counts.insufficient_data > 0 && (
                  <span className="text-[10px] font-sans font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                    {t('detail.insufficientData')}: {counts.insufficient_data}
                  </span>
                )}
              </div>

              <div className="flex items-end gap-2">
                <span className={`font-serif text-5xl font-bold leading-none ${scoreColor(score)}`}>
                  {score}
                </span>
                <span className="font-sans text-lg text-gray-400 mb-1">/100</span>
                <span className="font-sans text-xs text-gray-400 mb-2 ml-1">{t('detail.overallHarmony')}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label={t('detail.photoQuality')} value={`${qualityPct}%`} sub={report.inputs.lightingHeuristic} />
          <MetricCard label={t('detail.paramsCount')} value={String(features.length)} sub={t('detail.inAnalysis')} />
          <MetricCard label={t('detail.avgConfidence')} value={`${Math.round(avgConf * 100)}%`} sub={t('detail.allZones')} />
          <MetricCard label={t('detail.overallScore')} value={String(score)} sub={t('detail.outOf100')} />
        </section>

        <section>
          <RadarInfographic features={features} />
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-serif text-xl font-semibold text-charcoal">{t('detail.faceParams')}</h2>
            <span className="text-xs font-sans text-gray-400">{features.length} {t('detail.cards')}</span>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {features.map((feature) => (
              <FeatureTile key={feature.name} analysisId={data.id} feature={feature} t={t} lang={lang} />
            ))}
          </div>
        </section>

        {report.disclaimer && (
          <p className="text-[10px] font-sans text-gray-400 italic border-t border-gray-100 pt-4">
            {localizeNarrativeText(report.disclaimer, lang)}
          </p>
        )}

        <section className="pt-1">
          <div className="border-t border-gray-100 pt-5 flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => downloadPDF({
                report,
                frontImageDataUrl: data.thumbnail_url ?? null,
                profileImageDataUrls: {},
                aiResult: null,
              })}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg border border-gray-200 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              {t('detail.downloadPdf')}
            </button>
            <button
              type="button"
              onClick={handleDeleteAnalysis}
              disabled={deleting}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm font-medium hover:bg-red-100 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {deleting ? t('detail.deleting') : t('detail.deleteAnalysis')}
            </button>
            {deleteError && (
              <p className="mt-2 text-xs text-red-600">{deleteError}</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
