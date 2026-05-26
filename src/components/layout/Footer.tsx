import { Link } from 'react-router-dom'
import { useT } from '../../lib/language'

export default function Footer() {
  const t = useT()

  return (
    <footer className="bg-charcoal text-white px-6 md:px-12 lg:px-24 py-12">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between gap-8 mb-10">
          <div>
            <span className="font-serif text-xl font-semibold">
              FABS<span className="text-gold"> Facial Analysis</span>
            </span>
            <p className="mt-2 text-sm text-white/50 max-w-xs font-sans">
              {t('footer.desc')}
            </p>
          </div>

          <div className="flex gap-16">
            <div>
              <p className="text-xs font-sans uppercase tracking-widest text-white/40 mb-3">{t('footer.product')}</p>
              <div className="flex flex-col gap-2">
                <Link to="/#why" className="text-sm text-white/70 hover:text-white transition-colors">{t('header.whyUs')}</Link>
                <Link to="/#how" className="text-sm text-white/70 hover:text-white transition-colors">{t('header.howItWorks')}</Link>
                <Link to="/#pricing" className="text-sm text-white/70 hover:text-white transition-colors">{t('header.pricing')}</Link>
                <Link to="/#faq" className="text-sm text-white/70 hover:text-white transition-colors">{t('header.faq')}</Link>
              </div>
            </div>
            <div>
              <p className="text-xs font-sans uppercase tracking-widest text-white/40 mb-3">{t('footer.legal')}</p>
              <div className="flex flex-col gap-2">
                <Link to="/privacy" className="text-sm text-white/70 hover:text-white transition-colors">{t('footer.privacy')}</Link>
                <Link to="/terms" className="text-sm text-white/70 hover:text-white transition-colors">{t('footer.terms')}</Link>
                <a href="mailto:support@faceinsight.ai" className="text-sm text-white/70 hover:text-white transition-colors">{t('footer.contact')}</a>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 pt-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs text-white/30 font-sans">{t('footer.copyright').replace('{year}', String(new Date().getFullYear()))}</p>
          <p className="text-xs text-white/30 font-sans text-center max-w-sm">
            {t('footer.disclaimer')}
          </p>
        </div>
      </div>
    </footer>
  )
}
