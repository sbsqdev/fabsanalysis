/**
 * GET  /api/apipay/status?invoiceId=...&accessToken=...
 * POST /api/apipay/status  Body: { invoiceId, accessToken }
 *
 * Polls ApiPay for the current invoice status. If the invoice is paid, grants
 * access (profiles.subscription_status = 'pro') as a fallback to the webhook,
 * but only when the invoice's external_order_id matches the authenticated user.
 *
 * Returns { status, paid }.
 */
import type { IncomingMessage, ServerResponse } from 'http'
import { URL } from 'url'
import {
  apipayGetInvoice,
  isPaidStatus,
  getSupabaseAdmin,
  readRawBody,
  jsonReply,
  handleCors,
} from './_lib.js'

export default async function apipayStatusHandler(req: IncomingMessage, res: ServerResponse) {
  if (handleCors(req, res)) return

  let invoiceId: string | undefined
  let accessToken: string | undefined

  if (req.method === 'GET') {
    const u = new URL(req.url || '', 'http://localhost')
    invoiceId = u.searchParams.get('invoiceId') ?? undefined
    accessToken = u.searchParams.get('accessToken') ?? undefined
  } else if (req.method === 'POST') {
    try {
      const raw = await readRawBody(req)
      const body = JSON.parse(raw.toString('utf-8'))
      invoiceId = body.invoiceId
      accessToken = body.accessToken
    } catch {
      return jsonReply(res, 400, { error: 'Invalid JSON body' })
    }
  } else {
    return jsonReply(res, 405, { error: 'Method not allowed' })
  }

  if (!invoiceId || !accessToken) {
    return jsonReply(res, 400, { error: 'Missing invoiceId or accessToken' })
  }

  const admin = getSupabaseAdmin()
  if (!admin) return jsonReply(res, 500, { error: 'Server Supabase config missing' })

  const { data: { user }, error: authError } = await admin.auth.getUser(accessToken)
  if (authError || !user) {
    return jsonReply(res, 401, { error: 'Invalid or expired session token' })
  }

  try {
    const invoice = await apipayGetInvoice(invoiceId)
    const paid = isPaidStatus(invoice.status)

    // Fallback grant — only if this invoice belongs to the requesting user.
    if (paid && invoice.external_order_id === user.id) {
      await admin.from('profiles').upsert({ id: user.id, subscription_status: 'pro' }, { onConflict: 'id' })
    }

    return jsonReply(res, 200, { status: invoice.status ?? 'pending', paid })
  } catch (e) {
    console.error('[apipay/status] error:', e)
    return jsonReply(res, 502, { error: 'Не удалось проверить статус оплаты.' })
  }
}
