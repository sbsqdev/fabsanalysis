import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

const ADMIN_EMAILS = ['tolegenaiteni@gmail.com', 'diana@proface.kz', 'aruzhanzakirova8@gmail.com']

interface UserRow {
  id: string
  email: string
  phone: string
  subscription_status: 'pro' | 'pending' | string
  created_at: string
  analyses_count: number
}

function Badge({ status }: { status: string }) {
  const isPro = status === 'pro'
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
        isPro
          ? 'bg-emerald-100 text-emerald-700'
          : 'bg-gray-100 text-gray-500'
      }`}
    >
      {isPro ? '✦ Pro' : '○ Pending'}
    </span>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
  })
}

export default function AdminPage() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  const [users, setUsers]           = useState<UserRow[]>([])
  const [fetching, setFetching]     = useState(true)
  const [search, setSearch]         = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'pro' | 'pending'>('all')
  const [toggling, setToggling]     = useState<string | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [toast, setToast]           = useState<string | null>(null)

  const isAdmin = ADMIN_EMAILS.includes(user?.email?.toLowerCase() ?? '')

  // Auth guard
  useEffect(() => {
    if (!loading && !user) navigate('/login', { replace: true })
  }, [loading, user, navigate])

  async function getToken() {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? ''
  }

  const fetchUsers = useCallback(async () => {
    setFetching(true)
    setError(null)
    try {
      const token = await getToken()
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const res = await fetch(`/api/admin?type=users&${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      const j = await res.json() as { users: UserRow[] }
      setUsers(j.users)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setFetching(false)
    }
  }, [search, statusFilter])

  useEffect(() => {
    if (isAdmin) void fetchUsers()
  }, [isAdmin, fetchUsers])

  async function togglePro(u: UserRow) {
    const newStatus = u.subscription_status === 'pro' ? 'pending' : 'pro'
    setToggling(u.id)
    try {
      const token = await getToken()
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id, status: newStatus }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      setUsers((prev) =>
        prev.map((x) => x.id === u.id ? { ...x, subscription_status: newStatus } : x),
      )
      const label = newStatus === 'pro' ? '✅ Pro выдан' : '🔒 Pro отозван'
      setToast(`${label}: ${u.email || u.phone}`)
      setTimeout(() => setToast(null), 3000)
    } catch (e) {
      setToast(`❌ ${e instanceof Error ? e.message : 'Ошибка'}`)
      setTimeout(() => setToast(null), 4000)
    } finally {
      setToggling(null)
    }
  }

  // ── Loading / Not-admin states ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0D0A0B] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#0D0A0B] flex flex-col items-center justify-center text-white gap-4">
        <p className="text-4xl">🚫</p>
        <p className="text-lg font-semibold">Нет доступа</p>
        <p className="text-sm text-white/50">Эта страница только для администратора.</p>
        <button onClick={() => navigate('/')} className="mt-2 text-rose-400 text-sm underline">
          На главную
        </button>
      </div>
    )
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const proCount     = users.filter((u) => u.subscription_status === 'pro').length
  const pendingCount = users.filter((u) => u.subscription_status !== 'pro').length

  return (
    <div className="min-h-screen bg-[#0D0A0B] text-white">

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-white text-gray-900 text-sm font-semibold px-4 py-2.5 rounded-xl shadow-2xl animate-fade-in">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-white/40 hover:text-white/80 transition-colors text-sm">
            ← Назад
          </button>
          <span className="text-white/20">|</span>
          <span className="font-serif text-lg font-semibold">FABS Admin</span>
        </div>
        <span className="text-xs text-white/30">{user?.email}</span>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">

        {/* Stats cards */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Всего пользователей', value: users.length, color: 'text-white' },
            { label: '✦ Pro',               value: proCount,      color: 'text-emerald-400' },
            { label: '○ Pending',           value: pendingCount,  color: 'text-white/40' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <p className="text-xs text-white/40 mb-1">{label}</p>
              <p className={`text-3xl font-semibold ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Search + filter */}
        <div className="flex gap-3 mb-5">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchUsers()}
            placeholder="Поиск по email или телефону..."
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-rose-500/50 transition-colors"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'pro' | 'pending')}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white/80 outline-none focus:border-rose-500/50 transition-colors cursor-pointer"
          >
            <option value="all">Все статусы</option>
            <option value="pro">✦ Pro</option>
            <option value="pending">○ Pending</option>
          </select>
          <button
            onClick={fetchUsers}
            className="bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
          >
            Найти
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-xl mb-5">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_1fr_80px_60px_100px] gap-4 px-5 py-3 border-b border-white/10 text-xs text-white/40 font-semibold uppercase tracking-wider">
            <span>Email</span>
            <span>Телефон</span>
            <span>Статус</span>
            <span>Анализы</span>
            <span>Действие</span>
          </div>

          {/* Rows */}
          {fetching ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-16 text-white/30 text-sm">
              Пользователи не найдены
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="grid grid-cols-[1fr_1fr_80px_60px_100px] gap-4 px-5 py-3.5 items-center hover:bg-white/[0.03] transition-colors"
                >
                  {/* Email */}
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{u.email || '—'}</p>
                    <p className="text-[11px] text-white/30">{formatDate(u.created_at)}</p>
                  </div>

                  {/* Phone */}
                  <p className="text-sm text-white/60 truncate">{u.phone || '—'}</p>

                  {/* Status */}
                  <Badge status={u.subscription_status} />

                  {/* Analyses count */}
                  <p className="text-sm text-white/60 text-center">{u.analyses_count}</p>

                  {/* Toggle button */}
                  <button
                    disabled={toggling === u.id}
                    onClick={() => togglePro(u)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${
                      toggling === u.id
                        ? 'opacity-50 cursor-not-allowed bg-white/10 text-white/40'
                        : u.subscription_status === 'pro'
                        ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20'
                        : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'
                    }`}
                  >
                    {toggling === u.id
                      ? '...'
                      : u.subscription_status === 'pro'
                      ? 'Отозвать'
                      : 'Дать Pro'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-white/20 mt-6">
          ProFace Admin · {users.length} пользователей
        </p>
      </div>
    </div>
  )
}
