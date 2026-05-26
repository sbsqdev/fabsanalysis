/**
 * Dev handler for GET/POST /api/analyses
 * Mirrors server/analysis-save-routes.mjs for use in the Vite dev server.
 */
import type { IncomingMessage, ServerResponse } from 'http';

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

interface FaceAnalysesRow {
  id: string;
  created_at: string;
  image_url: string | null;
  analysis_result: {
    inputs?: {
      qualityScore?: number;
    };
  } | null;
}

interface PublicAnalysisRow {
  id: string;
  created_at: string;
  overall_score: number | null;
  quality_score: number | null;
  thumbnail_url: string | null;
  report_json: unknown | null;
}

function jsonReply(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function toPublicRow(row: FaceAnalysesRow): PublicAnalysisRow {
  return {
    id: row.id,
    created_at: row.created_at,
    overall_score: null,
    quality_score: row.analysis_result?.inputs?.qualityScore ?? null,
    thumbnail_url: row.image_url ?? null,
    report_json: row.analysis_result ?? null,
  };
}

export default async function analysesHandler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const userId = req.headers['x-user-id'] as string | undefined;
  if (!userId) { jsonReply(res, 401, { error: 'Unauthorized' }); return; }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    jsonReply(res, 500, { error: 'DB not configured' });
    return;
  }

  const supaHeaders: Record<string, string> = {
    apikey:          SUPABASE_SERVICE_KEY,
    Authorization:   `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type':  'application/json',
  };

  // ── GET: list analyses for user ──
  if (req.method === 'GET') {
    const url = `${SUPABASE_URL}/rest/v1/face_analyses?user_id=eq.${userId}&order=created_at.desc&select=id,created_at,image_url,analysis_result`;
    const supaRes = await fetch(url, { headers: supaHeaders });
    const rows = await supaRes.json() as FaceAnalysesRow[];
    jsonReply(res, 200, Array.isArray(rows) ? rows.map(toPublicRow) : []);
    return;
  }

  // ── POST: save new analysis ──
  if (req.method === 'POST') {
    const raw = (await readBody(req)).toString();
    const body = JSON.parse(raw) as {
      report_json?: unknown;
      thumbnail_url?: string;
    };

    const supaRes = await fetch(`${SUPABASE_URL}/rest/v1/face_analyses`, {
      method:  'POST',
      headers: { ...supaHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({
        user_id:       userId,
        analysis_result: body.report_json   ?? null,
        image_url:      body.thumbnail_url ?? null,
      }),
    });

    const rows = await supaRes.json() as FaceAnalysesRow[];
    const payload = Array.isArray(rows) ? rows.map(toPublicRow) : rows;
    jsonReply(res, supaRes.ok ? 201 : 400, payload);
    return;
  }

  jsonReply(res, 405, { error: 'Method not allowed' });
}
