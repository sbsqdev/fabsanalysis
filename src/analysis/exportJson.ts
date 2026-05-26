/**
 * JSON export — generates a clean, structured JSON file with all analysis data.
 */
import type { AnalysisReport } from '../types';
import type { LLMAnalysisResult } from './llm';
import { featureLabel, statusLabel } from '../i18n';

interface ExportParams {
  report: AnalysisReport;
  aiResult: LLMAnalysisResult | null;
}

export function downloadJSON({ report, aiResult }: ExportParams): void {
  const dateStr = report.meta.date || new Date().toISOString();
  const date = new Date(dateStr);

  const exportData = {
    meta: {
      title: 'FABS Facial Analysis — Отчёт',
      exportedAt: new Date().toISOString(),
      analysisDate: dateStr,
      version: report.meta.version,
    },

    quality: {
      score: Math.round(report.inputs.qualityScore * 100),
      lighting: report.inputs.lightingHeuristic,
      device: report.meta.device,
      landmarkCount: report.landmarks.count,
      processingMs: report.meta.processingTime,
    },

    features: report.features.map((f) => {
      // aiResult.features is an array — find by name
      const featureAi = aiResult?.features?.find?.((a) => a.name === f.name) ?? null;

      // measurements is Record<string, number | string>
      const measurements: Record<string, number | string> = {};
      if (f.measurements && typeof f.measurements === 'object') {
        for (const [key, val] of Object.entries(f.measurements)) {
          measurements[key] = typeof val === 'number' ? Math.round(val * 1000) / 1000 : val;
        }
      }

      return {
        name: f.name,
        label: featureLabel(f.name),
        status: f.status,
        statusLabel: statusLabel(f.status),
        confidence: Math.round(f.confidence * 100),
        measurements,
        observations: f.observations ?? [],
        limitations: f.limitations ?? [],
        recommendations: f.recommendations ?? [],
        aiInsight: featureAi?.aiInsight ?? null,
        aiRecommendations: featureAi?.aiRecommendations ?? [],
      };
    }),

    summary: {
      totalFeatures: report.features.length,
      withinNorm: report.features.filter((f) => f.status === 'within_norm' || f.status === 'strength').length,
      attention: report.features.filter((f) => f.status === 'attention').length,
      insufficientData: report.features.filter((f) => f.status === 'insufficient_data').length,
      averageConfidence: Math.round(
        (report.features.reduce((sum, f) => sum + f.confidence, 0) / report.features.length) * 100
      ),
    },
  };

  const json = JSON.stringify(exportData, null, 2);
  const filename = `fabs-analysis-${date.toISOString().slice(0, 10)}.json`;

  // iOS Safari doesn't support programmatic downloads — use data URI fallback
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isIOS) {
    // Open as plain text in new tab
    const w = window.open('', '_blank');
    if (w) {
      w.document.write('<pre style="word-wrap:break-word;white-space:pre-wrap">' +
        json.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>');
      w.document.title = filename;
      w.document.close();
    }
  } else {
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  }
}
