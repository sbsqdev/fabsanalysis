import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchAnalysisById } from '../lib/analysisStore';
import { track, EVENTS } from '../lib/analytics';
import type { FeatureAnalysis, StatusLevel } from '../types';
import { computeProportions } from '../analysis/proportions';
import { featureLabel, statusLabel } from '../i18n';
import ProportionBar from '../components/ProportionBar';
import MeasurementCard from '../components/MeasurementCard';
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

const WA_URL = `https://api.whatsapp.com/send/?phone=77015557893&text=${encodeURIComponent('Добрый день! Хочу записаться на консультацию в ProFace 💋')}&type=phone_number&app_absent=0`

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
    if (featureName) {
      track(EVENTS.FEATURE_DETAIL_VIEWED, {
        analysis_id: id,
        feature_name: decodeURIComponent(featureName),
      });
    }
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
  }, [id, featureName, t]);

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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {additionalMeasurements.map(([key, value]) => (
                <MeasurementCard
                  key={key}
                  measurementKey={key}
                  value={value}
                  status={feature.status}
                />
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

        <section className="rounded-2xl overflow-hidden border border-indigo-100 bg-gradient-to-br from-indigo-50 to-purple-50 p-5">
          <div className="flex items-start gap-3 mb-4">
            <span className="text-2xl leading-none mt-0.5">💬</span>
            <div>
              <h3 className="font-serif text-lg text-charcoal mb-1">Разберитесь в результатах с экспертом</h3>
              <p className="text-sm text-gray-500 leading-snug">
                Специалист ProFace расшифрует все показатели и составит персональный план коррекции именно под ваши параметры.
              </p>
            </div>
          </div>
          <a
            href={WA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full bg-[#25D366] hover:bg-[#22c55e] active:scale-[0.98] text-white font-semibold py-3 rounded-xl transition-all text-sm"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current shrink-0">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.089.537 4.05 1.476 5.757L.057 23.882a.5.5 0 0 0 .61.61l6.249-1.418A11.944 11.944 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.647-.523-5.148-1.43l-.369-.217-3.818.867.882-3.703-.231-.378A9.96 9.96 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
            </svg>
            Записаться в WhatsApp
          </a>
        </section>

      </div>
    </div>
  );
}
