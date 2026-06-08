import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAnalyze } from './analyze-handler.mjs';
import { handleProfileLandmarks } from './profile-landmarks-handler.mjs';
import { handleTransform } from './transform-handler.mjs';
import { handlePayment } from './payment-routes.mjs';
import { handleAnalyses } from './analysis-save-routes.mjs';
import { handleVerifyKaspi } from './verifyKaspi-handler.mjs';
import { handleSummary } from './summary-handler.mjs';
import { handleApipayCreate, handleApipayStatus, handleApipayWebhook } from './apipay-handler.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, 'utf8');
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

// Standalone server mode (`npm run start`) does not auto-load Vite env files.
// Load .env.local/.env manually so API keys behave the same as in `npm run dev`.
loadEnvFile(path.resolve(ROOT_DIR, '.env.local'));
loadEnvFile(path.resolve(ROOT_DIR, '.env'));

const PORT = Number(process.env.PORT || 4173);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.onnx': 'application/octet-stream',
  '.wasm': 'application/wasm',
};

function safeResolveFromDist(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const normalized = decoded === '/' ? '/index.html' : decoded;
  const cleaned = normalized.replace(/^\/+/, '');
  const candidate = path.resolve(DIST_DIR, cleaned);
  if (!candidate.startsWith(DIST_DIR)) return null;
  return candidate;
}

async function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
  const normalizedPath = filePath.replace(/\\/g, '/');
  const headers = { 'Content-Type': mimeType };
  // Cache strategy:
  // - HTML: no-cache (always revalidate)
  // - Hashed bundles in dist/assets: long immutable cache
  // - Large runtime/model binaries (.wasm/.onnx and /models): short-lived cache
  if (ext === '.html') {
    headers['Cache-Control'] = 'no-cache';
  } else if (normalizedPath.includes('/dist/assets/')) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  } else if (
    ext === '.wasm' ||
    ext === '.onnx' ||
    normalizedPath.includes('/dist/models/')
  ) {
    headers['Cache-Control'] = 'public, max-age=86400';
  } else {
    headers['Cache-Control'] = 'public, max-age=3600';
  }
  // COOP/COEP required for onnxruntime-web WASM SharedArrayBuffer support
  headers['Cross-Origin-Opener-Policy'] = 'same-origin';
  headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
  res.writeHead(200, headers);
  createReadStream(filePath).pipe(res);
}

async function fileExists(filePath) {
  try { await access(filePath); return true; } catch { return false; }
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id, stripe-signature');
}

/**
 * POST /api/phone-lookup
 * Body: { phone: "+7XXXXXXXXXX" }
 * Returns: { email: "..." } or 404.
 *
 * Requires env: SUPABASE_SERVICE_KEY (project Settings → API → service_role secret).
 * This key bypasses RLS, so this endpoint must NOT be exposed without rate-limiting in prod.
 */
async function handlePhoneLookup(req, res) {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;

  if (!serviceKey || !supabaseUrl) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Phone lookup not configured on server.' }));
    return;
  }

  let body = '';
  for await (const chunk of req) body += chunk;
  let phone;
  try { ({ phone } = JSON.parse(body)); } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  if (!phone || typeof phone !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'phone required' }));
    return;
  }

  // Query profiles table using service role key (bypasses RLS)
  const apiUrl = `${supabaseUrl}/rest/v1/profiles?phone=eq.${encodeURIComponent(phone)}&select=email&limit=1`;
  const resp = await fetch(apiUrl, {
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!resp.ok) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'DB query failed' }));
    return;
  }

  const rows = await resp.json();
  if (!Array.isArray(rows) || rows.length === 0 || !rows[0].email) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ email: rows[0].email }));
}

/** Structured request logger for API calls — visible in PM2 logs */
function logApi(method, url, statusCode, durationMs, meta = {}) {
  const ts = new Date().toISOString();
  const userId = meta.userId ? ` user=${meta.userId.slice(0, 8)}…` : '';
  const extra = meta.error ? ` error="${meta.error}"` : '';
  const size = meta.bodySize ? ` body=${meta.bodySize}b` : '';
  console.log(`[API] ${ts} ${method} ${url} → ${statusCode} (${durationMs}ms)${userId}${size}${extra}`);
}

const server = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400); res.end('Bad request'); return;
  }

  corsHeaders(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const isApiCall = req.url.startsWith('/api/');
  const apiStart = isApiCall ? Date.now() : 0;
  const userId = req.headers['x-user-id'];

  // Wrap res.end to capture status code for logging
  if (isApiCall) {
    const originalEnd = res.end.bind(res);
    res.end = function (...args) {
      const duration = Date.now() - apiStart;
      logApi(req.method, req.url, res.statusCode, duration, {
        userId,
        error: res.statusCode >= 400 ? (args[0]?.toString().slice(0, 120) || '') : undefined,
      });
      return originalEnd(...args);
    };
  }

  // Phone → email lookup for login-with-phone feature.
  // Requires SUPABASE_SERVICE_KEY env var (Supabase project settings → API → service_role key).
  if (req.url === '/api/phone-lookup' && req.method === 'POST') {
    await handlePhoneLookup(req, res); return;
  }

  // AI analysis endpoints (protected by user id header in prod)
  if (req.url.startsWith('/api/analyze')) { await handleAnalyze(req, res); return; }
  if (req.url.startsWith('/api/profile-landmarks')) { await handleProfileLandmarks(req, res); return; }
  if (req.url.startsWith('/api/transform')) { await handleTransform(req, res); return; }
  if (req.url.startsWith('/api/summary')) { await handleSummary(req, res); return; }

  // Kaspi receipt verification
  if (req.url.startsWith('/api/apipay/create'))  { await handleApipayCreate(req, res); return; }
  if (req.url.startsWith('/api/apipay/status'))  { await handleApipayStatus(req, res); return; }
  if (req.url.startsWith('/api/apipay/webhook')) { await handleApipayWebhook(req, res); return; }

  if (req.url.startsWith('/api/verifyKaspi')) { await handleVerifyKaspi(req, res); return; }

  // Payment endpoints
  if (req.url.startsWith('/api/payment')) { await handlePayment(req, res); return; }

  // Saved analyses CRUD
  if (req.url.startsWith('/api/analyses')) { await handleAnalyses(req, res); return; }

  // Static file serving
  const filePath = safeResolveFromDist(req.url);
  if (!filePath) { res.writeHead(403); res.end('Forbidden'); return; }

  if (await fileExists(filePath)) { await sendFile(res, filePath); return; }

  // SPA fallback
  const indexPath = path.resolve(DIST_DIR, 'index.html');
  if (await fileExists(indexPath)) { await sendFile(res, indexPath); return; }

  res.writeHead(500); res.end('dist/index.html not found. Run `npm run build` first.');
});

server.listen(PORT, () => {
  console.log(`[beauty-platform] running on http://0.0.0.0:${PORT}`);
});
