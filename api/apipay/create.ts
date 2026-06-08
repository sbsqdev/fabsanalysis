/**
 * POST /api/apipay/create
 * Body: { phone: string, accessToken: string }
 *
 * Authenticates the user via their Supabase JWT, normalizes the phone to KZ
 * "8XXXXXXXXXX" form, and creates an ApiPay invoice for PAYMENT_AMOUNT ₸.
 * ApiPay then pushes a Kaspi payment request to that phone automatically.
 *
 * Returns { invoiceId, status, amount, phone } so the client can poll status.
 */
import type { IncomingMessage, ServerResponse } from 'http'
import {
  PAYMENT_AMOUNT,
  apipayCreateInvoice,
  normalizeKzPhone,
  getSupabaseAdmin,
  readRawBody,
  jsonReply,
  handleCors,
} from './_lib.js'

export default async function apipayCreateHandler(req: IncomingMessage, res: ServerResponse) {
  if (handleCors(req, res)) return
  if (req.method !== 'POST') return jsonReply(res, 405, { error: 'Method not allowed' })

  let body: { phone?: string; accessToken?: string }
  try {
    const raw = await readRawBody(req)
    body = JSON.parse(raw.toString('utf-8'))
  } catch {
    return jsonReply(res, 400, { error: 'Invalid JSON body' })
  }

  const { phone, accessToken } = body
  if (!phone || !accessToken) {
    return jsonReply(res, 400, { error: 'Missing phone or accessToken' })
  }

  const normalizedPhone = normalizeKzPhone(phone)
  if (!normalizedPhone) {
    return jsonReply(res, 400, { error: 'Некорректный номер телефона. Введите казахстанский номер.' })
  }

  // Test phone: charges 1 ₸ instead of full price so the full payment flow can be verified
  const TEST_PHONE = '87711861896'
  const invoiceAmount = normalizedPhone === TEST_PHONE ? 1 : PAYMENT_AMOUNT

  const admin = getSupabaseAdmin()
  if (!admin) return jsonReply(res, 500, { error: 'Server Supabase config missing' })

  const { data: { user }, error: authError } = await admin.auth.getUser(accessToken)
  if (authError || !user) {
    return jsonReply(res, 401, { error: 'Invalid or expired session token' })
  }

  // Already paid? Don't charge again.
  const { data: profile } = await admin
    .from('profiles')
    .select('subscription_status')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.subscription_status === 'pro') {
    return jsonReply(res, 200, { alreadyPaid: true, status: 'paid' })
  }

  try {
    const invoice = await apipayCreateInvoice({
      phone: normalizedPhone,
      amount: invoiceAmount,
      description: 'FABS — полный отчёт анализа лица',
      externalOrderId: user.id,
    })

    // Best-effort: remember the phone on the profile.
    await admin.from('profiles').upsert({ id: user.id, phone: normalizedPhone }, { onConflict: 'id' })

    return jsonReply(res, 200, {
      invoiceId: invoice.id,
      status: invoice.status ?? 'pending',
      amount: invoice.amount ?? PAYMENT_AMOUNT,
      phone: normalizedPhone,
    })
  } catch (e) {
    console.error('[apipay/create] error:', e)
    return jsonReply(res, 502, { error: 'Не удалось создать счёт на оплату. Попробуйте ещё раз.' })
  }
}
