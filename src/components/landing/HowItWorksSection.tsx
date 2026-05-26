import { useT } from '../../lib/language'

export default function HowItWorksSection() {
  const t = useT()

  const STEPS = [
    { num: '01', title: t('how.step1.title'), desc: t('how.step1.desc') },
    { num: '02', title: t('how.step2.title'), desc: t('how.step2.desc') },
    { num: '03', title: t('how.step3.title'), desc: t('how.step3.desc') },
    { num: '04', title: t('how.step4.title'), desc: t('how.step4.desc') },
  ]

  return (
    <section id="how" className="section-padding bg-cream">
      <div className="max-w-7xl mx-auto">
        <div className="max-w-2xl mb-16">
          <p className="text-xs font-sans uppercase tracking-widest text-gold mb-3">{t('how.label')}</p>
          <h2 className="font-serif text-3xl sm:text-4xl md:text-5xl font-semibold text-charcoal leading-tight">
            {t('how.title')}{' '}
            <em className="italic" style={{ fontStyle: 'italic' }}>{t('how.titleAccent')}</em>
          </h2>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {STEPS.map(({ num, title, desc }, i) => (
            <div key={num} className="relative">
              {i < STEPS.length - 1 && (
                <div className="hidden lg:block absolute top-6 left-full w-6 h-px bg-gold/30 z-10" />
              )}
              <div className="card h-full">
                <div className="font-serif text-5xl font-semibold text-gold/20 mb-4 leading-none">{num}</div>
                <h3 className="font-serif text-lg font-semibold text-charcoal mb-3">{title}</h3>
                <p className="text-sm font-sans text-muted leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
