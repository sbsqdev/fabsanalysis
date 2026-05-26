import type { FeatureAnalysis, FeatureName, StatusLevel } from '../types';
import { computeProportions } from './proportions';
import type { Gender, PopulationGroup } from '../types';

/** Features excluded from overall harmony score calculation */
const EXCLUDED_FROM_SCORE: Set<FeatureName> = new Set(['Neck', 'Skin', 'Ears', 'Cheeks']);

/** Base score per status level (0–100 scale) */
const STATUS_BASE: Record<StatusLevel, number> = {
  // Calibrated softer (Mar 2026):
  // - "within_norm" and moderate "attention" should not collapse into low 50s/60s.
  // - keep clear separation between true strengths and concern zones.
  strength:          94,
  within_norm:       83,
  attention:         60,
  insufficient_data: 54, // Still lower than typical within-norm, but not overly punitive
};

/**
 * Apply gentle score softening:
 * - below ~78: lift score slightly more
 * - above ~78: keep almost unchanged
 */
function softenOverallScore(raw: number): number {
  const pivot = 78;
  const lifted = raw < pivot
    ? raw + (pivot - raw) * 0.35
    : raw + (100 - raw) * 0.05;

  return Math.min(100, Math.round(lifted));
}

/**
 * Compute proximity-to-ideal bonus for a single feature.
 * Uses the proportion evaluation system to check how close
 * measurements are to ideal ranges.
 *
 * Returns a multiplier: 1.0 (no bonus) to 1.30 (all ideal).
 */
function proximityBonus(
  feature: FeatureAnalysis,
  gender: Gender | null = null,
  population: PopulationGroup = 'default',
): number {
  const proportions = computeProportions(
    feature.name,
    feature.measurements,
    gender,
    population,
  );

  if (!proportions || proportions.items.length === 0) return 1.0;

  let idealCount = 0;
  let closeCount = 0;
  let total = 0; // count only scoring items (excludes informational)

  for (const item of proportions.items) {
    if (item.informational) continue; // skip display-only items (e.g. golden ratio)
    total++;
    if (item.status === 'ideal') idealCount++;
    else if (item.status === 'close') closeCount++;
  }

  // Weighted score: ideal = 1.0, close = 0.5, deviation = 0
  const proximityScore = total > 0 ? (idealCount * 1.0 + closeCount * 0.5) / total : 0;

  // Bonus: 0% to +30% based on proximity to ideal
  return 1.0 + proximityScore * 0.30;
}

/**
 * Compute an overall harmony score (0–100) from a list of feature analyses.
 * Each feature is weighted by its detection confidence (min 0.3 to avoid
 * low-confidence features from pulling the score to zero).
 * Proximity-to-ideal bonus boosts the score for features near ideal ranges.
 */
export function computeOverallScore(
  features: FeatureAnalysis[],
  gender: Gender | null = null,
  population: PopulationGroup = 'default',
): number {
  if (!features || features.length === 0) return 0;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const f of features) {
    // Exclude non-scoring features and insufficient_data
    if (EXCLUDED_FROM_SCORE.has(f.name)) continue;
    if (f.status === 'insufficient_data') continue;
    const base = STATUS_BASE[f.status] ?? 60;
    const bonus = proximityBonus(f, gender, population);
    const boostedBase = Math.min(100, base * bonus);
    const w = Math.max(0.3, f.confidence);
    weightedSum += boostedBase * w;
    totalWeight += w;
  }
  if (totalWeight <= 0) return 0;
  const raw = Math.min(100, weightedSum / totalWeight);
  return softenOverallScore(raw);
}

/**
 * Compute confidence for a feature, boosted by proximity to ideal.
 * Technical confidence × proximity bonus, capped at 1.0.
 */
export function boostedConfidence(
  feature: FeatureAnalysis,
  gender: Gender | null = null,
  population: PopulationGroup = 'default',
): number {
  const bonus = proximityBonus(feature, gender, population);
  return Math.min(1.0, feature.confidence * bonus);
}

/**
 * Average boosted confidence across all features (0–1).
 * Uses proximity bonus to boost confidence for features near ideal.
 */
export function averageConfidence(
  features: FeatureAnalysis[],
  gender: Gender | null = null,
  population: PopulationGroup = 'default',
): number {
  if (!features.length) return 0;
  return features.reduce((s, f) => s + boostedConfidence(f, gender, population), 0) / features.length;
}

/** Count features by status */
export function countByStatus(features: FeatureAnalysis[]) {
  return {
    strength:          features.filter((f) => f.status === 'strength').length,
    within_norm:       features.filter((f) => f.status === 'within_norm').length,
    attention:         features.filter((f) => f.status === 'attention').length,
    insufficient_data: features.filter((f) => f.status === 'insufficient_data').length,
  };
}
