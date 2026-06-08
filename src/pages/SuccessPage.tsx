import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { formatPhoneDisplay } from '../lib/phone'
import { track, EVENTS } from '../lib/analytics'

function randomReceiptId() {
  return Math.floor(600_000_000 + Math.random() * 99_999_999).toString()
}

function nowKZ() {
  return new Date().toLocaleString('ru-KZ', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Almaty',
  })
}

export default function SuccessPage() {
  const { refreshAccess, user } = useAuth()
  const receiptId = useMemo(() => randomReceiptId(), [])
  const date = useMemo(() => nowKZ(), [])

  // Get phone from user metadata
  const rawPhone: string = (user?.user_metadata?.phone as string | undefined) ?? ''
  const displayPhone = rawPhone ? formatPhoneDisplay(rawPhone) : '+7 (___) ___-__-__'

  useEffect(() => {
    // Fire payment confirmation event — this is the authoritative "payment done" signal
    // from the server redirect, distinct from payment_verified which fires on webhook.
    track(EVENTS.PAYMENT_SUCCESS_PAGE, { amount_kzt: 3000 });
    const timer = setTimeout(() => { void refreshAccess() }, 1500)
    return () => clearTimeout(timer)
  }, [refreshAccess])

  return (
    <div className="min-h-screen bg-[#f5f5f5] flex flex-col items-center justify-center px-4 py-10">

      {/* ── Kaspi-style receipt card ─────────────────────────── */}
      <div className="w-full max-w-sm bg-white rounded-2xl overflow-hidden shadow-lg">

        {/* Header */}
        <div className="bg-white px-6 pt-7 pb-4 text-center">
          {/* Kaspi-style icon */}
          <div className="w-14 h-14 rounded-full bg-[#ee5a24] flex items-center justify-center mx-auto mb-3 shadow-md">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-gray-500 tracking-wide">Оплата услуги</p>
        </div>

        {/* Success banner */}
        <div className="bg-[#4caf50] px-6 py-3 text-center">
          <p className="text-white font-semibold text-sm tracking-wide">Оплата успешно совершена</p>
        </div>

        {/* Amount */}
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex justify-between items-end">
            <div>
              <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">Сумма</p>
              <p className="text-3xl font-bold text-gray-900">3 000,00 <span className="text-2xl">₸</span></p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">Комиссия</p>
              <p className="text-xl font-semibold text-gray-900">0 ₸</p>
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="px-6 py-4 space-y-3">
          {[
            { label: '№ квитанции', value: receiptId },
            { label: 'Дата', value: date },
            { label: 'Отправитель', value: displayPhone },
            { label: 'Получатель', value: 'SB dev' },
            { label: 'Услуга', value: 'AI-анализ губ · ProFace' },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between gap-3">
              <p className="text-[12px] text-gray-400 flex-shrink-0">{label}</p>
              <p className="text-[12px] text-gray-800 font-medium text-right">{value}</p>
            </div>
          ))}
        </div>

        {/* Divider perforation style */}
        <div className="flex items-center px-4 py-1">
          <div className="flex-1 border-t border-dashed border-gray-200" />
        </div>

        {/* CTA */}
        <div className="px-6 py-5 bg-gray-50 text-center">
          <Link
            to="/analysis"
            className="block w-full bg-rose-500 hover:bg-rose-400 text-white font-semibold py-3.5 rounded-xl transition-colors text-sm shadow-sm"
          >
            Начать анализ губ →
          </Link>
          <Link
            to="/dashboard"
            className="block mt-2.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Перейти в личный кабинет
          </Link>
        </div>
      </div>

      {/* Small disclaimer */}
      <p className="mt-5 text-[11px] text-gray-400 text-center max-w-xs">
        Сохраните этот чек. При вопросах по оплате — напишите в&nbsp;поддержку.
      </p>
    </div>
  )
}
