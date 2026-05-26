/**
 * Analysis CRUD routes
 * GET  /api/analyses  — list user's saved analyses
 * POST /api/analyses  — save a new analysis
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function toPublicRow(row) {
  return {
    id: row.id,
    created_at: row.created_at,
    overall_score: null,
    quality_score: row?.analysis_result?.inputs?.qualityScore ?? null,
    thumbnail_url: row.image_url ?? null,
    report_json: row.analysis_result ?? null,
  };
}

export async function handleAnalyses(req, res) {
  const userId = req.headers['x-user-id'];
  if (!userId) { json(res, 401, { error: 'Unauthorized' }); return; }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { json(res, 500, { error: 'DB not configured' }); return; }

  const supaHeaders = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  // List analyses
  if (req.method === 'GET') {
    const supaRes = await fetch(
      `${SUPABASE_URL}/rest/v1/face_analyses?user_id=eq.${userId}&order=created_at.desc&select=id,created_at,image_url,analysis_result`,
      { headers: supaHeaders }
    );
    const rows = await supaRes.json();
    json(res, 200, Array.isArray(rows) ? rows.map(toPublicRow) : []);
    return;
  }

  // Save analysis
  if (req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString());
    const { report_json, thumbnail_url } = body;

    const supaRes = await fetch(`${SUPABASE_URL}/rest/v1/face_analyses`, {
      method: 'POST',
      headers: { ...supaHeaders, 'Prefer': 'return=representation' },
      body: JSON.stringify({
        user_id: userId,
        analysis_result: report_json || null,
        image_url: thumbnail_url || null,
      }),
    });

    const rows = await supaRes.json();
    const payload = Array.isArray(rows) ? rows.map(toPublicRow) : rows;
    json(res, supaRes.ok ? 201 : 400, payload);
    return;
  }

  json(res, 405, { error: 'Method not allowed' });
}
