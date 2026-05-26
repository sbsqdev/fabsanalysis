import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useLanguage } from '../lib/language';
import { deleteAnalysisById, fetchAnalysesForUser } from '../lib/analysisStore';
import { computeOverallScore } from '../analysis/scoring';
import type { StoredAnalysisRecord } from '../lib/analysisStore';

function scoreColor(score: number) {
  if (score >= 80) return 'text-emerald-600';
  if (score >= 60) return 'text-brand-500';
  return 'text-amber-500';
}

export default function DashboardPage() {
  const { user, hasAccess, signOut } = useAuth();
  const navigate = useNavigate();
  const { t, lang, setLang } = useLanguage();
  const [analyses, setAnalyses] = useState<StoredAnalysisRecord[]>([]);
  const [loadingAnalyses, setLoadingAnalyses] = useState(true);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const data = await fetchAnalysesForUser(user.id);
        setAnalyses(data);
      } catch (error) {
        console.error('[Dashboard] failed to load analyses:', error);
        setAnalyses([]);
      } finally {
        setLoadingAnalyses(false);
      }
    })();
  }, [user]);

  useEffect(() => {
    if (!menuOpenId) return;
    function onDocumentMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-analysis-menu="true"]')) return;
      setMenuOpenId(null);
    }
    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => document.removeEventListener('mousedown', onDocumentMouseDown);
  }, [menuOpenId]);

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  async function handleDeleteFromDashboard(analysisId: string) {
    if (deletingId) return;
    const ok = window.confirm(t('detail.confirmDelete'));
    if (!ok) return;

    setDeleteError(null);
    setDeletingId(analysisId);
    try {
      await deleteAnalysisById(analysisId, user?.id);
      setAnalyses((prev) => prev.filter((item) => item.id !== analysisId));
      setMenuOpenId(null);
    } catch (error) {
      console.error('[Dashboard] failed to delete analysis:', error);
      setDeleteError(t('detail.deleteError'));
    } finally {
      setDeletingId(null);
    }
  }

  const localeCode = lang === 'en' ? 'en-US' : 'ru-RU';

  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <div className="bg-white border-b border-cream-dark px-6 md:px-12 h-16 flex items-center justify-between">
        <Link to="/" className="font-sans text-xl font-bold text-charcoal">
          FABS <span className="text-gold font-normal">Facial Analysis</span>
        </Link>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}
            className="text-xs font-sans font-medium text-muted hover:text-charcoal transition-colors border border-cream-dark rounded-full px-2.5 py-1"
            aria-label={lang === 'ru' ? t('header.switchToEn') : t('header.switchToRu')}
            title={lang === 'ru' ? t('header.switchToEn') : t('header.switchToRu')}
          >
            {lang === 'ru' ? 'EN' : 'RU'}
          </button>
          <span className="text-sm font-sans text-muted hidden sm:block">{user?.email}</span>
          <button
            onClick={handleSignOut}
            className="text-sm font-sans text-muted hover:text-charcoal transition-colors"
          >
            {t('header.signOut')}
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 md:px-12 py-6 sm:py-12">
        {/* Welcome */}
        <div className="mb-6 sm:mb-10">
          <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-charcoal mb-1">{t('dashboard.title')}</h1>
          <p className="font-sans text-muted text-sm">{user?.email}</p>
        </div>

        {/* Access status */}
        <div
          className={`rounded-2xl p-5 sm:p-6 mb-6 sm:mb-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${
            hasAccess ? 'bg-gold/5 border border-gold/20' : 'bg-cream-dark border border-cream-dark'
          }`}
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${hasAccess ? 'bg-gold' : 'bg-muted/40'}`} />
              <span className="font-sans text-sm font-medium text-charcoal">
                {hasAccess ? t('dashboard.accessActive') : t('dashboard.accessInactive')}
              </span>
            </div>
            <p className="text-xs font-sans text-muted">
              {hasAccess ? t('dashboard.accessActiveDesc') : t('dashboard.accessInactiveDesc')}
            </p>
          </div>
          {hasAccess ? (
            <Link to="/analysis" className="btn-primary text-sm py-2.5 px-6 sm:flex-shrink-0 text-center">
              {t('dashboard.startAnalysis')}
            </Link>
          ) : (
            <Link to="/#pricing" className="btn-outline text-sm py-2.5 px-6 sm:flex-shrink-0 text-center">
              {t('dashboard.getAccess')}
            </Link>
          )}
        </div>

        {/* Analysis history */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-serif text-xl font-semibold text-charcoal">{t('dashboard.historyTitle')}</h2>
            {analyses.length > 0 && (
              <span className="text-xs font-sans text-muted">{analyses.length} {t('dashboard.analysesCount')}</span>
            )}
          </div>
          {deleteError && (
            <p className="text-xs font-sans text-red-600 mb-4">{deleteError}</p>
          )}

          {loadingAnalyses ? (
            <div className="flex items-center gap-3 text-muted">
              <div className="w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-sans">{t('dashboard.loading')}</span>
            </div>
          ) : analyses.length === 0 ? (
            <div className="card text-center py-12">
              <div className="text-4xl mb-3">📊</div>
              <p className="font-serif text-lg text-charcoal mb-2">{t('dashboard.noAnalyses')}</p>
              <p className="text-sm font-sans text-muted mb-6">
                {hasAccess ? t('dashboard.noAnalysesHasAccess') : t('dashboard.noAnalysesNoAccess')}
              </p>
              {hasAccess && (
                <Link to="/analysis" className="btn-primary text-sm">
                  {t('dashboard.runAnalysis')}
                </Link>
              )}
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {analyses.map((a) => {
                const features = a.report_json?.features ?? [];
                const score = a.overall_score ?? (features.length ? computeOverallScore(features) : null);
                const isMenuOpen = menuOpenId === a.id;
                const isDeleting = deletingId === a.id;

                return (
                  <article
                    key={a.id}
                    className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm hover:shadow-md hover:border-brand-100 transition-all duration-200 group"
                  >
                    <Link to={`/analysis/${a.id}`} className="block">
                      {a.thumbnail_url ? (
                        <div className="relative h-36 overflow-hidden bg-gray-50">
                          <img
                            src={a.thumbnail_url}
                            alt={t('dashboard.faceAnalysis')}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                          {score !== null && (
                            <div className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm rounded-xl px-2.5 py-1 shadow-sm">
                              <span className={`text-base font-serif font-bold ${scoreColor(score)}`}>
                                {score}
                              </span>
                              <span className="text-[9px] font-sans text-gray-400">/100</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="relative h-24 bg-gradient-to-br from-brand-50 to-cream-dark flex items-center justify-center">
                          <span className="text-3xl opacity-30">👤</span>
                          {score !== null && (
                            <div className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm rounded-xl px-2.5 py-1 shadow-sm">
                              <span className={`text-base font-serif font-bold ${scoreColor(score)}`}>
                                {score}
                              </span>
                              <span className="text-[9px] font-sans text-gray-400">/100</span>
                            </div>
                          )}
                        </div>
                      )}
                    </Link>

                    <div className="p-4">
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <span className="text-xs font-sans text-muted">
                          {new Date(a.created_at).toLocaleDateString(localeCode, {
                            day: 'numeric', month: 'short', year: 'numeric',
                          })}
                        </span>
                        <div className="relative" data-analysis-menu="true">
                          <button
                            type="button"
                            className="w-7 h-7 rounded-md border border-gray-200 text-gray-500 hover:text-charcoal hover:border-gray-300 hover:bg-gray-50 transition-colors flex items-center justify-center"
                            aria-label={t('header.menu')}
                            title={t('header.menu')}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setMenuOpenId((prev) => (prev === a.id ? null : a.id));
                            }}
                          >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
                            </svg>
                          </button>
                          {isMenuOpen && (
                            <div className="absolute right-0 top-8 z-20 min-w-[170px] rounded-lg border border-gray-200 bg-white shadow-lg p-1">
                              <button
                                type="button"
                                className="w-full text-left text-sm font-sans px-3 py-2 rounded-md text-red-600 hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed"
                                disabled={isDeleting}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  void handleDeleteFromDashboard(a.id);
                                }}
                              >
                                {isDeleting ? t('detail.deleting') : t('detail.deleteAnalysis')}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      <Link
                        to={`/analysis/${a.id}`}
                        className="text-sm font-sans font-semibold text-charcoal hover:underline"
                      >
                        {t('dashboard.faceAnalysis')}
                      </Link>

                      <div className="mt-3 flex items-center justify-between">
                        <Link
                          to={`/analysis/${a.id}`}
                          className="text-[10px] font-sans text-brand-500 font-medium hover:underline"
                        >
                          {t('dashboard.open')}
                        </Link>
                        {features.length > 0 && (
                          <span className="text-[9px] font-sans text-gray-400">
                            {features.length} {t('dashboard.params')}
                          </span>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
