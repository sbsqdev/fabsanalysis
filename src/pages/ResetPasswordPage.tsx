import { useState, FormEvent, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const navigate = useNavigate()

  // Supabase puts the recovery token in the URL hash — it auto-exchanges it
  // and fires onAuthStateChange with event = 'PASSWORD_RECOVERY'
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true)
      }
    })
    // Also check if session already exists (user navigated here with valid token)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('Пароль должен быть минимум 6 символов.')
      return
    }
    if (password !== confirm) {
      setError('Пароли не совпадают.')
      return
    }

    setLoading(true)
    const { error: err } = await supabase.auth.updateUser({ password })

    if (err) {
      setError('Не удалось обновить пароль. Попробуйте запросить ссылку заново.')
    } else {
      navigate('/analysis')
    }
    setLoading(false)
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="w-10 h-10 rounded-full border-2 border-charcoal/20 border-t-charcoal animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted">Проверяем ссылку...</p>
          <p className="text-xs text-muted mt-4">
            Если ничего не происходит,{' '}
            <Link to="/forgot-password" className="underline text-charcoal">запросите новую ссылку</Link>
          </p>
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
          <h1 className="font-serif text-2xl font-semibold text-charcoal mb-1">Новый пароль</h1>
          <p className="text-sm text-muted mb-6">Придумайте новый пароль для вашего аккаунта</p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Новый пароль</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                autoComplete="new-password"
                className="w-full border border-cream-dark rounded-xl px-4 py-3 text-sm text-charcoal bg-cream focus:outline-none focus:border-charcoal/40 transition-colors"
                placeholder="Минимум 6 символов"
              />
            </div>

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
              {loading ? 'Сохраняем...' : 'Сохранить пароль →'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
