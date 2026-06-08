import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'

// ─── Payment config (display only; amount is enforced server-side) ────────────
const KASPI_AMOUNT = '3 000'

interface Props {
  onVerified: () => void
}

type Phase = 'idle' | 'creating' | 'waiting' | 'success' | 'error'

const POLL_INTERVAL_MS = 4000
const POLL_TIMEOUT_MS = 5 * 60 * 1000 // stop polling after 5 min

/** Format raw digits into a friendly +7 (XXX) XXX-XX-XX as the user types. */
function formatPhone(raw: string): string {
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('8')) d = '7' + d.slice(1)
  if (!d.startsWith('7')) d = '7' + d
  d = d.slice(0, 11)
  const p = d.slice(1)
  let out = '+7'
  if (p.length > 0) out += ' (' + p.slice(0, 3)
  if (p.length >= 3) out += ') ' + p.slice(3, 6)
  if (p.length >= 6) out += '-' + p.slice(6, 8)
  if (p.length >= 8) out += '-' + p.slice(8, 10)
  return out
}

function isPhoneComplete(raw: string): boolean {
  const d = raw.replace(/\D/g, '')
  return d.length === 11
}

export default function KaspiUpload({ onVerified }: Props) {
  const { session, refreshAccess } = useAuth()
  const [phone, setPhone] = useState('+7 ')
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollDeadline = useRef<number>(0)

  useEffect(() => {
    return () => { if (pollTimer.current) clearTimeout(pollTimer.current) }
  }, [])

  function handlePhoneChange(e: React.ChangeEvent<HTMLInputElement>) {
    setPhone(formatPhone(e.target.value))
    if (phase === 'error') { setPhase('idle'); setMessage('') }
  }

  async function pollStatus(invoiceId: string) {
    if (!session?.access_token) return
    if (Date.now() > pollDeadline.current) {
      setPhase('error')
      setMessage('Время ожидания истекло. Если вы оплатили — обновите страницу. Иначе попробуйте снова.')
      return
    }
    try {
      const resp = await fetch('/api/apipay/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId, accessToken: session.access_token }),
      })
      const data = await resp.json().catch(() => ({}))
      if (data?.paid) {
        setPhase('success')
        setMessage('Оплата подтверждена! Доступ открыт.')
        // Grant access immediately — don't block on refreshAccess (can fail/be slow)
        setTimeout(onVerified, 500)
        void refreshAccess()
        return
      }
      const status = data?.status as string | undefined
      if (status === 'cancelled' || status === 'expired' || status === 'error' || status === 'refunded') {
        setPhase('error')
        setMessage('Оплата не завершена (счёт отменён или истёк). Попробуйте ещё раз.')
        return
      }
    } catch {
      // transient — keep polling
    }
    pollTimer.current = setTimeout(() => pollStatus(invoiceId), POLL_INTERVAL_MS)
  }

  async function handleSubmit() {
    if (!isPhoneComplete(phone)) {
      setPhase('error')
      setMessage('Введите корректный номер телефона.')
      return
    }
    if (!session?.access_token) {
      setPhase('error')
      setMessage('Сессия не найдена. Войдите в аккаунт и попробуйте снова.')
      return
    }

    setPhase('creating')
    setMessage('')
    try {
      const resp = await fetch('/api/apipay/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, accessToken: session.access_token }),
      })
      const data = await resp.json().catch(() => ({}))

      if (!resp.ok) {
        setPhase('error')
        setMessage(data?.error || 'Не удалось создать счёт. Попробуйте ещё раз.')
        return
      }

      if (data?.alreadyPaid) {
        setPhase('success')
        setMessage('Доступ уже активирован.')
        await refreshAccess()
        setTimeout(onVerified, 800)
        return
      }

      if (!data?.invoiceId) {
        setPhase('error')
        setMessage('Сервис оплаты вернул некорректный ответ. Попробуйте позже.')
        return
      }

      setPhase('waiting')
      setMessage('Запрос на оплату отправлен в Kaspi на ваш номер. Подтвердите его в приложении Kaspi.kz.')
      pollDeadline.current = Date.now() + POLL_TIMEOUT_MS
      pollTimer.current = setTimeout(() => pollStatus(data.invoiceId), POLL_INTERVAL_MS)
    } catch {
      setPhase('error')
      setMessage('Ошибка сети. Проверьте подключение и попробуйте снова.')
    }
  }

  const busy = phase === 'creating' || phase === 'waiting'

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 overflow-hidden">
      {/* Header */}
      <div className="bg-amber-100 border-b border-amber-200 px-5 py-4">
        <h3 className="font-bold text-amber-900 text-base mb-1">
          Открой свой анализ за 3 000 ₸
        </h3>
        <p className="text-xs text-amber-700 leading-relaxed">
          Консультация у косметолога — от 15 000 ₸ и без цифр. Здесь — точные данные твоего лица прямо сейчас.
        </p>
      </div>

      <div className="p-5 space-y-4">
        {/* Amount */}
        <div className="bg-white rounded-xl border border-amber-200 p-4">
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-500">Сумма к оплате</span>
            <span className="text-base font-bold text-amber-700">{KASPI_AMOUNT} ₸</span>
          </div>
        </div>

        {/* Steps */}
        <ol className="space-y-1.5 text-xs text-amber-800">
          <li className="flex items-start gap-2">
            <span className="w-4 h-4 rounded-full bg-amber-200 flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">1</span>
            Введите номер, привязанный к Kaspi Gold
          </li>
          <li className="flex items-start gap-2">
            <span className="w-4 h-4 rounded-full bg-amber-200 flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">2</span>
            Нажмите «Отправить запрос на оплату»
          </li>
          <li className="flex items-start gap-2">
            <span className="w-4 h-4 rounded-full bg-amber-200 flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">3</span>
            Подтвердите платёж в приложении Kaspi.kz — доступ откроется автоматически
          </li>
        </ol>

        {/* Phone input */}
        <div>
          <label className="block text-xs font-medium text-amber-800 mb-1.5">Номер телефона (Kaspi)</label>
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={handlePhoneChange}
            disabled={busy || phase === 'success'}
            placeholder="+7 (___) ___-__-__"
            className="w-full rounded-xl border border-amber-300 bg-white px-4 py-3 text-sm font-mono text-gray-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200 disabled:opacity-60"
          />
        </div>

        {/* Status message */}
        {message && (
          <div className={`rounded-lg px-3 py-2.5 text-sm ${
            phase === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
            phase === 'waiting' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
            phase === 'error'   ? 'bg-red-50 text-red-700 border border-red-200' :
            'bg-amber-50 text-amber-700 border border-amber-200'
          }`}>
            {phase === 'success' && '✅ '}
            {phase === 'waiting' && '⏳ '}
            {phase === 'error' && '❌ '}
            {message}
          </div>
        )}

        {/* Submit button */}
        {phase !== 'success' && (
          <button
            onClick={handleSubmit}
            disabled={busy || !isPhoneComplete(phone)}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors text-sm"
          >
            {busy ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {phase === 'creating' ? 'Создаём счёт...' : 'Ожидаем подтверждения...'}
              </span>
            ) : (
              'Отправить запрос на оплату →'
            )}
          </button>
        )}
      </div>
    </div>
  )
}
