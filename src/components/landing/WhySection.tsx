import { useT } from '../../lib/language'

export default function WhySection() {
  const t = useT()

  const STATS = [
    { value: t('why.stat1.value'), label: t('why.stat1.label'), desc: t('why.stat1.desc') },
    { value: t('why.stat2.value'), label: t('why.stat2.label'), desc: t('why.stat2.desc') },
    { value: t('why.stat3.value'), label: t('why.stat3.label'), desc: t('why.stat3.desc') },
    { value: t('why.stat4.value'), label: t('why.stat4.label'), desc: t('why.stat4.desc') },
  ]

  const BENEFITS = [
    { title: t('why.benefit1.title'), desc: t('why.benefit1.desc') },
    { title: t('why.benefit2.title'), desc: t('why.benefit2.desc') },
    { title: t('why.benefit3.title'), desc: t('why.benefit3.desc') },
    { title: t('why.benefit4.title'), desc: t('why.benefit4.desc') },
  ]

  return (
    <section id="why" className="section-padding bg-white">
      <div className="max-w-7xl mx-auto">
        <div className="max-w-2xl mb-16">
          <p className="text-xs font-sans uppercase tracking-widest text-gold mb-3">{t('why.label')}</p>
          <h2 className="font-serif text-3xl sm:text-4xl md:text-5xl font-semibold text-charcoal leading-tight">
            {t('why.title')}{' '}
            <em className="italic" style={{ fontStyle: 'italic' }}>{t('why.titleAccent')}</em>
          </h2>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-20">
          {STATS.map(({ value, label, desc }) => (
            <div key={label} className="card hover:shadow-md">
              <div className="font-serif text-4xl font-semibold text-charcoal mb-1">{value}</div>
              <div className="text-sm font-sans font-medium text-gold mb-2">{label}</div>
              <p className="text-xs font-sans text-muted leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {BENEFITS.map(({ title, desc }) => (
            <div key={title} className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-gold/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <div className="w-2 h-2 rounded-full bg-gold" />
              </div>
              <div>
                <h3 className="font-serif text-lg font-semibold text-charcoal mb-2">{title}</h3>
                <p className="text-sm font-sans text-muted leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
