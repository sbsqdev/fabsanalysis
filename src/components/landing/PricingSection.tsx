import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useT } from '../../lib/language'

export default function PricingSection() {
  const navigate = useNavigate()
  const { user, hasAccess } = useAuth()
  const t = useT()

  const INCLUDED = [
    t('pricing.included1'),
    t('pricing.included2'),
    t('pricing.included3'),
    t('pricing.included4'),
    t('pricing.included5'),
    t('pricing.included6'),
    t('pricing.included7'),
  ]

  async function handleBuy() {
    if (!user) {
      navigate('/register')
      return
    }
    if (hasAccess) {
      navigate('/analysis')
      return
    }

    // Create Stripe checkout session
    const res = await fetch('/api/payment/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, email: user.email }),
    })
    const { url } = await res.json() as { url: string }
    if (url) window.location.href = url
  }

  return (
    <section id="pricing" className="section-padding bg-cream">
      <div className="max-w-7xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <p className="text-xs font-sans uppercase tracking-widest text-gold mb-3">{t('pricing.label')}</p>
          <h2 className="font-serif text-3xl sm:text-4xl md:text-5xl font-semibold text-charcoal leading-tight mb-4">
            {t('pricing.title')}{' '}
            <em className="italic" style={{ fontStyle: 'italic' }}>{t('pricing.titleAccent')}</em>
          </h2>
          <p className="font-sans text-muted text-base">
            {t('pricing.subtitle')}
          </p>
        </div>

        <div className="max-w-md mx-auto">
          <div className="bg-white rounded-3xl shadow-xl p-8 md:p-10 border border-cream-dark">
            <div className="text-center mb-8">
              <div className="flex items-start justify-center gap-1 mb-2">
                <span className="font-serif text-2xl font-semibold text-charcoal mt-3">$</span>
                <span className="font-serif text-7xl font-semibold text-charcoal leading-none">150</span>
              </div>
              <p className="text-sm font-sans text-muted">{t('pricing.priceNote')}</p>
            </div>

            <div className="flex flex-col gap-3 mb-8">
              {INCLUDED.map((item) => (
                <div key={item} className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full bg-gold/15 flex items-center justify-center flex-shrink-0">
                    <svg className="w-2.5 h-2.5 text-gold" fill="none" viewBox="0 0 10 10">
                      <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <span className="text-sm font-sans text-charcoal">{item}</span>
                </div>
              ))}
            </div>

            <button
              onClick={handleBuy}
              className="btn-primary w-full text-base py-4"
            >
              {hasAccess ? t('pricing.ctaHasAccess') : t('pricing.ctaNoAccess')}
            </button>

            <div className="flex justify-center gap-6 mt-6">
              {[t('pricing.guarantee1'), t('pricing.guarantee2'), t('pricing.guarantee3')].map((g) => (
                <span key={g} className="text-xs font-sans text-muted">{g}</span>
              ))}
            </div>
          </div>
        </div>

        <p className="text-center text-xs font-sans text-muted mt-6">
          {t('pricing.paymentMethods')}
        </p>
      </div>
    </section>
  )
}
