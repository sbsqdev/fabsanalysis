import { useState, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: err } = await signIn(email.trim().toLowerCase(), password)
    if (err) {
      const msg = err.message?.toLowerCase() ?? ''
      if (msg.includes('email not confirmed')) {
        setError('Подтвердите email — проверьте почту и перейдите по ссылке.')
      } else if (msg.includes('invalid login') || msg.includes('invalid credentials')) {
        setError('Неверный email или пароль.')
      } else if (msg.includes('rate limit')) {
        setError('Слишком много попыток. Подождите немного.')
      } else {
        setError('Ошибка входа. Попробуйте ещё раз.')
      }
    } else {
      navigate('/analysis')
    }
    setLoading(false)
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
          <h1 className="font-serif text-2xl font-semibold text-charcoal mb-6">Войти</h1>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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

            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Пароль</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
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
              {loading ? 'Вход...' : 'Войти →'}
            </button>
          </form>

          <p className="text-center text-sm text-muted mt-6">
            Нет аккаунта?{' '}
            <Link to="/register" className="text-charcoal hover:underline font-medium">
              Зарегистрироваться
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
