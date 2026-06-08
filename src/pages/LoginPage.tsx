import { useState, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

/** Return true if the input looks like a phone number (starts with +7, 8, or 7 followed by digits). */
function isPhoneInput(val: string): boolean {
  const stripped = val.replace(/[\s\-()]/g, '')
  return /^(\+7|7|8)\d{7,}$/.test(stripped)
}

/** Normalise phone to E.164 +7XXXXXXXXXX */
function normalisePhone(val: string): string {
  const digits = val.replace(/\D/g, '')
  return `+${digits.replace(/^(7|8)/, '7')}`
}

export default function LoginPage() {
  const [identifier, setIdentifier] = useState('')   // email OR phone
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn } = useAuth()
  const navigate = useNavigate()

  const isPhone = isPhoneInput(identifier.trim())

  async function resolveEmail(raw: string): Promise<string | null> {
    const phone = normalisePhone(raw)
    // Look up email by phone via backend endpoint (requires SUPABASE_SERVICE_KEY on server).
    try {
      const res = await fetch('/api/phone-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      if (!res.ok) return null
      const data = await res.json() as { email?: string }
      return data.email ?? null
    } catch {
      return null
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    let email = identifier.trim().toLowerCase()

    // If user entered a phone number — resolve it to an email via backend
    if (isPhone) {
      const resolved = await resolveEmail(identifier.trim())
      if (!resolved) {
        setError('Аккаунт с таким номером не найден. Войдите через email.')
        setLoading(false)
        return
      }
      email = resolved
    }

    const { error: err } = await signIn(email, password)
    if (err) {
      const msg = err.message?.toLowerCase() ?? ''
      if (msg.includes('email not confirmed')) {
        setError('Подтвердите email — проверьте почту и перейдите по ссылке.')
      } else if (msg.includes('invalid login') || msg.includes('invalid credentials')) {
        setError(isPhone ? 'Неверный номер или пароль.' : 'Неверный email или пароль.')
      } else if (msg.includes('rate limit')) {
        setError('Слишком много попыток. Подождите немного.')
      } else {
        setError('Ошибка входа. Попробуйте ещё раз.')
      }
    } else {
      // If phone was entered — save it to profile for future lookups
      if (isPhone) {
        const phone = normalisePhone(identifier.trim())
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          await supabase.from('profiles').upsert(
            { id: user.id, phone },
            { onConflict: 'id' },
          )
        }
      }
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
              <label className="block text-xs font-medium text-muted mb-1.5">
                Email или номер телефона
              </label>
              <div className="relative">
                {isPhone && (
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted select-none">📞</span>
                )}
                <input
                  type="text"
                  inputMode={isPhone ? 'tel' : 'email'}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  autoFocus
                  autoComplete="username"
                  className={`w-full border border-cream-dark rounded-xl py-3 text-sm text-charcoal bg-cream focus:outline-none focus:border-charcoal/40 transition-colors ${isPhone ? 'pl-9 pr-4' : 'px-4'}`}
                  placeholder="you@example.com или +7 701 ..."
                />
              </div>
              {isPhone && (
                <p className="text-[10px] text-indigo-500 mt-1 pl-1">Войдёте через номер телефона</p>
              )}
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

          <p className="text-center mt-4">
            <Link to="/forgot-password" className="text-xs text-muted hover:text-charcoal underline transition-colors">
              Забыли пароль?
            </Link>
          </p>

          <p className="text-center text-sm text-muted mt-4">
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
