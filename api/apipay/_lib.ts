/**
 * Shared helpers for the ApiPay (apipay.kz) payment integration.
 *
 * ApiPay v2 REST API:
 *   Base:   https://bpapi.bazarbay.site/api/v1
 *   Auth:   header  X-API-Key: <APIPAY_API_KEY>
 *   Create: POST /invoices  { phone_number, amount, description?, external_order_id?, is_sandbox? }
 *           → ApiPay sends a Kaspi push to the phone automatically (no payment URL).
 *           Response: { id, amount, status, phone, created_at, paid_at, ... }
 *   Status: GET  /invoices/{id} → { id, status, ... }
 *
 * Webhook: configured in the ApiPay dashboard (Settings → Connection). ApiPay signs each
 *   delivery with header  X-Webhook-Signature: sha256=<hex>  = HMAC-SHA256(rawBody, secret).
 *
 * This file is named with a leading underscore so Vercel does NOT treat it as a route.
 */
import type { IncomingMessage, ServerResponse } from 'http'
import crypto from 'crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const APIPAY_BASE_URL =
  (process.env.APIPAY_BASE_URL || 'https://bpapi.bazarbay.site/api/v1').replace(/\/+$/, '')

/** Price of one unlock, in tenge. Keep in sync with the UI copy. */
export const PAYMENT_AMOUNT = Number(process.env.APIPAY_AMOUNT || 3000)

/** Whether to create invoices in ApiPay sandbox mode. */
export const APIPAY_SANDBOX = process.env.APIPAY_SANDBOX === 'true'

export interface ApipayInvoice {
  id: string
  amount: number
  status: ApipayStatus
  phone?: string
  client_phone?: string
  external_order_id?: string
  kaspi_invoice_id?: string
  created_at?: string
  paid_at?: string | null
  [k: string]: unknown
}

export type ApipayStatus =
  | 'pending'
  | 'processing'
  | 'paid'
  | 'cancelled'
  | 'expired'
  | 'partially_refunded'
  | 'refunded'
  | 'error'

/** Statuses that should grant access. */
export function isPaidStatus(status: string | undefined): boolean {
  return status === 'paid' || status === 'partially_refunded'
}

/** Statuses where the invoice is over and access will never be granted. */
export function isTerminalUnpaidStatus(status: string | undefined): boolean {
  return status === 'cancelled' || status === 'expired' || status === 'error' || status === 'refunded'
}

function apiKey(): string {
  const key = (process.env.APIPAY_API_KEY || '').trim()
  if (!key) throw new Error('APIPAY_API_KEY is not configured')
  return key
}

/** Normalize a KZ phone to ApiPay's "8XXXXXXXXXX" form (11 digits, leading 8). */
export function normalizeKzPhone(raw: string): string | null {
  const digits = (raw || '').replace(/\D/g, '')
  let d = digits
  if (d.length === 11 && d.startsWith('7')) d = '8' + d.slice(1) // 7XXXXXXXXXX → 8XXXXXXXXXX
  else if (d.length === 10) d = '8' + d // XXXXXXXXXX → 8XXXXXXXXXX
  else if (d.length === 11 && d.startsWith('8')) d = d // already fine
  else return null
  if (d.length !== 11 || !d.startsWith('8')) return null
  return d
}

export async function apipayCreateInvoice(params: {
  phone: string
  amount: number
  description?: string
  externalOrderId?: string
}): Promise<ApipayInvoice> {
  const resp = await fetch(`${APIPAY_BASE_URL}/invoices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey() },
    body: JSON.stringify({
      phone_number: params.phone,
      amount: params.amount,
      description: params.description,
      external_order_id: params.externalOrderId,
      is_sandbox: APIPAY_SANDBOX,
    }),
  })
  const text = await resp.text()
  let data: unknown
  try { data = JSON.parse(text) } catch { data = text }
  if (!resp.ok) {
    const msg = (data && typeof data === 'object' && 'message' in data) ? String((data as Record<string, unknown>).message) : text
    throw new Error(`ApiPay create invoice failed (${resp.status}): ${msg}`)
  }
  // ApiPay may wrap the invoice in { data: {...} } or return it flat.
  const inv = (data && typeof data === 'object' && 'data' in (data as object))
    ? (data as Record<string, unknown>).data
    : data
  return inv as ApipayInvoice
}

export async function apipayGetInvoice(id: string): Promise<ApipayInvoice> {
  const resp = await fetch(`${APIPAY_BASE_URL}/invoices/${encodeURIComponent(id)}`, {
    headers: { 'X-API-Key': apiKey() },
  })
  const text = await resp.text()
  let data: unknown
  try { data = JSON.parse(text) } catch { data = text }
  if (!resp.ok) {
    throw new Error(`ApiPay get invoice failed (${resp.status}): ${text}`)
  }
  const inv = (data && typeof data === 'object' && 'data' in (data as object))
    ? (data as Record<string, unknown>).data
    : data
  return inv as ApipayInvoice
}

/** Verify the X-Webhook-Signature header (format "sha256=<hex>") against the raw body. */
export function verifyApipaySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  const secret = (process.env.APIPAY_WEBHOOK_SECRET || '').trim()
  if (!secret) return false
  if (!signatureHeader) return false
  const provided = signatureHeader.replace(/^sha256=/i, '').trim().toLowerCase()
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  // constant-time compare
  if (provided.length !== expected.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

export function getSupabaseAdmin(): SupabaseClient | null {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || ''
  if (!supabaseUrl || !serviceKey) return null
  return createClient(supabaseUrl, serviceKey)
}

export async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

export function jsonReply(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(JSON.stringify(data))
}

export function handleCors(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    })
    res.end()
    return true
  }
  return false
}
