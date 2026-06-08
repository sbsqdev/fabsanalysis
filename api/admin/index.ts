/**
 * Unified Admin API  –  /api/admin
 *
 * GET  ?type=users[&search=<q>][&status=pro|pending]
 *   → { users: UserRow[], total: number }
 *
 * GET  ?type=analytics
 *   → aggregated metrics (registrations, analyses, breakdown by status)
 *
 * POST { action: 'set-pro', userId: string, status: 'pro'|'pending' }
 *   → { ok: true, userId, status }
 *
 * Auth: Supabase JWT in  Authorization: Bearer <token>  header.
 *       The user's email must match ADMIN_EMAIL env var.
 */
import type { IncomingMessage, ServerResponse } from 'http'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY || ''
const ADMIN_EMAILS = (
  process.env.ADMIN_EMAILS || 'tolegenaiteni@gmail.com,diana@proface.kz,aruzhanzakirova8@gmail.com'
).toLowerCase().split(',').map((e) => e.trim()).filter(Boolean)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jsonReply(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type':                'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':'Authorization, Content-Type',
  })
  res.end(JSON.stringify(data))
}

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY)
}

async function verifyAdmin(req: IncomingMessage): Promise<string | null> {
  const token = ((req.headers['authorization'] as string) ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const { data: { user }, error } = await adminClient().auth.getUser(token)
  if (error || !user) return null
  if (!ADMIN_EMAILS.includes((user.email ?? '').toLowerCase())) return null
  return user.id
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function dateAgo(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleUsers(req: IncomingMessage, res: ServerResponse) {
  const url    = new URL(req.url ?? '/', 'http://localhost')
  const search = (url.searchParams.get('search') ?? '').toLowerCase().trim()
  const statusFilter = url.searchParams.get('status') ?? ''

  const db = adminClient()

  const { data: profiles, error: pe } = await db
    .from('profiles')
    .select('id, email, phone, subscription_status, created_at')
    .order('created_at', { ascending: false })
  if (pe) return jsonReply(res, 500, { error: pe.message })

  const { data: analyses, error: ae } = await db
    .from('face_analyses')
    .select('user_id')
  if (ae) return jsonReply(res, 500, { error: ae.message })

  const countMap: Record<string, number> = {}
  for (const a of analyses ?? []) {
    countMap[a.user_id] = (countMap[a.user_id] ?? 0) + 1
  }

  let users = (profiles ?? []).map((p) => ({
    id:                  p.id,
    email:               p.email ?? '',
    phone:               p.phone ?? '',
    subscription_status: p.subscription_status ?? 'pending',
    created_at:          p.created_at,
    analyses_count:      countMap[p.id] ?? 0,
  }))

  if (search)      users = users.filter((u) => u.email.toLowerCase().includes(search) || u.phone.includes(search))
  if (statusFilter === 'pro' || statusFilter === 'pending')
    users = users.filter((u) => u.subscription_status === statusFilter)

  return jsonReply(res, 200, { users, total: users.length })
}

async function handleAnalytics(_req: IncomingMessage, res: ServerResponse) {
  const db = adminClient()

  const todayStart  = dateAgo(0)
  const weekStart   = dateAgo(7)
  const monthStart  = dateAgo(30)

  const { data: profiles } = await db
    .from('profiles')
    .select('id, email, subscription_status, created_at')

  const { data: analyses } = await db
    .from('face_analyses')
    .select('id, user_id, created_at')

  const p  = profiles ?? []
  const a  = analyses  ?? []

  const byStatus: Record<string, number> = {}
  for (const u of p) {
    const s = u.subscription_status || 'unknown'
    byStatus[s] = (byStatus[s] || 0) + 1
  }

  // Daily maps (last 30 days)
  const dailyA: Record<string, number> = {}
  const dailyU: Record<string, number> = {}
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const k = d.toISOString().split('T')[0]!
    dailyA[k] = 0; dailyU[k] = 0
  }
  for (const x of a)  { const k = x.created_at?.split('T')[0]; if (k && k in dailyA) dailyA[k]++ }
  for (const x of p)  { const k = x.created_at?.split('T')[0]; if (k && k in dailyU) dailyU[k]++ }

  const userCounts: Record<string, number> = {}
  for (const x of a) { userCounts[x.user_id] = (userCounts[x.user_id] || 0) + 1 }
  const emailMap: Record<string, string> = {}
  for (const x of p) { emailMap[x.id] = x.email || x.id.slice(0, 8) + '…' }

  return jsonReply(res, 200, {
    users: {
      total:      p.length,
      today:      p.filter((x) => x.created_at >= todayStart).length,
      thisWeek:   p.filter((x) => x.created_at >= weekStart).length,
      thisMonth:  p.filter((x) => x.created_at >= monthStart).length,
      byStatus,
    },
    analyses: {
      total:      a.length,
      today:      a.filter((x) => x.created_at >= todayStart).length,
      thisWeek:   a.filter((x) => x.created_at >= weekStart).length,
      thisMonth:  a.filter((x) => x.created_at >= monthStart).length,
      avgPerUser: p.length ? Math.round((a.length / p.length) * 10) / 10 : 0,
    },
    dailyAnalyses: Object.entries(dailyA).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
    dailyUsers:    Object.entries(dailyU).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
    topUsers: Object.entries(userCounts)
      .map(([id, count]) => ({ email: emailMap[id] ?? id.slice(0, 8), analysesCount: count }))
      .sort((a, b) => b.analysesCount - a.analysesCount)
      .slice(0, 10),
  })
}

async function handleSetPro(req: IncomingMessage, res: ServerResponse) {
  let body: { action?: string; userId?: string; status?: string }
  try { body = JSON.parse(await readBody(req)) }
  catch { return jsonReply(res, 400, { error: 'Invalid JSON' }) }

  const { userId, status } = body
  if (!userId) return jsonReply(res, 400, { error: 'Missing userId' })
  if (status !== 'pro' && status !== 'pending') return jsonReply(res, 400, { error: 'status must be "pro" or "pending"' })

  const { error } = await adminClient()
    .from('profiles')
    .update({ subscription_status: status })
    .eq('id', userId)

  if (error) return jsonReply(res, 500, { error: error.message })

  console.log(`[admin] set-pro userId=${userId} → ${status}`)
  return jsonReply(res, 200, { ok: true, userId, status })
}

// ─── Router ───────────────────────────────────────────────────────────────────

export default async function adminHandler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' })
    return res.end()
  }

  if (!SUPABASE_URL || !SERVICE_KEY) return jsonReply(res, 500, { error: 'DB not configured' })

  const adminId = await verifyAdmin(req)
  if (!adminId) return jsonReply(res, 401, { error: 'Unauthorized' })

  if (req.method === 'GET') {
    const type = new URL(req.url ?? '/', 'http://localhost').searchParams.get('type') ?? 'users'
    if (type === 'analytics') return handleAnalytics(req, res)
    return handleUsers(req, res)
  }

  if (req.method === 'POST') return handleSetPro(req, res)

  return jsonReply(res, 405, { error: 'Method not allowed' })
}
