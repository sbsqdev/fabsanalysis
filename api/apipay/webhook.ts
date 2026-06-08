/**
 * POST /api/apipay/webhook
 *
 * Receives ApiPay webhook deliveries. Verifies the HMAC-SHA256 signature in the
 * X-Webhook-Signature header against the raw request body, then — on a paid
 * invoice — grants access by setting profiles.subscription_status = 'pro' for
 * the user whose id was passed as external_order_id at invoice creation.
 *
 * Always responds 2xx quickly once the signature is valid so ApiPay stops retrying.
 *
 * Register this URL in the ApiPay dashboard (Settings → Connection):
 *   https://fabsanalysismouth-main.vercel.app/api/apipay/webhook
 */
import type { IncomingMessage, ServerResponse } from 'http'
import {
  verifyApipaySignature,
  isPaidStatus,
  getSupabaseAdmin,
  readRawBody,
  jsonReply,
} from './_lib.js'

export default async function apipayWebhookHandler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return jsonReply(res, 405, { error: 'Method not allowed' })

  const raw = await readRawBody(req)
  const signature = req.headers['x-webhook-signature'] as string | undefined

  if (!verifyApipaySignature(raw, signature)) {
    console.warn('[apipay/webhook] invalid signature')
    return jsonReply(res, 401, { error: 'Invalid signature' })
  }

  let payload: {
    event?: string
    invoice?: {
      id?: string
      external_order_id?: string
      amount?: number
      status?: string
      kaspi_invoice_id?: string
      client_phone?: string
      paid_at?: string | null
    }
  }
  try {
    payload = JSON.parse(raw.toString('utf-8'))
  } catch {
    return jsonReply(res, 400, { error: 'Invalid JSON body' })
  }

  const invoice = payload.invoice
  // Acknowledge anything we don't need to act on (still 200 so ApiPay stops retrying).
  if (!invoice || !isPaidStatus(invoice.status)) {
    return jsonReply(res, 200, { ok: true, ignored: true, status: invoice?.status ?? null })
  }

  const userId = invoice.external_order_id
  if (!userId) {
    console.warn('[apipay/webhook] paid invoice without external_order_id:', invoice.id)
    return jsonReply(res, 200, { ok: true, ignored: true, reason: 'no external_order_id' })
  }

  const admin = getSupabaseAdmin()
  if (!admin) {
    // Can't persist — return 500 so ApiPay retries later.
    return jsonReply(res, 500, { error: 'Server Supabase config missing' })
  }

  const { error: updateError } = await admin
    .from('profiles')
    .upsert({ id: userId, subscription_status: 'pro' }, { onConflict: 'id' })

  if (updateError) {
    console.error('[apipay/webhook] DB update error:', updateError)
    return jsonReply(res, 500, { error: 'DB update failed' })
  }

  console.log('[apipay/webhook] access granted to user', userId, 'invoice', invoice.id)
  return jsonReply(res, 200, { ok: true, granted: true })
}
