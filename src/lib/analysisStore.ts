import { computeOverallScore } from '../analysis/scoring';
import type { AnalysisReport } from '../types';
import { supabase } from './supabase';

export interface StoredAnalysisRecord {
  id: string;
  created_at: string;
  overall_score: number | null;
  quality_score: number | null;
  thumbnail_url: string | null;
  report_json: AnalysisReport | null;
}

interface FaceAnalysisRow {
  id: string;
  created_at: string;
  image_url: string | null;
  analysis_result: AnalysisReport | null;
}

interface SaveAnalysisInput {
  userId: string;
  report: AnalysisReport;
  thumbnailUrl: string | null;
}

function isPayloadTooLarge(error: unknown): boolean {
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message)
    : '';
  return /413|payload|too large|request entity/i.test(message);
}

function normalizeFaceRow(row: FaceAnalysisRow): StoredAnalysisRecord {
  const report = row.analysis_result ?? null;
  const features = report?.features ?? [];
  return {
    id: row.id,
    created_at: row.created_at,
    thumbnail_url: row.image_url ?? null,
    report_json: report,
    overall_score: features.length > 0 ? computeOverallScore(features) : null,
    quality_score: report?.inputs?.qualityScore ?? null,
  };
}

async function saveToFaceAnalyses(input: SaveAnalysisInput): Promise<void> {
  const payload = {
    user_id: input.userId,
    image_url: input.thumbnailUrl,
    analysis_result: input.report,
  };
  const { error } = await supabase.from('face_analyses').insert(payload);
  if (!error) return;

  if (isPayloadTooLarge(error)) {
    const retry = await supabase
      .from('face_analyses')
      .insert({ ...payload, image_url: null });
    if (!retry.error) return;
    throw retry.error;
  }

  throw error;
}

export async function saveAnalysisForUser(input: SaveAnalysisInput): Promise<void> {
  await saveToFaceAnalyses(input);
}

export async function fetchAnalysesForUser(userId: string): Promise<StoredAnalysisRecord[]> {
  const rows = await supabase
    .from('face_analyses')
    .select('id, created_at, image_url, analysis_result')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (rows.error) throw rows.error;

  return ((rows.data as FaceAnalysisRow[]) ?? []).map(normalizeFaceRow);
}

export async function fetchAnalysisById(id: string): Promise<StoredAnalysisRecord | null> {
  const row = await supabase
    .from('face_analyses')
    .select('id, created_at, image_url, analysis_result')
    .eq('id', id)
    .single();
  if (row.error) throw row.error;

  return normalizeFaceRow(row.data as FaceAnalysisRow);
}

export async function deleteAnalysisById(id: string, userId?: string): Promise<void> {
  let query = supabase
    .from('face_analyses')
    .delete()
    .eq('id', id);

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { error } = await query;
  if (error) throw error;
}
