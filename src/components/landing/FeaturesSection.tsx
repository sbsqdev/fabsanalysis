import { useT } from '../../lib/language'

export default function FeaturesSection() {
  const t = useT()

  const FEATURES = [
    { icon: '👁', name: t('features.eyebrows'), metrics: t('features.eyebrowsMetrics') },
    { icon: '👀', name: t('features.eyes'), metrics: t('features.eyesMetrics') },
    { icon: '👃', name: t('features.nose'), metrics: t('features.noseMetrics') },
    { icon: '🫦', name: t('features.lips'), metrics: t('features.lipsMetrics') },
    { icon: '✦', name: t('features.cheeks'), metrics: t('features.cheeksMetrics') },
    { icon: '◻', name: t('features.jaw'), metrics: t('features.jawMetrics') },
    { icon: '◡', name: t('features.chin'), metrics: t('features.chinMetrics') },
    { icon: '✦', name: t('features.skin'), metrics: t('features.skinMetrics') },
    { icon: '◜', name: t('features.neck'), metrics: t('features.neckMetrics') },
    { icon: '◝', name: t('features.ears'), metrics: t('features.earsMetrics') },
  ]

  const TRANSFORMS = [
    t('features.t.eyebrows'),
    t('features.t.lips'),
    t('features.t.eyes'),
    t('features.t.nose'),
    t('features.t.cheeks'),
    t('features.t.chin'),
    t('features.t.skin'),
  ]

  return (
    <section id="features" className="section-padding bg-white">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="max-w-2xl mb-12">
          <p className="text-xs font-sans uppercase tracking-widest text-gold mb-3">{t('features.label')}</p>
          <h2 className="font-serif text-3xl sm:text-4xl md:text-5xl font-semibold text-charcoal leading-tight">
            {t('features.title')}{' '}
            <em className="italic" style={{ fontStyle: 'italic' }}>{t('features.titleAccent')}</em>
          </h2>
        </div>

        {/* Features grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-16">
          {FEATURES.map(({ icon, name, metrics }) => (
            <div
              key={name}
              className="card hover:shadow-sm group cursor-default"
            >
              <div className="text-2xl mb-3">{icon}</div>
              <div className="font-serif text-base font-semibold text-charcoal mb-1">{name}</div>
              <div className="text-xs font-sans text-muted">{metrics}</div>
            </div>
          ))}
        </div>

        {/* AI Transformations */}
        <div className="bg-charcoal rounded-3xl p-8 md:p-12">
          <div className="flex flex-col md:flex-row gap-8 items-start">
            <div className="flex-1">
              <p className="text-xs font-sans uppercase tracking-widest text-gold mb-3">{t('features.aiLabel')}</p>
              <h3 className="font-serif text-3xl font-semibold text-white mb-4 leading-tight">
                {t('features.aiTitle')}{' '}
                <em className="italic text-gold" style={{ fontStyle: 'italic' }}>{t('features.aiTitleAccent')}</em>
              </h3>
              <p className="font-sans text-sm text-white/60 leading-relaxed">
                {t('features.aiDesc')}
              </p>
            </div>
            <div className="flex-1">
              <div className="flex flex-col gap-2">
                {TRANSFORMS.map((tr) => (
                  <div key={tr} className="flex items-center gap-3 text-sm font-sans text-white/70">
                    <span className="w-1.5 h-1.5 rounded-full bg-gold flex-shrink-0" />
                    {tr}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
