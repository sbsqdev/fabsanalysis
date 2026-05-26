import { useState } from 'react'
import { Link } from 'react-router-dom'
import CosmeticsApp from '../components/App'
import { useLanguage, useT } from '../lib/language'

export default function AnalysisPage() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { lang, setLang } = useLanguage()
  const t = useT()

  return (
    <div className="min-h-screen bg-cream">
      {/* Header — logo centered, hamburger left */}
      <div className="fixed top-0 left-0 right-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-cream-dark h-12 flex items-center px-4 sm:px-6">
        {/* Hamburger */}
        <button
          onClick={() => setMenuOpen(true)}
          className="w-8 h-8 flex items-center justify-center text-charcoal hover:text-gold transition-colors"
          aria-label={t('analysis.menuOpen')}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>

        {/* Centered logo */}
        <div className="absolute left-1/2 -translate-x-1/2">
          <Link to="/" className="font-sans text-sm sm:text-base font-bold text-charcoal whitespace-nowrap">
            FABS <span className="text-gold font-normal">Facial Analysis</span>
          </Link>
        </div>

        {/* Language switcher */}
        <button
          onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}
          className="ml-auto text-xs font-sans font-medium text-muted hover:text-charcoal transition-colors border border-cream-dark rounded-full px-2.5 py-1"
          aria-label={lang === 'ru' ? t('header.switchToEn') : t('header.switchToRu')}
          title={lang === 'ru' ? t('header.switchToEn') : t('header.switchToRu')}
        >
          {lang === 'ru' ? 'EN' : 'RU'}
        </button>
      </div>

      {/* Sidebar overlay */}
      {menuOpen && (
        <div className="fixed inset-0 z-[60]" onClick={() => setMenuOpen(false)}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

          {/* Sidebar panel */}
          <nav
            className="absolute top-0 left-0 bottom-0 w-72 bg-cream shadow-2xl flex flex-col animate-slide-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sidebar header */}
            <div className="h-14 flex items-center justify-between px-5 border-b border-cream-dark">
              <span className="font-sans font-bold text-charcoal">
                FABS <span className="text-gold font-normal">{t('analysis.menuTitle')}</span>
              </span>
              <button
                onClick={() => setMenuOpen(false)}
                className="w-8 h-8 flex items-center justify-center text-muted hover:text-charcoal transition-colors"
                aria-label={t('analysis.menuClose')}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Navigation links */}
            <div className="flex-1 py-4 px-3 space-y-1">
              <SidebarLink to="/" icon={HomeIcon} label={t('analysis.navHome')} onClick={() => setMenuOpen(false)} />
              <SidebarLink to="/analysis" icon={AnalysisIcon} label={t('analysis.navAnalysis')} onClick={() => setMenuOpen(false)} active />
              <SidebarLink to="/dashboard" icon={DashboardIcon} label={t('analysis.navDashboard')} onClick={() => setMenuOpen(false)} />
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-cream-dark">
              <p className="text-[11px] text-muted font-sans">FABS Facial Analysis</p>
            </div>
          </nav>
        </div>
      )}

      {/* Analysis tool — full cosmetics app */}
      <div className="pt-12">
        <CosmeticsApp />
      </div>
    </div>
  )
}

/* ── Sidebar link component ─────────────────────────────────── */

function SidebarLink({
  to, icon: Icon, label, onClick, active,
}: {
  to: string; icon: React.FC<{ className?: string }>; label: string; onClick: () => void; active?: boolean;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-sans font-medium transition-colors ${
        active
          ? 'bg-brand-100 text-brand-700'
          : 'text-charcoal hover:bg-cream-dark/50'
      }`}
    >
      <Icon className="w-5 h-5" />
      {label}
    </Link>
  )
}

/* ── Icons ───────────────────────────────────────────────────── */

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  )
}

function AnalysisIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
    </svg>
  )
}

function DashboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  )
}
