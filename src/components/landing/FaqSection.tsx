import { useState } from 'react'
import { useT } from '../../lib/language'

export default function FaqSection() {
  const [open, setOpen] = useState<number | null>(null)
  const t = useT()

  const FAQS = [
    { q: t('faq.q1'), a: t('faq.a1') },
    { q: t('faq.q2'), a: t('faq.a2') },
    { q: t('faq.q3'), a: t('faq.a3') },
    { q: t('faq.q4'), a: t('faq.a4') },
    { q: t('faq.q5'), a: t('faq.a5') },
    { q: t('faq.q6'), a: t('faq.a6') },
    { q: t('faq.q7'), a: t('faq.a7') },
    { q: t('faq.q8'), a: t('faq.a8') },
  ]

  return (
    <section id="faq" className="section-padding bg-white">
      <div className="max-w-7xl mx-auto">
        <div className="max-w-2xl mb-12">
          <p className="text-xs font-sans uppercase tracking-widest text-gold mb-3">{t('faq.label')}</p>
          <h2 className="font-serif text-3xl sm:text-4xl md:text-5xl font-semibold text-charcoal leading-tight">
            {t('faq.title')}
          </h2>
        </div>

        <div className="max-w-3xl divide-y divide-cream-dark">
          {FAQS.map(({ q, a }, i) => (
            <div key={i}>
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between py-5 text-left gap-4"
              >
                <span className="font-serif text-base font-medium text-charcoal">{q}</span>
                <span className={`flex-shrink-0 w-6 h-6 rounded-full border border-charcoal/20 flex items-center justify-center transition-transform duration-200 ${open === i ? 'rotate-45' : ''}`}>
                  <svg className="w-3 h-3 text-charcoal" fill="none" viewBox="0 0 12 12">
                    <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </span>
              </button>
              <div
                style={{ maxHeight: open === i ? '300px' : '0', overflow: 'hidden', transition: 'max-height 0.3s ease' }}
              >
                <p className="pb-5 text-sm font-sans text-muted leading-relaxed">{a}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
