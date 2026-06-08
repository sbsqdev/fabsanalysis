import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const PROFACE_URL = 'https://proface.kz'
const WA_BOOKING_URL = `https://api.whatsapp.com/send/?phone=77015557893&text=${encodeURIComponent('Добрый день! Хочу записаться на консультацию в ProFace 💋')}&type=phone_number&app_absent=0`

function WaIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current shrink-0">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
      <path d="M12 0C5.373 0 0 5.373 0 12c0 2.089.537 4.05 1.476 5.757L.057 23.882a.5.5 0 0 0 .61.61l6.249-1.418A11.944 11.944 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.647-.523-5.148-1.43l-.369-.217-3.818.867.882-3.703-.231-.378A9.96 9.96 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
    </svg>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function LandingPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  function goToAnalysis() {
    navigate(user ? '/analysis' : '/register')
  }

  return (
    <div className="bg-[#0D0A0B] text-white min-h-screen overflow-x-hidden font-sans">
      <LandingNav goToAnalysis={goToAnalysis} />
      <HeroSection goToAnalysis={goToAnalysis} />
      <StatsStrip />
      <HowItWorksSection goToAnalysis={goToAnalysis} />
      <InsightsTeaser goToAnalysis={goToAnalysis} />
      <ProFaceSection />
      <ReviewsSection />
      <TrustSection />
      <PricingSection goToAnalysis={goToAnalysis} />
      <FinalCTASection goToAnalysis={goToAnalysis} />
      <LandingFooter />
    </div>
  )
}

// ─── Nav ─────────────────────────────────────────────────────────────────────

function LandingNav({ goToAnalysis }: { goToAnalysis: () => void }) {
  const [scrolled, setScrolled] = useState(false)
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 30)
    window.addEventListener('scroll', h, { passive: true })
    return () => window.removeEventListener('scroll', h)
  }, [])

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-[#0D0A0B]/95 backdrop-blur-md border-b border-white/[0.06]' : ''
      }`}
    >
      <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <span className="font-serif text-lg font-semibold text-white tracking-tight">FABS</span>
          <span className="text-white/20 text-sm select-none">×</span>
          <img src="/brand/proface-white.png" alt="ProFace" className="h-6 w-auto" />
        </div>

        {/* Right */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <Link
                to="/dashboard"
                className="hidden sm:block text-sm text-white/50 hover:text-white transition-colors"
              >
                Кабинет
              </Link>
              <button
                onClick={handleSignOut}
                className="hidden sm:block text-sm text-white/30 hover:text-white/60 transition-colors"
              >
                Выйти
              </button>
            </>
          ) : (
            <Link
              to="/login"
              className="text-sm text-white/50 hover:text-white transition-colors"
            >
              Войти
            </Link>
          )}
          <button
            onClick={goToAnalysis}
            className="bg-rose-500 hover:bg-rose-400 active:scale-95 text-white text-sm font-semibold px-4 py-2 rounded-full transition-all duration-150"
          >
            Начать анализ
          </button>
        </div>
      </div>
    </nav>
  )
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function HeroSection({ goToAnalysis }: { goToAnalysis: () => void }) {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center text-center px-5 pt-24 pb-20 overflow-hidden">
      {/* Background glows */}
      <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-rose-500/10 blur-[140px]" />
        <div className="absolute top-2/3 right-1/4 w-[350px] h-[350px] rounded-full bg-pink-700/6 blur-[100px]" />
        <div className="absolute top-1/4 left-1/4 w-[250px] h-[250px] rounded-full bg-rose-900/8 blur-[80px]" />
      </div>

      <div className="relative max-w-4xl mx-auto">
        {/* Pill badge */}
        <div className="inline-flex items-center gap-2 bg-white/[0.06] border border-white/[0.1] rounded-full px-4 py-1.5 mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse flex-shrink-0" />
          <span className="text-[11px] text-white/55 font-medium tracking-widest uppercase">
            AI-анализ губ · ProFace Казахстан
          </span>
        </div>

        {/* Headline */}
        <h1 className="font-serif text-[2.8rem] sm:text-6xl md:text-7xl font-semibold leading-[1.05] mb-6 tracking-tight">
          <span className="text-white">Что AI видит</span>
          <br />
          <span
            className="italic"
            style={{
              background: 'linear-gradient(135deg, #fb7185 0%, #f9a8d4 50%, #fb7185 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            в ваших губах
          </span>
          <br />
          <span className="text-white/90">за 2 минуты</span>
        </h1>

        {/* Subheadline */}
        <p className="text-white/55 text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed mb-10">
          8 параметров: симметрия, пропорции, лук Купидона, объём и форма.
          <br className="hidden sm:block" />
          Получите точный отчёт с цифрами и готовый план — что, как и зачем корректировать.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-10">
          <button
            onClick={goToAnalysis}
            className="relative w-full sm:w-auto group bg-rose-500 hover:bg-rose-400 active:scale-[0.98] text-white font-semibold text-base px-8 py-4 rounded-2xl transition-all duration-150 shadow-[0_0_40px_-8px_rgba(244,63,94,0.5)] hover:shadow-[0_0_60px_-8px_rgba(244,63,94,0.65)]"
          >
            Начать анализ — 3 000 ₸
            <span className="absolute -top-2.5 -right-2.5 bg-amber-400 text-[#0D0A0B] text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide shadow-lg">
              Kaspi
            </span>
          </button>
          <a
            href={WA_BOOKING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto flex items-center justify-center gap-2 border border-white/[0.15] hover:border-[#25D366]/50 hover:bg-[#25D366]/10 text-white/65 hover:text-white font-medium text-sm px-7 py-4 rounded-2xl transition-all duration-150"
          >
            <WaIcon />
            Записаться в WhatsApp
          </a>
        </div>

        {/* Trust row */}
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-white/30">
          <span>✓ Kaspi / Карта</span>
          <span>✓ Результат за 2 минуты</span>
          <span>✓ Алматы · Астана</span>
          <span>✓ Фото не сохраняются</span>
        </div>
      </div>

      {/* Scroll nudge */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 opacity-20 select-none">
        <div className="w-px h-8 bg-gradient-to-b from-transparent to-white/60" />
        <svg className="w-3 h-3 text-white animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </section>
  )
}

// ─── Stats strip ──────────────────────────────────────────────────────────────

function StatsStrip() {
  const stats = [
    { value: '847+', label: 'анализов выполнено' },
    { value: '8', label: 'параметров губ' },
    { value: '2 мин', label: 'время анализа' },
    { value: '98%', label: 'точность AI' },
  ]

  return (
    <div className="border-y border-white/[0.05] bg-white/[0.018]">
      <div className="max-w-6xl mx-auto px-5 py-5 grid grid-cols-2 sm:grid-cols-4 gap-y-4">
        {stats.map(({ value, label }) => (
          <div key={label} className="text-center px-4">
            <div className="font-serif text-2xl sm:text-3xl font-semibold text-white mb-0.5">
              {value}
            </div>
            <div className="text-[11px] text-white/30 uppercase tracking-wide">{label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── How it works ─────────────────────────────────────────────────────────────

function HowItWorksSection({ goToAnalysis }: { goToAnalysis: () => void }) {
  const steps = [
    {
      num: '01',
      emoji: '📸',
      title: 'Загружаете фото',
      desc: 'Фронтальное + профили (опционально). Хорошее освещение и нейтральное выражение — лучший результат.',
    },
    {
      num: '02',
      emoji: '🔬',
      title: 'AI анализирует губы',
      desc: 'Измеряет симметрию, пропорции, форму лука Купидона, объём и ещё 4 параметра по 478 точкам.',
    },
    {
      num: '03',
      emoji: '💋',
      title: 'Получаете персональный план',
      desc: 'Конкретные цифры по каждому параметру, рекомендации специалиста и возможность сразу записаться в ProFace.',
    },
  ]

  return (
    <section className="py-20 sm:py-28 px-5">
      <div className="max-w-6xl mx-auto">
        {/* Section label */}
        <div className="text-center mb-14">
          <p className="text-rose-400/80 text-xs font-semibold tracking-[0.2em] uppercase mb-4">
            Как это работает
          </p>
          <h2 className="font-serif text-3xl sm:text-4xl md:text-5xl font-semibold text-white leading-tight">
            Три шага до
            <br />
            <span className="italic text-white/60">понимания своих губ</span>
          </h2>
        </div>

        {/* Steps */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-12">
          {steps.map((step, i) => (
            <div
              key={i}
              className="relative bg-white/[0.025] hover:bg-white/[0.04] border border-white/[0.07] rounded-2xl p-6 sm:p-8 transition-colors duration-200"
            >
              {/* Number watermark */}
              <span className="absolute top-5 right-6 font-serif text-5xl font-bold text-white/[0.04] select-none">
                {step.num}
              </span>
              <span className="text-4xl block mb-5">{step.emoji}</span>
              <h3 className="font-semibold text-white text-lg mb-2.5">{step.title}</h3>
              <p className="text-white/45 text-sm leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>

        <div className="text-center">
          <button
            onClick={goToAnalysis}
            className="bg-rose-500 hover:bg-rose-400 active:scale-[0.98] text-white font-semibold px-8 py-3.5 rounded-xl transition-all duration-150"
          >
            Начать анализ — 3 000 ₸ →
          </button>
        </div>
      </div>
    </section>
  )
}

// ─── Insights teaser ─────────────────────────────────────────────────────────

function InsightsTeaser({ goToAnalysis }: { goToAnalysis: () => void }) {
  // Neutral framing: show what the report looks like without judging the person
  const params = [
    {
      label: 'Симметрия контура',
      value: '87%',
      bar: 87,
      note: 'Небольшая разница уголков — возможность для коррекции',
      color: 'rose',
    },
    {
      label: 'Соотношение верх / низ',
      value: '1 : 1.41',
      bar: 72,
      note: 'Ваше соотношение чуть отличается от классического 1 : 1.6',
      color: 'amber',
    },
    {
      label: 'Форма лука Купидона',
      value: 'Мягкий контур',
      bar: 80,
      note: 'Выразительный силуэт — есть потенциал для акцента',
      color: 'amber',
    },
    {
      label: 'Общий объём',
      value: 'В норме',
      bar: 94,
      note: 'Параметр в хорошем диапазоне',
      color: 'emerald',
    },
  ]

  return (
    <section className="py-20 sm:py-28 px-5 bg-white/[0.012]">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-rose-400/80 text-xs font-semibold tracking-[0.2em] uppercase mb-4">
            Что вы получите за 3 000 ₸
          </p>
          <h2 className="font-serif text-3xl sm:text-4xl font-semibold text-white mb-4 leading-tight">
            Полный разбор ваших губ —
            <br />
            <span className="italic text-white/55">цифры, карта, план действий</span>
          </h2>
          <p className="text-white/35 text-sm max-w-lg mx-auto">
            Не просто «красиво / некрасиво» — конкретные измерения по 8 параметрам и рекомендации, что именно корректировать
          </p>
        </div>

        {/* Mock report card */}
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl overflow-hidden mb-8">
          {/* Report header */}
          <div className="px-6 pt-5 pb-4 border-b border-white/[0.06] flex items-center justify-between">
            <div>
              <p className="text-white font-semibold text-base">Анализ губ</p>
              <p className="text-white/30 text-xs mt-0.5">Пример результата · 8 параметров</p>
            </div>
            <div className="flex gap-2">
              <span className="bg-blue-500/15 border border-blue-500/25 text-blue-300 text-xs font-medium px-2.5 py-1 rounded-full">
                В норме
              </span>
              <span className="bg-white/[0.06] border border-white/[0.1] text-white/40 text-xs px-2.5 py-1 rounded-full">
                Точность 91%
              </span>
            </div>
          </div>

          {/* Parameters */}
          <div className="divide-y divide-white/[0.05]">
            {params.map((p, i) => (
              <div key={i} className="px-6 py-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-white/60 text-xs uppercase tracking-wider">{p.label}</p>
                  <p className="text-white font-semibold text-sm">{p.value}</p>
                </div>
                {/* Progress bar */}
                <div className="h-1.5 bg-white/[0.08] rounded-full overflow-hidden mb-2">
                  <div
                    className={`h-full rounded-full transition-all ${
                      p.color === 'emerald' ? 'bg-emerald-400/70'
                      : p.color === 'amber' ? 'bg-amber-400/70'
                      : 'bg-rose-400/70'
                    }`}
                    style={{ width: `${p.bar}%` }}
                  />
                </div>
                <p className="text-white/30 text-xs">{p.note}</p>
              </div>
            ))}

            {/* Locked parameters */}
            <div className="px-6 py-4 flex items-center gap-3">
              <div className="flex-1">
                <div className="h-2 bg-white/[0.06] rounded-full blur-[2px] mb-2" />
                <div className="h-1.5 bg-white/[0.04] rounded-full blur-[2px] w-3/4" />
              </div>
              <span className="text-white/20 text-xs flex-shrink-0">🔒 +4 параметра</span>
            </div>
          </div>

          {/* AI insight teaser */}
          <div className="px-6 py-4 bg-rose-500/[0.05] border-t border-rose-500/[0.12]">
            <p className="text-[11px] text-rose-300/60 uppercase tracking-widest mb-1.5">
              AI-рекомендация специалиста
            </p>
            <p className="text-white/50 text-sm leading-relaxed">
              На основе ваших параметров специалист ProFace подберёт&nbsp;
              <span className="text-white/70">оптимальный объём и технику введения</span>
              &nbsp;— для естественного результата именно под вашу форму.
            </p>
          </div>
        </div>

        {/* Dual CTA: analysis OR direct booking */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={goToAnalysis}
            className="inline-flex items-center justify-center gap-2 bg-rose-500 hover:bg-rose-400 active:scale-[0.98] text-white font-semibold text-sm px-7 py-3.5 rounded-xl transition-all duration-150 shadow-[0_4px_20px_-4px_rgba(244,63,94,0.4)]"
          >
            Получить свой анализ — 3 000 ₸
          </button>
          <a
            href={WA_BOOKING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 bg-white/[0.05] hover:bg-[#25D366]/15 border border-white/[0.12] hover:border-[#25D366]/40 text-white/70 hover:text-white font-medium text-sm px-7 py-3.5 rounded-xl transition-all duration-150"
          >
            <WaIcon />
            Записаться без анализа
          </a>
        </div>
      </div>
    </section>
  )
}

// ─── ProFace section ──────────────────────────────────────────────────────────

function ProFaceSection() {
  const procedures = [
    {
      icon: '💉',
      name: 'Гиалуроновые филлеры',
      desc: 'Объём и мягкий контур без операции. Эффект сразу.',
    },
    {
      icon: '✏️',
      name: 'Контуринг лука Купидона',
      desc: 'Чёткость и выразительность — губы выглядят ухоженно.',
    },
    {
      icon: '🌹',
      name: 'Техника «русских губ»',
      desc: 'Естественная пухлость без чрезмерного увеличения.',
    },
    {
      icon: '📐',
      name: 'Коррекция уголков губ',
      desc: 'Уголки вверх — лицо выглядит моложе и свежее.',
    },
  ]

  return (
    <section className="py-20 sm:py-28 px-5">
      <div className="max-w-6xl mx-auto">
        {/* Heading */}
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2.5 border border-rose-500/25 bg-rose-500/[0.06] rounded-full px-5 py-1.5 mb-6">
            <span className="text-rose-400 text-sm font-bold tracking-wide">ProFace</span>
            <span className="text-white/15">·</span>
            <span className="text-white/40 text-xs tracking-wide">Казахстан</span>
          </div>
          <h2 className="font-serif text-3xl sm:text-4xl md:text-5xl font-semibold text-white mb-5 leading-tight">
            Специалисты ProFace
            <br />
            <span className="italic text-white/55">превратят анализ в результат</span>
          </h2>
          <p className="text-white/40 text-base max-w-xl mx-auto leading-relaxed">
            Certified косметологи с опытом от 5 лет.{' '}
            <span className="text-white/65 font-medium">
              Консультация + план коррекции — бесплатно
            </span>{' '}
            при предъявлении AI-отчёта.
          </p>
        </div>

        {/* Procedures */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-10">
          {procedures.map((p, i) => (
            <div
              key={i}
              className="flex items-start gap-4 bg-white/[0.025] hover:bg-white/[0.04] border border-white/[0.06] rounded-xl p-5 transition-colors duration-200"
            >
              <span className="text-2xl flex-shrink-0 mt-0.5">{p.icon}</span>
              <div>
                <p className="font-semibold text-white text-sm mb-1">{p.name}</p>
                <p className="text-white/40 text-sm leading-snug">{p.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Locations + CTA */}
        <div className="bg-gradient-to-br from-rose-500/[0.1] to-pink-700/[0.04] border border-rose-500/[0.18] rounded-2xl p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="flex-1 text-center sm:text-left">
              <p className="text-rose-400/80 text-xs font-semibold uppercase tracking-widest mb-4">
                Наши города
              </p>
              <div className="flex justify-center sm:justify-start gap-8">
                {[
                  { city: 'Алматы', sub: '5 клиник' },
                  { city: 'Астана', sub: '2 клиники' },
                ].map(({ city, sub }) => (
                  <div key={city}>
                    <p className="font-serif text-xl font-semibold text-white">{city}</p>
                    <p className="text-white/35 text-xs mt-0.5">{sub}</p>
                  </div>
                ))}
              </div>
            </div>
            <a
              href={WA_BOOKING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 w-full sm:w-auto flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#22c55e] active:scale-[0.98] text-white font-semibold px-7 py-3.5 rounded-xl transition-all duration-150 text-sm"
            >
              <WaIcon />
              Записаться в WhatsApp
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

function PricingSection({ goToAnalysis }: { goToAnalysis: () => void }) {
  const included = [
    'Полный AI-анализ 8 параметров губ',
    'Цифры и расшифровка каждого параметра',
    'AI-визуализация результата коррекции',
    'Персональный план процедуры',
    'Скидка 10% на первую процедуру в ProFace',
    'PDF-отчёт для косметолога',
  ]

  return (
    <section className="py-20 sm:py-28 px-5 bg-white/[0.012]" id="pricing">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-10">
          <p className="text-rose-400/80 text-xs font-semibold tracking-[0.2em] uppercase mb-4">
            Стоимость
          </p>
          <h2 className="font-serif text-3xl sm:text-4xl font-semibold text-white">
            Один платёж
          </h2>
        </div>

        <div className="bg-white/[0.04] border border-white/[0.09] rounded-2xl overflow-hidden">
          {/* Price area */}
          <div className="bg-gradient-to-b from-rose-500/[0.12] to-transparent px-8 pt-8 pb-6 text-center border-b border-white/[0.06]">
            <div className="flex items-end justify-center gap-2 mb-1">
              <span className="font-serif text-6xl font-semibold text-white tracking-tight">3 000</span>
              <span className="text-2xl text-white/50 mb-2 font-light">₸</span>
            </div>
            <p className="text-white/30 text-sm">разовый платёж · без подписки</p>
          </div>

          {/* Included */}
          <div className="px-7 py-6">
            <ul className="space-y-3.5 mb-7">
              {included.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-rose-500/20 flex items-center justify-center mt-[1px]">
                    <svg
                      className="w-2.5 h-2.5 text-rose-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <span className="text-white/65 leading-snug">{item}</span>
                </li>
              ))}
            </ul>

            {/* Payment methods */}
            <div className="bg-white/[0.04] rounded-xl p-4 mb-6 text-center">
              <p className="text-white/25 text-[10px] uppercase tracking-widest mb-2.5">
                Оплата
              </p>
              <div className="flex justify-center gap-2 flex-wrap">
                <span className="bg-amber-400/10 border border-amber-400/20 text-amber-400 text-xs font-semibold px-3 py-1 rounded-full">
                  Kaspi QR
                </span>
                <span className="bg-amber-400/10 border border-amber-400/20 text-amber-400 text-xs font-semibold px-3 py-1 rounded-full">
                  Kaspi.kz
                </span>
                <span className="bg-white/[0.06] border border-white/[0.1] text-white/40 text-xs font-semibold px-3 py-1 rounded-full">
                  Visa / MC
                </span>
              </div>
            </div>

            <button
              onClick={goToAnalysis}
              className="w-full bg-rose-500 hover:bg-rose-400 active:scale-[0.99] text-white font-semibold py-4 rounded-xl transition-all duration-150 text-base shadow-[0_4px_24px_-4px_rgba(244,63,94,0.4)]"
            >
              Начать анализ →
            </button>
            <p className="text-center text-white/20 text-xs mt-3">
              Оплата после регистрации
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Reviews / before-after ────────────────────────────────────────────────────

const PLACEHOLDER_GRADIENTS = [
  'from-rose-900/40 via-purple-900/30 to-rose-800/40',
  'from-purple-900/40 via-rose-900/30 to-purple-800/40',
  'from-pink-900/40 via-rose-900/30 to-pink-800/40',
  'from-rose-800/40 via-pink-900/30 to-purple-900/40',
  'from-purple-800/40 via-rose-800/30 to-pink-900/40',
]

function ReviewCard({ review, index = 0 }: { review: { img: string; name: string; city: string; text: string }; index?: number }) {
  const [imgFailed, setImgFailed] = useState(false)
  return (
    <figure className="snap-center shrink-0 w-[80vw] max-w-[320px] sm:w-auto sm:max-w-none bg-white/[0.03] border border-white/[0.07] rounded-2xl overflow-hidden flex flex-col">
      <div className="relative aspect-[4/5]">
        {!imgFailed ? (
          <img
            src={review.img}
            alt={`Результат коррекции губ — ${review.name}, ${review.city}`}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className={`w-full h-full bg-gradient-to-br ${PLACEHOLDER_GRADIENTS[index % PLACEHOLDER_GRADIENTS.length]} flex items-center justify-center`}>
            <span className="text-5xl opacity-30">💋</span>
          </div>
        )}
        <span className="absolute top-3 left-3 bg-[#0D0A0B]/70 backdrop-blur-sm text-white/80 text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full">
          До · После
        </span>
      </div>
      <figcaption className="p-5 flex flex-col gap-2.5 flex-1">
        <div className="flex text-rose-400 text-sm" aria-label="Оценка 5 из 5">{'★★★★★'}</div>
        <p className="text-white/55 text-sm leading-relaxed flex-1">«{review.text}»</p>
        <p className="text-white/70 text-sm font-medium">
          {review.name}
          <span className="text-white/30 font-normal"> · {review.city}</span>
        </p>
      </figcaption>
    </figure>
  )
}

function ReviewsSection() {
  const reviews = [
    {
      img: '/reviews/before-after-1.jpg',
      name: 'Алия',
      city: 'Алматы',
      text: 'Делала губы по технике «русские губы». Объём появился, но выглядит абсолютно естественно — именно то, что хотела.',
    },
    {
      img: '/reviews/before-after-2.jpg',
      name: 'Динара',
      city: 'Астана',
      text: 'AI-анализ показал асимметрию уголков, о которой я даже не догадывалась. Скорректировали — улыбка стала ровнее.',
    },
    {
      img: '/reviews/before-after-3.jpg',
      name: 'Камила',
      city: 'Алматы',
      text: 'Боялась «уточек», но специалист подобрал объём строго по моим пропорциям. Результат мягкий и аккуратный.',
    },
    {
      img: '/reviews/before-after-4.jpg',
      name: 'Сабина',
      city: 'Алматы',
      text: 'Поправили лук Купидона — губы стали выразительнее, но всё в моём характере. Очень довольна.',
    },
    {
      img: '/reviews/before-after-5.jpg',
      name: 'Жанель',
      city: 'Астана',
      text: 'Пришла с отчётом из приложения, по нему сразу составили план. Никакого навязывания — только то, что нужно.',
    },
  ]

  return (
    <section className="py-20 sm:py-28 px-5">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-rose-400/80 text-xs font-semibold tracking-[0.2em] uppercase mb-4">
            Результаты · до и после
          </p>
          <h2 className="font-serif text-3xl sm:text-4xl md:text-5xl font-semibold text-white mb-4 leading-tight">
            Реальные работы
            <br />
            <span className="italic text-white/55">специалистов ProFace</span>
          </h2>
          <p className="text-white/35 text-sm max-w-lg mx-auto">
            Естественный объём и гармоничная форма — без эффекта «перекаченных» губ
          </p>
        </div>

        {/* Horizontal scroll on mobile, grid on desktop */}
        <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory sm:grid sm:grid-cols-3 sm:overflow-visible scrollbar-none">
          {reviews.map((r, i) => (
            <ReviewCard key={i} review={r} index={i} />
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Trust / license ────────────────────────────────────────────────────────────

function TrustSection() {
  return (
    <section className="py-16 sm:py-20 px-5 bg-white/[0.012] border-y border-white/[0.05]">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col md:flex-row items-center gap-8 md:gap-12">
          {/* License preview */}
          <a
            href={PROFACE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative shrink-0"
          >
            <div className="w-44 sm:w-52 bg-white p-1.5 rounded-lg border border-white/[0.1] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.8)] transition-transform duration-200 group-hover:scale-[1.02]">
              <img
                src="/legal/license.png"
                alt="Лицензия на медицинскую деятельность ТОО ProFace №20019614"
                loading="lazy"
                className="w-full block rounded-[3px]"
              />
            </div>
            <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-rose-500 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full whitespace-nowrap shadow-lg">
              Гос. лицензия
            </span>
          </a>

          {/* Trust copy */}
          <div className="text-center md:text-left">
            <p className="text-rose-400/80 text-xs font-semibold tracking-[0.2em] uppercase mb-4">
              Лицензированная клиника
            </p>
            <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-white mb-4 leading-tight">
              Официальная медицинская
              <br className="hidden sm:block" /> лицензия №20019614
            </h2>
            <p className="text-white/45 text-sm leading-relaxed max-w-xl mb-6">
              ProFace — лицензированная клиника эстетической медицины.
              Процедуры проводят сертифицированные косметологи с опытом
              от 5 лет, в Алматы и Астане, по протоколам доказательной медицины.
            </p>
            <div className="flex flex-wrap justify-center md:justify-start gap-x-6 gap-y-2 text-xs text-white/35">
              <span>✓ ТОО «ProFace»</span>
              <span>✓ Сертифицированные специалисты</span>
              <span>✓ Стерильные расходники</span>
              <span>✓ Алматы · Астана</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Final CTA ────────────────────────────────────────────────────────────────

function FinalCTASection({ goToAnalysis }: { goToAnalysis: () => void }) {
  return (
    <section className="py-24 sm:py-36 px-5 text-center relative overflow-hidden">
      {/* Glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-rose-500/[0.08] blur-[120px]" />
      </div>

      <div className="relative max-w-3xl mx-auto">
        <h2 className="font-serif text-4xl sm:text-5xl md:text-6xl font-semibold text-white mb-6 leading-[1.05]">
          Узнайте о своих губах
          <br />
          <span
            className="italic"
            style={{
              background: 'linear-gradient(135deg, #fb7185 0%, #f9a8d4 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            прямо сейчас
          </span>
        </h2>

        <p className="text-white/40 text-base sm:text-lg mb-12 max-w-xl mx-auto leading-relaxed">
          Сделайте AI-анализ за 2 минуты и получите конкретный план — или сразу напишите специалисту ProFace в WhatsApp.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={goToAnalysis}
            className="w-full sm:w-auto bg-rose-500 hover:bg-rose-400 active:scale-[0.98] text-white font-semibold px-9 py-4 rounded-2xl transition-all duration-150 text-base shadow-[0_0_50px_-10px_rgba(244,63,94,0.5)]"
          >
            Начать анализ — 3 000 ₸
          </button>
          <a
            href={WA_BOOKING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto flex items-center justify-center gap-2 border border-white/[0.15] hover:border-[#25D366]/50 hover:bg-[#25D366]/10 text-white/60 hover:text-white font-medium px-8 py-4 rounded-2xl transition-all duration-150 text-sm"
          >
            <WaIcon />
            Записаться в WhatsApp
          </a>
        </div>
      </div>
    </section>
  )
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function LandingFooter() {
  return (
    <footer className="border-t border-white/[0.05] py-10 px-5">
      <div className="max-w-6xl mx-auto flex flex-col items-center gap-6">
        <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-2.5">
            <span className="font-serif text-sm font-semibold text-white/40">FABS</span>
            <span className="text-white/15 text-xs">×</span>
            <img src="/brand/proface-white.png" alt="ProFace" className="h-5 w-auto opacity-50" />
          </div>

          <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-[11px] text-white/25">
            <Link to="/login" className="hover:text-white/50 transition-colors">
              Войти
            </Link>
            <Link to="/register" className="hover:text-white/50 transition-colors">
              Регистрация
            </Link>
            <Link to="/oferta" className="hover:text-white/50 transition-colors">
              Публичная оферта
            </Link>
            <Link to="/privacy" className="hover:text-white/50 transition-colors">
              Конфиденциальность
            </Link>
            <a href={PROFACE_URL} target="_blank" rel="noopener noreferrer" className="hover:text-white/50 transition-colors">
              ProFace.kz
            </a>
          </div>
        </div>

        <div className="w-full pt-5 border-t border-white/[0.04] flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-white/20">
          <p>ТОО «ProFace» · Лицензия №20019614 · Алматы · Астана</p>
          <p className="text-center">
            © {new Date().getFullYear()} ProFace Kazakhstan · Результаты носят информационный характер
          </p>
        </div>
      </div>
    </footer>
  )
}
