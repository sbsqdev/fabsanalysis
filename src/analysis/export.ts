/**
 * Export utilities — JSON download and HTML report generation.
 */

import type { AnalysisReport, FeatureAnalysis } from '../types';
import { featureLabel, inputTypeLabel, lightingLabel } from '../i18n';

// ─── JSON Export ─────────────────────────────────────────────────────────────

export function downloadJSON(report: AnalysisReport): void {
  const json = JSON.stringify(report, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, `analiz-lica-${formatDate()}.json`);
}

// ─── HTML Report Export ─────────────────────────────────────────────────────

export function downloadHTML(report: AnalysisReport): void {
  const html = generateHTMLReport(report);
  const blob = new Blob([html], { type: 'text/html' });
  downloadBlob(blob, `analiz-lica-${formatDate()}.html`);
}

function generateHTMLReport(r: AnalysisReport): string {
  const statusLabel = (s: string) => {
    switch (s) {
      case 'within_norm': return '<span style="color:#059669;font-weight:600">В пределах нормы</span>';
      case 'strength': return '<span style="color:#2563eb;font-weight:600">Сильная сторона</span>';
      case 'attention': return '<span style="color:#d97706;font-weight:600">К улучшению</span>';
      case 'insufficient_data': return '<span style="color:#6b7280;font-weight:600">Недостаточно данных</span>';
      default: return s;
    }
  };

  const featureHTML = (f: FeatureAnalysis) => `
    <div style="border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:16px;background:#fff">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="margin:0;font-size:18px;color:#111827">${featureLabel(f.name)}</h3>
        <div style="display:flex;align-items:center;gap:12px">
          ${statusLabel(f.status)}
          <span style="font-size:13px;color:#6b7280">Общий балл: ${Math.round(f.confidence * 100)}%</span>
        </div>
      </div>

      <div style="margin-bottom:12px">
        <h4 style="margin:0 0 6px;font-size:14px;color:#374151">Наблюдения</h4>
        <ul style="margin:0;padding-left:20px;color:#4b5563;font-size:14px">
          ${f.observations.map(o => `<li>${o}</li>`).join('')}
        </ul>
      </div>

      ${Object.keys(f.measurements).length > 0 ? `
      <div style="margin-bottom:12px">
        <h4 style="margin:0 0 6px;font-size:14px;color:#374151">Измерения</h4>
        <table style="border-collapse:collapse;font-size:13px;font-family:monospace">
          ${Object.entries(f.measurements).map(([k, v]) =>
            `<tr><td style="padding:2px 12px 2px 0;color:#6b7280">${k}</td><td style="color:#111827">${v}</td></tr>`
          ).join('')}
        </table>
      </div>` : ''}

      <div style="margin-bottom:12px">
        <h4 style="margin:0 0 6px;font-size:14px;color:#374151">Рекомендации</h4>
        <ul style="margin:0;padding-left:20px;color:#4b5563;font-size:14px">
          ${f.recommendations.map(rec => `<li>${rec}</li>`).join('')}
        </ul>
      </div>

    </div>
  `;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Отчет анализа лица — ${r.meta.date}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:Inter,-apple-system,system-ui,sans-serif;background:#f9fafb;color:#111827;margin:0;padding:24px}
    .container{max-width:800px;margin:0 auto}
    @media print{body{background:#fff;padding:12px}.no-print{display:none}}
  </style>
</head>
<body>
  <div class="container">
    <div style="text-align:center;margin-bottom:32px">
      <h1 style="margin:0 0 8px;font-size:28px;color:#111827">Отчет анализа лица</h1>
      <p style="margin:0;color:#6b7280;font-size:14px">${new Date(r.meta.date).toLocaleString('ru-RU')} &bull; v${r.meta.version}</p>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px;font-size:14px">
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
        <strong>Источник</strong>: ${inputTypeLabel(r.inputs.type)} (${r.inputs.resolution.width}x${r.inputs.resolution.height})<br>
        <strong>Качество</strong>: ${Math.round(r.inputs.qualityScore * 100)}%<br>
        <strong>Освещение</strong>: ${lightingLabel(r.inputs.lightingHeuristic)}
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
        <strong>Детекция лица</strong>: ${Math.round(r.faceDetection.confidence * 100)}% уверенности<br>
        <strong>Ключевые точки</strong>: ${r.landmarks.count}<br>
        <strong>Обработка</strong>: ${r.meta.processingTime}ms
      </div>
    </div>

    <h2 style="font-size:22px;margin:0 0 16px">Анализ признаков</h2>
    ${r.features.map(featureHTML).join('')}

    <div style="margin-top:32px;padding:20px;background:#fef3c7;border-radius:12px;border:1px solid #fbbf24">
      <h3 style="margin:0 0 8px;font-size:16px;color:#92400e">Дисклеймер</h3>
      <p style="margin:0;font-size:14px;color:#78350f">${r.disclaimer}</p>
    </div>

    <div class="no-print" style="text-align:center;margin-top:24px">
      <button onclick="window.print()" style="padding:10px 24px;background:#4c6ef5;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px">
        Печать / Сохранить в PDF
      </button>
    </div>
  </div>
</body>
</html>`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatDate(): string {
  return new Date().toISOString().slice(0, 10);
}
