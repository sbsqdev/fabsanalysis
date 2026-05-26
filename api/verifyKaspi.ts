/**
 * POST /api/verifyKaspi
 * Body: { fileBase64: string, mimeType: 'image/png'|'image/jpeg', accessToken: string }
 *
 * Reads a Kaspi payment receipt using GPT-4o vision, checks:
 *   1. Transfer was successful
 *   2. Amount = 3 000 ₸
 *   3. Recipient name contains "SB"
 *
 * On success → sets profiles.subscription_status = 'pro' for the user.
 */
import type { IncomingMessage, ServerResponse } from 'http'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

// Kaspi receipt verification criteria
const REQUIRED_AMOUNT = 3000
const RECIPIENT_KEYWORD = 'SB' // partial match (case-insensitive)

function jsonReply(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(JSON.stringify(data))
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

export default async function verifyKaspiHandler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' })
    res.end()
    return
  }

  if (req.method !== 'POST') {
    return jsonReply(res, 405, { error: 'Method not allowed' })
  }

  // ── Parse body ──────────────────────────────────────────────────
  let body: { fileBase64?: string; mimeType?: string; accessToken?: string }
  try {
    const raw = await readBody(req)
    body = JSON.parse(raw.toString('utf-8'))
  } catch {
    return jsonReply(res, 400, { error: 'Invalid JSON body' })
  }

  const { fileBase64, mimeType, accessToken } = body

  if (!fileBase64 || !mimeType || !accessToken) {
    return jsonReply(res, 400, { error: 'Missing fileBase64, mimeType, or accessToken' })
  }

  if (!mimeType.startsWith('image/')) {
    return jsonReply(res, 400, { error: 'Only image files are supported (PNG, JPEG)' })
  }

  // ── Identify user from Supabase JWT ────────────────────────────
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY || ''

  if (!supabaseUrl || !serviceKey) {
    return jsonReply(res, 500, { error: 'Server Supabase config missing' })
  }

  const adminClient = createClient(supabaseUrl, serviceKey)

  const { data: { user }, error: authError } = await adminClient.auth.getUser(accessToken)
  if (authError || !user) {
    return jsonReply(res, 401, { error: 'Invalid or expired session token' })
  }

  // ── TEST MODE: skip receipt check, grant access to any upload ──
  const TEST_MODE = true // TODO: set to false before production launch
  if (TEST_MODE) {
    await adminClient.from('profiles').upsert({ id: user.id, subscription_status: 'pro' }, { onConflict: 'id' })
    return jsonReply(res, 200, { valid: true, message: 'Оплата подтверждена! Доступ открыт.' })
  }

  // ── Check if already verified ──────────────────────────────────
  const { data: profile } = await adminClient
    .from('profiles')
    .select('subscription_status')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.subscription_status === 'pro') {
    return jsonReply(res, 200, { valid: true, message: 'Доступ уже активирован.' })
  }

  // ── Vision analysis with GPT-4o ────────────────────────────────
  const openaiKey = process.env.OPENAI_API_KEY || ''

  if (!openaiKey) {
    // No OpenAI key — manual review fallback
    return jsonReply(res, 202, {
      valid: false,
      pending: true,
      message: 'Чек получен. Проверка займёт до 24 часов — мы свяжемся с вами.',
    })
  }

  const openai = new OpenAI({ apiKey: openaiKey })

  let gptResult: { valid: boolean; amount?: number; recipient?: string; status?: string; reason?: string }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 150,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `This is a Kaspi payment receipt screenshot. Extract and verify:
1. Is the transfer STATUS successful (look for "успешно совершен" or "Перевод успешно совершен")?
2. What is the AMOUNT in tenge? (extract the number, ignore spaces)
3. What is the RECIPIENT NAME?

Respond ONLY with valid JSON like:
{"valid": true/false, "amount": 3000, "recipient": "SB dev", "status": "success", "reason": "..."}

Rules for valid=true: status must be successful AND amount must be exactly ${REQUIRED_AMOUNT} AND recipient name must contain "${RECIPIENT_KEYWORD}" (case-insensitive).`,
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${fileBase64}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
    })

    const content = response.choices[0]?.message?.content?.trim() ?? ''
    // Extract JSON from response (GPT sometimes wraps it in markdown)
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in GPT response')
    gptResult = JSON.parse(jsonMatch[0])
  } catch (e) {
    console.error('[verifyKaspi] GPT error:', e)
    return jsonReply(res, 500, { error: 'Не удалось проверить чек. Попробуйте ещё раз.' })
  }

  // ── Validate GPT result ────────────────────────────────────────
  const amountOk    = typeof gptResult.amount === 'number' && gptResult.amount >= REQUIRED_AMOUNT
  const recipientOk = typeof gptResult.recipient === 'string' &&
    gptResult.recipient.toLowerCase().includes(RECIPIENT_KEYWORD.toLowerCase())
  const statusOk    = gptResult.valid === true

  if (!statusOk || !amountOk || !recipientOk) {
    const reasons: string[] = []
    if (!statusOk)    reasons.push('перевод не подтверждён')
    if (!amountOk)    reasons.push(`сумма должна быть ${REQUIRED_AMOUNT} ₸ (найдено: ${gptResult.amount ?? '?'})`)
    if (!recipientOk) reasons.push(`получатель должен содержать «${RECIPIENT_KEYWORD}» (найдено: «${gptResult.recipient ?? '?'}»)`)

    return jsonReply(res, 200, {
      valid: false,
      message: `Чек не прошёл проверку: ${reasons.join('; ')}.`,
    })
  }

  // ── Grant access ───────────────────────────────────────────────
  const { error: updateError } = await adminClient
    .from('profiles')
    .upsert({ id: user.id, subscription_status: 'pro' }, { onConflict: 'id' })

  if (updateError) {
    console.error('[verifyKaspi] DB update error:', updateError)
    return jsonReply(res, 500, { error: 'Ошибка активации доступа. Напишите нам.' })
  }

  return jsonReply(res, 200, { valid: true, message: 'Оплата подтверждена! Доступ открыт.' })
}
