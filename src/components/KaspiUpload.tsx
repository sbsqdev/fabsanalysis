import { useRef, useState } from 'react'
import { useAuth } from '../lib/auth'

// ─── Update these with real ProFace/SB Kaspi details ──────────────────────────
const KASPI_RECIPIENT_NAME  = 'SB dev'
const KASPI_RECIPIENT_PHONE = '+7 (701) 017-77-10'
const KASPI_AMOUNT          = '3 000'

interface Props {
  onVerified: () => void
}

export default function KaspiUpload({ onVerified }: Props) {
  const { session, refreshAccess } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error' | 'pending'>('idle')
  const [message, setMessage] = useState('')

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.type.startsWith('image/')) {
      setMessage('Поддерживаются только изображения (PNG, JPG). Сделайте скриншот чека.')
      setStatus('error')
      return
    }
    if (f.size > 8 * 1024 * 1024) {
      setMessage('Файл слишком большой (максимум 8 MB).')
      setStatus('error')
      return
    }
    setFile(f)
    setStatus('idle')
    setMessage('')
    const reader = new FileReader()
    reader.onload = () => setPreview(reader.result as string)
    reader.readAsDataURL(f)
  }

  async function handleSubmit() {
    if (!file || !session?.access_token) return
    setStatus('loading')
    setMessage('')

    try {
      // Convert file to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          // Strip "data:image/png;base64," prefix
          resolve(result.split(',')[1])
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      const res = await fetch('/api/verifyKaspi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileBase64: base64,
          mimeType: file.type,
          accessToken: session.access_token,
        }),
      })

      const data = await res.json() as { valid?: boolean; pending?: boolean; message?: string; error?: string }

      if (data.valid) {
        setStatus('success')
        setMessage(data.message ?? 'Оплата подтверждена!')
        await refreshAccess()
        setTimeout(onVerified, 1200)
      } else if (data.pending) {
        setStatus('pending')
        setMessage(data.message ?? 'Чек на проверке.')
      } else {
        setStatus('error')
        setMessage(data.message ?? data.error ?? 'Чек не прошёл проверку.')
      }
    } catch {
      setStatus('error')
      setMessage('Ошибка соединения. Попробуйте ещё раз.')
    }
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 overflow-hidden">
      {/* Header */}
      <div className="bg-amber-100 border-b border-amber-200 px-5 py-4">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-lg">🔒</span>
          <h3 className="font-semibold text-amber-900 text-base">Разблокируйте полный отчёт</h3>
        </div>
        <p className="text-xs text-amber-700">Оплатите через Kaspi и загрузите скриншот чека</p>
      </div>

      <div className="p-5 space-y-4">
        {/* Payment instructions */}
        <div className="bg-white rounded-xl border border-amber-200 p-4 space-y-2.5">
          <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-3">
            Реквизиты для оплаты
          </p>
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-500">Получатель</span>
            <span className="text-sm font-semibold text-gray-900">{KASPI_RECIPIENT_NAME}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-500">Телефон (Kaspi Gold)</span>
            <span className="text-sm font-mono text-gray-900">{KASPI_RECIPIENT_PHONE}</span>
          </div>
          <div className="flex justify-between items-center border-t border-amber-100 pt-2.5 mt-2.5">
            <span className="text-xs text-gray-500">Сумма</span>
            <span className="text-base font-bold text-amber-700">{KASPI_AMOUNT} ₸</span>
          </div>
        </div>

        {/* Steps */}
        <ol className="space-y-1.5 text-xs text-amber-800">
          <li className="flex items-start gap-2">
            <span className="w-4 h-4 rounded-full bg-amber-200 flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">1</span>
            Откройте Kaspi.kz → «Переводы» → введите номер и сумму
          </li>
          <li className="flex items-start gap-2">
            <span className="w-4 h-4 rounded-full bg-amber-200 flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">2</span>
            Сделайте скриншот чека с надписью «Перевод успешно совершён»
          </li>
          <li className="flex items-start gap-2">
            <span className="w-4 h-4 rounded-full bg-amber-200 flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">3</span>
            Загрузите скриншот ниже — доступ откроется автоматически
          </li>
        </ol>

        {/* File upload area */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className={`relative rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
            preview
              ? 'border-amber-300 bg-amber-50'
              : 'border-amber-300 bg-white hover:border-amber-400 hover:bg-amber-50'
          }`}
        >
          {preview ? (
            <div className="relative">
              <img
                src={preview}
                alt="Kaspi чек"
                className="w-full max-h-48 object-contain rounded-xl"
              />
              <button
                className="absolute top-2 right-2 bg-black/50 text-white text-[10px] px-2 py-1 rounded-lg hover:bg-black/70 transition-colors"
                onClick={(e) => { e.stopPropagation(); setFile(null); setPreview(null); setStatus('idle'); setMessage('') }}
              >
                Изменить
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-7 px-4 text-center">
              <svg className="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <p className="text-sm font-medium text-amber-800">Загрузить скриншот чека</p>
              <p className="text-xs text-amber-600">PNG или JPG · до 8 МБ</p>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Status message */}
        {message && (
          <div className={`rounded-lg px-3 py-2.5 text-sm ${
            status === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
            status === 'pending' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
            'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {status === 'success' && '✅ '}
            {status === 'pending' && '⏳ '}
            {status === 'error' && '❌ '}
            {message}
          </div>
        )}

        {/* Submit button */}
        {status !== 'success' && (
          <button
            onClick={handleSubmit}
            disabled={!file || status === 'loading' || status === 'pending'}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors text-sm"
          >
            {status === 'loading' ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Проверяем чек...
              </span>
            ) : (
              'Подтвердить оплату →'
            )}
          </button>
        )}
      </div>
    </div>
  )
}
