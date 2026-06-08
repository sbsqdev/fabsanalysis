import { useState, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { track, EVENTS } from '../lib/analytics'

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [loading, setLoading] = useState(false)
  const { signUp } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (!email.includes('@') || email.length < 5) {
      setError('Введите корректный email-адрес.')
      return
    }

    const digits = phone.replace(/\D/g, '')
    if (!phone.trim() || digits.length < 10 || digits.length > 12) {
      setError('Введите корректный номер телефона (+7 701 000 00 00).')
      return
    }

    if (password.length < 6) {
      setError('Пароль должен быть минимум 6 символов.')
      return
    }

    const cleanPhone = `+${digits.replace(/^8/, '7')}`
    setLoading(true)
    const { error: err, needsEmailConfirmation } = await signUp(email.trim().toLowerCase(), password, cleanPhone)

    if (err) {
      const msg = err.message?.toLowerCase() ?? ''
      if (msg.includes('already registered') || msg.includes('already been registered') || msg.includes('user already exists')) {
        setError('Этот email уже зарегистрирован. Попробуйте войти.')
      } else if (msg.includes('rate limit')) {
        setError('Слишком много попыток. Подождите немного.')
      } else if (msg.includes('invalid email')) {
        setError('Некорректный email-адрес.')
      } else {
        setError('Ошибка регистрации. Попробуйте ещё раз.')
      }
    } else if (needsEmailConfirmation) {
      track(EVENTS.USER_REGISTERED, { needs_email_confirmation: true })
      setNeedsConfirm(true)
    } else {
      track(EVENTS.USER_REGISTERED, { needs_email_confirmation: false })
      navigate('/analysis')
    }
    setLoading(false)
  }

  async function handleResend() {
    if (resending || resent) return
    setResending(true)
    await supabase.auth.resend({ type: 'signup', email: email.trim().toLowerCase() })
    setResending(false)
    setResent(true)
  }

  if (needsConfirm) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-5">
            <svg className="w-7 h-7 text-emerald-500" fill="none" viewBox="0 0 24 24">
              <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="font-serif text-2xl font-semibold text-charcoal mb-2">Аккаунт создан!</h2>
          <p className="text-sm text-muted mb-1 leading-relaxed">
            Письмо с подтверждением отправлено на
          </p>
          <p className="text-sm font-medium text-charcoal mb-4">{email}</p>
          <p className="text-xs text-muted mb-6 leading-relaxed">
            Перейдите по ссылке в письме, затем войдите. Письмо может прийти в папку «Спам».
          </p>

          <button onClick={() => navigate('/login')} className="btn-primary w-full py-3 mb-3">
            Войти →
          </button>

          <button
            className="w-full text-sm text-muted hover:text-charcoal transition-colors py-2 disabled:opacity-50"
            disabled={resending || resent}
            onClick={handleResend}
          >
            {resent ? '✓ Письмо отправлено повторно' : resending ? 'Отправляем...' : 'Отправить письмо ещё раз'}
          </button>

          <button
            className="text-xs text-muted underline mt-3 block mx-auto"
            onClick={() => { setNeedsConfirm(false); setEmail(''); setPhone(''); setPassword('') }}
          >
            Зарегистрировать другой email
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Link to="/" className="block text-center mb-8">
          <span className="font-serif text-2xl font-semibold text-charcoal">
            FABS <span className="text-gold font-normal">× ProFace</span>
          </span>
        </Link>

        <div className="bg-white rounded-2xl p-8 shadow-sm border border-cream-dark">
          <h1 className="font-serif text-2xl font-semibold text-charcoal mb-1">Создать аккаунт</h1>
          <p className="text-sm text-muted mb-6">Регистрация бесплатна · доступ открывается после оплаты 3 000 ₸</p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Email */}
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
                className="w-full border border-cream-dark rounded-xl px-4 py-3 text-sm text-charcoal bg-cream focus:outline-none focus:border-charcoal/40 transition-colors"
                placeholder="you@example.com"
              />
            </div>

            {/* Phone — required */}
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">
                Номер телефона
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted select-none">📞</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  autoComplete="tel"
                  className="w-full border border-cream-dark rounded-xl pl-9 pr-4 py-3 text-sm text-charcoal bg-cream focus:outline-none focus:border-charcoal/40 transition-colors"
                  placeholder="+7 701 000 00 00"
                />
              </div>
              <p className="text-[10px] text-muted/60 mt-1 pl-1">Специалист ProFace свяжется с вами по этому номеру</p>
            </div>

            {/* Password with show/hide */}
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Пароль</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="w-full border border-cream-dark rounded-xl px-4 pr-10 py-3 text-sm text-charcoal bg-cream focus:outline-none focus:border-charcoal/40 transition-colors"
                  placeholder="Минимум 6 символов"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-charcoal transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Создание аккаунта...' : 'Зарегистрироваться →'}
            </button>
          </form>

          <p className="text-center text-sm text-muted mt-6">
            Уже есть аккаунт?{' '}
            <Link to="/login" className="text-charcoal hover:underline font-medium">
              Войти
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
