import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchAnalysisById } from '../lib/analysisStore';
import type { FeatureAnalysis, StatusLevel } from '../types';
import { computeProportions } from '../analysis/proportions';
import { featureLabel, statusLabel } from '../i18n';
import MeasurementTooltip from '../components/MeasurementTooltip';
import ProportionBar from '../components/ProportionBar';
import type { StoredAnalysisRecord } from '../lib/analysisStore';
import { useLanguage } from '../lib/language';
import { localizeNarrativeText } from '../lib/narrativeLocalization';

const STATUS_CHIP: Record<StatusLevel, string> = {
  strength: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  within_norm: 'bg-brand-50 text-brand-600 border-brand-200',
  attention: 'bg-amber-100 text-amber-700 border-amber-200',
  insufficient_data: 'bg-gray-100 text-gray-500 border-gray-200',
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

export default function AnalysisFeaturePage() {
  const { id, featureName } = useParams<{ id: string; featureName: string }>();
  const { t, lang } = useLanguage();
  const [data, setData] = useState<StoredAnalysisRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        console.error('[AnalysisFeature] failed to load feature page data:', e);
        setError(t('feature.notFound'));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, t]);

  const decodedFeatureName = featureName ? decodeURIComponent(featureName) : '';
  const feature: FeatureAnalysis | null = useMemo(() => {
    const features = data?.report_json?.features ?? [];
    return features.find((f) => f.name === decodedFeatureName) ?? null;
  }, [data?.report_json?.features, decodedFeatureName]);

  const proportions = useMemo(() => {
    if (!feature) return null;
    try {
      return computeProportions(feature.name, feature.measurements, null, 'default');
    } catch {
      return null;
    }
  }, [feature, lang]);

  const proportionMeasurementKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!proportions?.items?.length) return keys;
    for (const item of proportions.items) {
      if (item.key && !item.key.startsWith('_')) keys.add(item.key);
    }
    return keys;
  }, [proportions]);

  const additionalMeasurements = useMemo(() => {
    if (!feature) return [];
    return Object.entries(feature.measurements).filter(([key]) => !proportionMeasurementKeys.has(key));
  }, [feature, proportionMeasurementKeys]);

  if (loading) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted">
          <div className="w-5 h-5 border-2 border-muted border-t-transparent rounded-full animate-spin" />
          <span className="font-sans text-sm">{t('feature.loading')}</span>
        </div>
      </div>
    );
  }

  if (error || !data?.report_json || !feature) {
    return (
      <div className="min-h-screen bg-cream flex flex-col items-center justify-center gap-4">
        <p className="font-sans text-muted text-sm">{error ?? t('feature.notFound')}</p>
        <Link to={id ? `/analysis/${id}` : '/dashboard'} className="btn-outline text-sm">{t('feature.back')}</Link>
      </div>
    );
  }

  const icon = FEATURE_ICON[feature.name] ?? '○';

  return (
    <div className="min-h-screen bg-cream">
      <div className="bg-white border-b border-cream-dark px-6 md:px-12 h-14 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <Link to={`/analysis/${id}`} className="text-sm font-sans text-muted hover:text-charcoal transition-colors flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            {t('feature.analysis')}
          </Link>
          <span className="text-cream-dark">|</span>
          <span className="font-sans text-sm font-semibold text-charcoal">{featureLabel(feature.name)}</span>
        </div>
        <span className="font-sans text-xs text-muted">{formatDate(data.created_at)}</span>
      </div>

      <div className="max-w-3xl mx-auto px-5 md:px-8 py-8 space-y-6">
        <section className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center text-lg flex-shrink-0">
                {icon}
              </div>
              <div className="min-w-0">
                <h1 className="font-serif text-2xl text-charcoal truncate">{featureLabel(feature.name)}</h1>
                <p className="text-xs font-sans text-gray-400 mt-0.5">{t('feature.detailTitle')}</p>
              </div>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full border font-sans font-medium ${STATUS_CHIP[feature.status]}`}>
              {statusLabel(feature.status)}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="text-[11px] font-sans px-2.5 py-1 rounded-full bg-gray-50 text-gray-600 border border-gray-200">
              {t('feature.overallScore')}: {Math.round(feature.confidence * 100)}%
            </span>
            <span className="text-[11px] font-sans px-2.5 py-1 rounded-full bg-gray-50 text-gray-600 border border-gray-200">
              {t('feature.measurements')}: {Object.keys(feature.measurements).length}
            </span>
            {proportions && (
              <span className="text-[11px] font-sans px-2.5 py-1 rounded-full bg-gray-50 text-gray-600 border border-gray-200">
                {t('feature.proportions')}: {proportions.items.length}
              </span>
            )}
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <h2 className="font-serif text-lg text-charcoal mb-3">{t('feature.observationsTitle')}</h2>
          {feature.observations.length > 0 ? (
            <ul className="space-y-1.5">
              {feature.observations.map((observation, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm font-sans text-gray-600">
                  <span className="w-1.5 h-1.5 mt-2 rounded-full bg-gray-300 flex-shrink-0" />
                  <span>{localizeNarrativeText(observation, lang)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm font-sans text-gray-500">{t('feature.noObservations')}</p>
          )}
        </section>

        <section className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <h2 className="font-serif text-lg text-charcoal mb-3">{t('featureCard.extraMeasurements')}</h2>
          {additionalMeasurements.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
              {additionalMeasurements.map(([key, value]) => (
                <MeasurementTooltip key={key} measurementKey={key} value={value} />
              ))}
            </div>
          ) : (
            <p className="text-sm font-sans text-gray-500">{t('feature.noMeasurements')}</p>
          )}
        </section>

        {proportions && proportions.items.length > 0 && (
          <section className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <h2 className="font-serif text-lg text-charcoal mb-3">{t('feature.proportionsTitle')}</h2>
            <div className="space-y-1 divide-y divide-gray-50">
              {proportions.items.map((item) => (
                <ProportionBar key={item.key} item={item} />
              ))}
            </div>
            {proportions.note && (
              <p className="mt-2 text-[10px] text-gray-400 italic">{proportions.note}</p>
            )}
          </section>
        )}

        <section className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <h2 className="font-serif text-lg text-charcoal mb-3">{t('feature.recommendationsTitle')}</h2>
          {feature.recommendations.length > 0 ? (
            <ul className="space-y-1.5">
              {feature.recommendations.map((recommendation, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm font-sans text-gray-600">
                  <span className="text-brand-400 flex-shrink-0">→</span>
                  <span>{localizeNarrativeText(recommendation, lang)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm font-sans text-gray-500">{t('feature.noRecommendations')}</p>
          )}
        </section>

      </div>
    </div>
  );
}
