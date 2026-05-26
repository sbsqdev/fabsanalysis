import { useState, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [needsConfirm, setNeedsConfirm] = useState(false)
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
    if (password.length < 6) {
      setError('Пароль должен быть минимум 6 символов.')
      return
    }
    if (password !== confirm) {
      setError('Пароли не совпадают.')
      return
    }

    setLoading(true)
    const { error: err, needsEmailConfirmation } = await signUp(email.trim().toLowerCase(), password)

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
      setNeedsConfirm(true)
    } else {
      // autoconfirm enabled → go straight to analysis
      navigate('/analysis')
    }
    setLoading(false)
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
          <p className="text-sm font-medium text-charcoal mb-6">{email}</p>
          <p className="text-xs text-muted mb-6">После подтверждения — войдите в систему.</p>
          <button onClick={() => navigate('/login')} className="btn-primary w-full py-3 mb-3">
            Войти →
          </button>
          <button
            className="text-xs text-muted underline"
            onClick={() => { setNeedsConfirm(false); setEmail(''); setPassword(''); setConfirm('') }}
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
        {/* Logo */}
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

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Пароль</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full border border-cream-dark rounded-xl px-4 py-3 text-sm text-charcoal bg-cream focus:outline-none focus:border-charcoal/40 transition-colors"
                placeholder="Минимум 6 символов"
              />
            </div>

            {/* Confirm */}
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Повторите пароль</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full border border-cream-dark rounded-xl px-4 py-3 text-sm text-charcoal bg-cream focus:outline-none focus:border-charcoal/40 transition-colors"
                placeholder="••••••••"
              />
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
