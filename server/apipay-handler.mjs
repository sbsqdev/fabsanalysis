/**
 * ApiPay (apipay.kz) payment handlers — Yandex Cloud prod mirror of api/apipay/*.ts.
 *
 *   POST /api/apipay/create   { phone, accessToken }      → create Kaspi invoice
 *   POST /api/apipay/status   { invoiceId, accessToken }  → poll status (fallback grant)
 *   POST /api/apipay/webhook                              → ApiPay signed callback
 *
 * Env: APIPAY_API_KEY, APIPAY_WEBHOOK_SECRET, optional APIPAY_BASE_URL,
 *      APIPAY_SANDBOX, APIPAY_AMOUNT, SUPABASE_URL/VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const APIPAY_BASE_URL = (process.env.APIPAY_BASE_URL || 'https://bpapi.bazarbay.site/api/v1').replace(/\/+$/, '');
const PAYMENT_AMOUNT = Number(process.env.APIPAY_AMOUNT || 3000);
const APIPAY_SANDBOX = process.env.APIPAY_SANDBOX === 'true';

function jsonReply(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function handleCors(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end();
    return true;
  }
  return false;
}

async function readRawBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function apiKey() {
  const key = (process.env.APIPAY_API_KEY || '').trim();
  if (!key) throw new Error('APIPAY_API_KEY is not configured');
  return key;
}

function normalizeKzPhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  let d = digits;
  if (d.length === 11 && d.startsWith('7')) d = '8' + d.slice(1);
  else if (d.length === 10) d = '8' + d;
  else if (d.length === 11 && d.startsWith('8')) d = d;
  else return null;
  if (d.length !== 11 || !d.startsWith('8')) return null;
  return d;
}

function isPaidStatus(status) {
  return status === 'paid' || status === 'partially_refunded';
}

function unwrap(data) {
  return (data && typeof data === 'object' && 'data' in data) ? data.data : data;
}

async function apipayCreateInvoice({ phone, amount, description, externalOrderId }) {
  const resp = await fetch(`${APIPAY_BASE_URL}/invoices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey() },
    body: JSON.stringify({
      phone_number: phone, amount, description,
      external_order_id: externalOrderId, is_sandbox: APIPAY_SANDBOX,
    }),
  });
  const text = await resp.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!resp.ok) {
    const msg = (data && typeof data === 'object' && data.message) ? data.message : text;
    throw new Error(`ApiPay create invoice failed (${resp.status}): ${msg}`);
  }
  return unwrap(data);
}

async function apipayGetInvoice(id) {
  const resp = await fetch(`${APIPAY_BASE_URL}/invoices/${encodeURIComponent(id)}`, {
    headers: { 'X-API-Key': apiKey() },
  });
  const text = await resp.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!resp.ok) throw new Error(`ApiPay get invoice failed (${resp.status}): ${text}`);
  return unwrap(data);
}

function verifyApipaySignature(rawBody, signatureHeader) {
  const secret = (process.env.APIPAY_WEBHOOK_SECRET || '').trim();
  if (!secret || !signatureHeader) return false;
  const provided = signatureHeader.replace(/^sha256=/i, '').trim().toLowerCase();
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch { return false; }
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || '';
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey);
}

export async function handleApipayCreate(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return jsonReply(res, 405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse((await readRawBody(req)).toString('utf-8')); }
  catch { return jsonReply(res, 400, { error: 'Invalid JSON body' }); }

  const { phone, accessToken } = body;
  if (!phone || !accessToken) return jsonReply(res, 400, { error: 'Missing phone or accessToken' });

  const normalizedPhone = normalizeKzPhone(phone);
  if (!normalizedPhone) return jsonReply(res, 400, { error: 'Некорректный номер телефона. Введите казахстанский номер.' });

  const admin = getSupabaseAdmin();
  if (!admin) return jsonReply(res, 500, { error: 'Server Supabase config missing' });

  const { data: { user }, error: authError } = await admin.auth.getUser(accessToken);
  if (authError || !user) return jsonReply(res, 401, { error: 'Invalid or expired session token' });

  const { data: profile } = await admin.from('profiles').select('subscription_status').eq('id', user.id).maybeSingle();
  if (profile?.subscription_status === 'pro') return jsonReply(res, 200, { alreadyPaid: true, status: 'paid' });

  try {
    const invoice = await apipayCreateInvoice({
      phone: normalizedPhone, amount: PAYMENT_AMOUNT,
      description: 'FABS — полный отчёт анализа лица', externalOrderId: user.id,
    });
    await admin.from('profiles').upsert({ id: user.id, phone: normalizedPhone }, { onConflict: 'id' });
    return jsonReply(res, 200, {
      invoiceId: invoice.id, status: invoice.status ?? 'pending',
      amount: invoice.amount ?? PAYMENT_AMOUNT, phone: normalizedPhone,
    });
  } catch (e) {
    console.error('[apipay/create] error:', e);
    return jsonReply(res, 502, { error: 'Не удалось создать счёт на оплату. Попробуйте ещё раз.' });
  }
}

export async function handleApipayStatus(req, res) {
  if (handleCors(req, res)) return;

  let invoiceId, accessToken;
  if (req.method === 'GET') {
    const u = new URL(req.url, 'http://localhost');
    invoiceId = u.searchParams.get('invoiceId') ?? undefined;
    accessToken = u.searchParams.get('accessToken') ?? undefined;
  } else if (req.method === 'POST') {
    try {
      const body = JSON.parse((await readRawBody(req)).toString('utf-8'));
      invoiceId = body.invoiceId; accessToken = body.accessToken;
    } catch { return jsonReply(res, 400, { error: 'Invalid JSON body' }); }
  } else {
    return jsonReply(res, 405, { error: 'Method not allowed' });
  }

  if (!invoiceId || !accessToken) return jsonReply(res, 400, { error: 'Missing invoiceId or accessToken' });

  const admin = getSupabaseAdmin();
  if (!admin) return jsonReply(res, 500, { error: 'Server Supabase config missing' });

  const { data: { user }, error: authError } = await admin.auth.getUser(accessToken);
  if (authError || !user) return jsonReply(res, 401, { error: 'Invalid or expired session token' });

  try {
    const invoice = await apipayGetInvoice(invoiceId);
    const paid = isPaidStatus(invoice.status);
    if (paid && invoice.external_order_id === user.id) {
      await admin.from('profiles').upsert({ id: user.id, subscription_status: 'pro' }, { onConflict: 'id' });
    }
    return jsonReply(res, 200, { status: invoice.status ?? 'pending', paid });
  } catch (e) {
    console.error('[apipay/status] error:', e);
    return jsonReply(res, 502, { error: 'Не удалось проверить статус оплаты.' });
  }
}

export async function handleApipayWebhook(req, res) {
  if (req.method !== 'POST') return jsonReply(res, 405, { error: 'Method not allowed' });

  const raw = await readRawBody(req);
  const signature = req.headers['x-webhook-signature'];

  if (!verifyApipaySignature(raw, signature)) {
    console.warn('[apipay/webhook] invalid signature');
    return jsonReply(res, 401, { error: 'Invalid signature' });
  }

  let payload;
  try { payload = JSON.parse(raw.toString('utf-8')); }
  catch { return jsonReply(res, 400, { error: 'Invalid JSON body' }); }

  const invoice = payload.invoice;
  if (!invoice || !isPaidStatus(invoice.status)) {
    return jsonReply(res, 200, { ok: true, ignored: true, status: invoice?.status ?? null });
  }

  const userId = invoice.external_order_id;
  if (!userId) return jsonReply(res, 200, { ok: true, ignored: true, reason: 'no external_order_id' });

  const admin = getSupabaseAdmin();
  if (!admin) return jsonReply(res, 500, { error: 'Server Supabase config missing' });

  const { error: updateError } = await admin
    .from('profiles')
    .upsert({ id: userId, subscription_status: 'pro' }, { onConflict: 'id' });

  if (updateError) {
    console.error('[apipay/webhook] DB update error:', updateError);
    return jsonReply(res, 500, { error: 'DB update failed' });
  }

  console.log('[apipay/webhook] access granted to user', userId, 'invoice', invoice.id);
  return jsonReply(res, 200, { ok: true, granted: true });
}
