import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useLanguage } from '../../lib/language'

export default function Header() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const { lang, setLang, t } = useLanguage()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function scrollTo(id: string) {
    setMobileOpen(false)
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth' })
    else navigate('/')
  }

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  const navItems = [
    { id: 'why', label: t('header.whyUs') },
    { id: 'how', label: t('header.howItWorks') },
    { id: 'pricing', label: t('header.pricing') },
    { id: 'faq', label: t('header.faq') },
  ]

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-cream/95 backdrop-blur-sm shadow-sm' : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 md:px-12 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2">
          <span className="font-serif text-xl font-semibold text-charcoal tracking-tight">
            FABS<span className="text-gold"> Facial Analysis</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-8">
          {navItems.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              className="text-sm font-sans text-muted hover:text-charcoal transition-colors"
            >
              {label}
            </button>
          ))}
        </nav>

        {/* CTA + Language switcher */}
        <div className="hidden md:flex items-center gap-3">
          {/* Language switcher */}
          <button
            onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}
            className="text-xs font-sans font-medium text-muted hover:text-charcoal transition-colors border border-cream-dark rounded-full px-2.5 py-1"
            aria-label={lang === 'ru' ? t('header.switchToEn') : t('header.switchToRu')}
            title={lang === 'ru' ? t('header.switchToEn') : t('header.switchToRu')}
          >
            {lang === 'ru' ? 'EN' : 'RU'}
          </button>

          {user ? (
            <>
              <Link to="/dashboard" className="btn-outline text-sm py-2 px-5">
                {t('header.dashboard')}
              </Link>
              <button onClick={handleSignOut} className="text-sm text-muted hover:text-charcoal transition-colors">
                {t('header.signOut')}
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-sm font-sans text-muted hover:text-charcoal transition-colors">
                {t('header.signIn')}
              </Link>
              <button onClick={() => scrollTo('pricing')} className="btn-primary text-sm py-2.5 px-6">
                {t('header.getStarted')}
              </button>
            </>
          )}
        </div>

        {/* Mobile burger */}
        <button
          className="md:hidden p-2 text-charcoal"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={t('header.menu')}
        >
          <div className="w-5 flex flex-col gap-1.5">
            <span className={`block h-0.5 bg-charcoal transition-all ${mobileOpen ? 'rotate-45 translate-y-2' : ''}`} />
            <span className={`block h-0.5 bg-charcoal transition-all ${mobileOpen ? 'opacity-0' : ''}`} />
            <span className={`block h-0.5 bg-charcoal transition-all ${mobileOpen ? '-rotate-45 -translate-y-2' : ''}`} />
          </div>
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-cream border-t border-cream-dark px-6 py-4 flex flex-col gap-4">
          {navItems.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              className="text-left text-sm font-sans text-charcoal py-1"
            >
              {label}
            </button>
          ))}

          {/* Language switcher (mobile) */}
          <button
            onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}
            className="text-left text-sm font-sans text-muted py-1"
            aria-label={lang === 'ru' ? t('header.switchToEn') : t('header.switchToRu')}
          >
            {lang === 'ru' ? t('header.languageEnglish') : t('header.languageRussian')}
          </button>

          <div className="pt-2 border-t border-cream-dark flex flex-col gap-2">
            {user ? (
              <>
                <Link to="/dashboard" className="btn-primary text-sm text-center">{t('header.dashboard')}</Link>
                <button onClick={handleSignOut} className="text-sm text-muted text-center">{t('header.signOut')}</button>
              </>
            ) : (
              <>
                <Link to="/login" className="btn-outline text-sm text-center">{t('header.signIn')}</Link>
                <button onClick={() => scrollTo('pricing')} className="btn-primary text-sm text-center">{t('header.getStarted')}</button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
