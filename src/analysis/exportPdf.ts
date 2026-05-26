/**
 * PDF export — generates a clean, branded report with photos, metrics, and AI insights.
 * Uses jsPDF (no html2canvas dependency).
 */
import { jsPDF } from 'jspdf';
import type { AnalysisReport, FeatureAnalysis, StatusLevel } from '../types';
import type { LLMAnalysisResult } from './llm';
import { featureLabel, statusLabel, lightingLabel, measurementInfo, deviceLabel, getLocaleCode } from '../i18n';
import { getCurrentLang, type Lang } from '../lib/language';
import { localizeNarrativeList, localizeNarrativeText } from '../lib/narrativeLocalization';
import ruData from '../locales/ru';
import enData from '../locales/en';

// ─── Constants ──────────────────────────────────────────────────────────────

const PAGE_W = 210; // A4 mm
const PAGE_H = 297;
const MARGIN = 16;
const CONTENT_W = PAGE_W - MARGIN * 2;

const COLOR = {
  brand: [60, 90, 220] as const,     // blue accent
  gold: [180, 145, 75] as const,
  dark: [30, 30, 35] as const,
  gray: [120, 120, 130] as const,
  lightGray: [200, 200, 205] as const,
  green: [16, 160, 90] as const,
  amber: [210, 150, 30] as const,
  red: [200, 60, 50] as const,
  white: [255, 255, 255] as const,
  bg: [248, 248, 250] as const,
  cardBg: [255, 255, 255] as const,
};

const STATUS_COLOR: Record<StatusLevel, readonly [number, number, number]> = {
  within_norm: COLOR.green,
  strength: COLOR.brand,
  attention: COLOR.amber,
  insufficient_data: COLOR.gray,
};

const PDF_TRANSLATIONS: Record<Lang, Record<string, string>> = {
  ru: ruData,
  en: enData,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function setColor(doc: jsPDF, c: readonly [number, number, number]) {
  doc.setTextColor(c[0], c[1], c[2]);
}

function setFill(doc: jsPDF, c: readonly [number, number, number]) {
  doc.setFillColor(c[0], c[1], c[2]);
}

function setDraw(doc: jsPDF, c: readonly [number, number, number]) {
  doc.setDrawColor(c[0], c[1], c[2]);
}

function pdfT(lang: Lang, key: string, fallback: string): string {
  return PDF_TRANSLATIONS[lang][key] ?? PDF_TRANSLATIONS.ru[key] ?? fallback;
}

/** Wrap text to fit within maxWidth, return lines */
function wrapText(doc: jsPDF, text: string, maxWidth: number): string[] {
  return doc.splitTextToSize(text, maxWidth) as string[];
}

/** Add image from dataURL, fitting within maxW×maxH, centered horizontally at x */
function addImage(
  doc: jsPDF,
  dataUrl: string,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
  placeholderText: string,
): { w: number; h: number } {
  // Determine format from dataUrl
  const isJpeg = dataUrl.includes('image/jpeg') || dataUrl.includes('image/jpg');
  const format = isJpeg ? 'JPEG' : 'PNG';

  // Use maxW × maxH as the bounding box, maintain aspect ratio via jsPDF
  // We'll approximate by using the full width and calculating height proportionally
  const img = new Image();
  img.src = dataUrl;

  // For simplicity, use maxW and let jsPDF scale. We'll calculate approximate height
  const ratio = img.naturalHeight && img.naturalWidth
    ? img.naturalHeight / img.naturalWidth
    : maxH / maxW;

  let w = maxW;
  let h = w * ratio;
  if (h > maxH) {
    h = maxH;
    w = h / ratio;
  }

  const offsetX = x + (maxW - w) / 2;

  try {
    doc.addImage(dataUrl, format, offsetX, y, w, h);
  } catch {
    // If image fails, draw placeholder
    setFill(doc, COLOR.lightGray);
    doc.roundedRect(offsetX, y, w, h, 3, 3, 'F');
    setColor(doc, COLOR.gray);
    doc.setFontSize(9);
    doc.text(placeholderText, offsetX + w / 2, y + h / 2, { align: 'center' });
  }

  return { w, h };
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > PAGE_H - MARGIN) {
    doc.addPage();
    doc.setFont('Roboto');
    return MARGIN;
  }
  return y;
}

// ─── Cyrillic Font Loading ──────────────────────────────────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

let fontCache: string | null = null;

async function loadCyrillicFont(doc: jsPDF): Promise<void> {
  if (!fontCache) {
    // Roboto Regular TTF with full Cyrillic support (~170KB)
    const res = await fetch(
      'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Regular.ttf',
    );
    if (!res.ok) throw new Error('Failed to load Cyrillic font');
    fontCache = arrayBufferToBase64(await res.arrayBuffer());
  }
  doc.addFileToVFS('Roboto-Regular.ttf', fontCache);
  doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
  doc.setFont('Roboto');
}

// ─── Main export function ───────────────────────────────────────────────────

export interface PdfExportOptions {
  report: AnalysisReport;
  frontImageDataUrl: string | null;
  profileImageDataUrls: { left?: string; right?: string };
  aiResult: LLMAnalysisResult | null;
}

export async function downloadPDF(opts: PdfExportOptions): Promise<void> {
  const { report, frontImageDataUrl, profileImageDataUrls, aiResult } = opts;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const lang = getCurrentLang();
  const locale = getLocaleCode();
  const photoUnavailable = pdfT(
    lang,
    'report.photoUnavailable',
    lang === 'en' ? 'Photo unavailable' : 'Фото недоступно',
  );
  const localizedDisclaimer = localizeNarrativeText(report.disclaimer, lang);

  // Load Cyrillic font before any text rendering
  await loadCyrillicFont(doc);

  let y = MARGIN;

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 1: Header + Photos + Summary
  // ══════════════════════════════════════════════════════════════════════════

  // Brand header
  setColor(doc, COLOR.dark);
  doc.setFontSize(22);
  doc.text('FABS', MARGIN, y + 7);
  setColor(doc, COLOR.gold);
  doc.setFontSize(22);
  doc.text(' Facial Analysis', MARGIN + doc.getTextWidth('FABS'), y + 7);

  setColor(doc, COLOR.gray);
  doc.setFontSize(9);
  doc.text(
    `${pdfT(lang, 'report.createdAt', lang === 'en' ? 'Generated' : 'Сформирован')} ${new Date(report.meta.date).toLocaleString(locale)}`,
    PAGE_W - MARGIN,
    y + 7,
    { align: 'right' },
  );

  y += 14;

  // Divider line
  setDraw(doc, COLOR.gold);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 8;

  // ── Photos row ──
  if (frontImageDataUrl) {
    const photoRowH = 65;
    const hasProfiles = profileImageDataUrls.left || profileImageDataUrls.right;

    if (hasProfiles) {
      // 3-photo layout: front large center, profiles smaller on sides
      const frontW = 50;
      const profileW = 35;
      const gap = 6;
      const totalW = profileW + gap + frontW + gap + profileW;
      const startX = MARGIN + (CONTENT_W - totalW) / 2;

      // Left profile
      if (profileImageDataUrls.left) {
        addImage(doc, profileImageDataUrls.left, startX, y, profileW, photoRowH, photoUnavailable);
      }

      // Front photo (centered, larger)
      addImage(doc, frontImageDataUrl, startX + profileW + gap, y, frontW, photoRowH, photoUnavailable);

      // Right profile
      if (profileImageDataUrls.right) {
        addImage(
          doc,
          profileImageDataUrls.right,
          startX + profileW + gap + frontW + gap,
          y,
          profileW,
          photoRowH,
          photoUnavailable,
        );
      }
    } else {
      // Single front photo, centered
      addImage(doc, frontImageDataUrl, MARGIN + CONTENT_W / 2 - 30, y, 60, photoRowH, photoUnavailable);
    }

    y += photoRowH + 8;
  }

  // ── Quick stats grid ──
  const stats = [
    {
      label: pdfT(lang, 'report.quality', lang === 'en' ? 'Quality' : 'Качество'),
      value: `${Math.round(report.inputs.qualityScore * 100)}%`,
      sub: `${lightingLabel(report.inputs.lightingHeuristic)} ${pdfT(lang, 'report.lighting', lang === 'en' ? 'lighting' : 'освещение')}`,
    },
    {
      label: pdfT(lang, 'report.faceAccuracy', lang === 'en' ? 'Face Acc.' : 'Точн. лица'),
      value: `${Math.round(report.faceDetection.confidence * 100)}%`,
      sub: `${report.landmarks.count} ${pdfT(lang, 'report.points', lang === 'en' ? 'points' : 'точек')}`,
    },
    {
      label: pdfT(lang, 'report.features', lang === 'en' ? 'Features' : 'Признаков'),
      value: `${report.features.length}`,
      sub: `${report.features.filter(f => f.status === 'attention').length} ${pdfT(lang, 'report.needsAttention', lang === 'en' ? 'need attention' : 'к улучшению')}`,
    },
    {
      label: pdfT(lang, 'report.processing', lang === 'en' ? 'Processing' : 'Обработка'),
      value: `${report.meta.processingTime}ms`,
      sub: deviceLabel(report.meta.device),
    },
  ];

  const statW = (CONTENT_W - 6) / 4;
  stats.forEach((s, i) => {
    const sx = MARGIN + i * (statW + 2);
    setFill(doc, COLOR.bg);
    doc.roundedRect(sx, y, statW, 20, 2, 2, 'F');

    setColor(doc, COLOR.gray);
    doc.setFontSize(7);
    doc.text(s.label.toUpperCase(), sx + 4, y + 5.5);

    setColor(doc, COLOR.dark);
    doc.setFontSize(14);
    doc.text(s.value, sx + 4, y + 13);

    setColor(doc, COLOR.gray);
    doc.setFontSize(6.5);
    doc.text(s.sub, sx + 4, y + 17.5);
  });

  y += 26;

  // ── Status summary bar ──
  const statusCounts = {
    within_norm: report.features.filter(f => f.status === 'within_norm').length,
    strength: report.features.filter(f => f.status === 'strength').length,
    attention: report.features.filter(f => f.status === 'attention').length,
    insufficient: report.features.filter(f => f.status === 'insufficient_data').length,
  };

  const statusItems = [
    {
      count: statusCounts.within_norm + statusCounts.strength,
      label: pdfT(lang, 'detail.withinNorm', lang === 'en' ? 'Within Norm' : 'В норме'),
      color: COLOR.green,
    },
    { count: statusCounts.attention, label: statusLabel('attention'), color: COLOR.amber },
    { count: statusCounts.insufficient, label: statusLabel('insufficient_data'), color: COLOR.gray },
  ].filter(s => s.count > 0);

  let sx = MARGIN;
  statusItems.forEach((s) => {
    setFill(doc, s.color);
    doc.circle(sx + 2, y + 2, 1.5, 'F');
    setColor(doc, COLOR.dark);
    doc.setFontSize(8);
    doc.text(`${s.count} ${s.label}`, sx + 5.5, y + 3.5);
    sx += doc.getTextWidth(`${s.count} ${s.label}`) + 12;
  });

  y += 10;

  // ══════════════════════════════════════════════════════════════════════════
  // FEATURE CARDS
  // ══════════════════════════════════════════════════════════════════════════

  for (const feature of report.features) {
    const aiFeature = aiResult?.features.find(a => a.name === feature.name);
    y = renderFeatureCard(doc, feature, aiFeature, y, lang);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DISCLAIMER
  // ══════════════════════════════════════════════════════════════════════════

  y = ensureSpace(doc, y, 35);
  y += 4;
  setFill(doc, [255, 249, 235]);
  setDraw(doc, COLOR.amber);
  doc.setLineWidth(0.3);
  const disclaimerLines = wrapText(doc, localizedDisclaimer, CONTENT_W - 12);
  const disclaimerH = Math.max(20, disclaimerLines.length * 4 + 14);
  doc.roundedRect(MARGIN, y, CONTENT_W, disclaimerH, 2, 2, 'FD');

  setColor(doc, [146, 64, 14]);
  doc.setFontSize(9);
  doc.text(pdfT(lang, 'report.disclaimer', lang === 'en' ? 'Disclaimer' : 'Дисклеймер'), MARGIN + 6, y + 6);

  setColor(doc, [120, 53, 15]);
  doc.setFontSize(7.5);
  doc.text(disclaimerLines, MARGIN + 6, y + 12);

  y += disclaimerH + 6;

  // ── Footer ──
  y = ensureSpace(doc, y, 10);
  setColor(doc, COLOR.lightGray);
  doc.setFontSize(7);
  doc.text(
    `FABS Facial Analysis — ${pdfT(
      lang,
      'report.footerDisclaimer',
      lang === 'en'
        ? 'automated analysis is informational and not medical advice'
        : 'автоматический анализ носит информационный характер и не является медицинской рекомендацией',
    )}`,
    PAGE_W / 2,
    y + 2,
    { align: 'center' },
  );

  // ── Save ──
  doc.save(`FABS-analysis-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ─── Feature Card Renderer ──────────────────────────────────────────────────

function renderFeatureCard(
  doc: jsPDF,
  feature: FeatureAnalysis,
  aiFeature: { aiInsight: string; aiRecommendations: string[] } | undefined,
  startY: number,
  lang: Lang,
): number {
  // Pre-calculate card height to check if we need a new page
  const needsSpace = 40; // minimum estimate
  let y = ensureSpace(doc, startY, needsSpace);

  // ── Header: name + status ──
  y += 2;
  setColor(doc, COLOR.dark);
  doc.setFontSize(12);
  doc.text(featureLabel(feature.name), MARGIN + 4, y + 5);

  // Status badge
  const status = statusLabel(feature.status);
  const statusColor = STATUS_COLOR[feature.status];
  const badgeW = doc.getTextWidth(status) + 8;
  const badgeX = PAGE_W - MARGIN - badgeW - 4;
  setFill(doc, statusColor);
  doc.roundedRect(badgeX, y + 0.5, badgeW, 6, 1.5, 1.5, 'F');
  setColor(doc, COLOR.white);
  doc.setFontSize(7);
  doc.text(status, badgeX + badgeW / 2, y + 4.5, { align: 'center' });

  // Confidence
  setColor(doc, COLOR.gray);
  doc.setFontSize(7);
  doc.text(`${Math.round(feature.confidence * 100)}%`, badgeX - 3, y + 4.5, { align: 'right' });

  y += 10;

  // ── Observations ──
  const localizedObservations = localizeNarrativeList(feature.observations, lang);
  if (localizedObservations.length > 0) {
    setColor(doc, COLOR.dark);
    doc.setFontSize(7.5);
    for (const obs of localizedObservations) {
      y = ensureSpace(doc, y, 6);
      const lines = wrapText(doc, `• ${obs}`, CONTENT_W - 10);
      doc.text(lines, MARGIN + 6, y + 3);
      y += lines.length * 3.5 + 1;
    }
    y += 2;
  }

  // ── Key measurements (top 4) ──
  const measurementEntries = Object.entries(feature.measurements)
    .filter(([k]) => !k.toLowerCase().includes('confidence'))
    .slice(0, 4);

  if (measurementEntries.length > 0) {
    y = ensureSpace(doc, y, 10);
    setFill(doc, COLOR.bg);
    const mH = Math.ceil(measurementEntries.length / 2) * 6 + 4;
    doc.roundedRect(MARGIN + 2, y, CONTENT_W - 4, mH, 1.5, 1.5, 'F');

    measurementEntries.forEach(([key, val], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const mx = MARGIN + 6 + col * (CONTENT_W / 2 - 4);
      const my = y + 4 + row * 6;

      const meta = measurementInfo(key);
      setColor(doc, COLOR.gray);
      doc.setFontSize(6.5);
      doc.text(meta.label, mx, my);

      setColor(doc, COLOR.dark);
      doc.setFontSize(7);
      const displayVal = typeof val === 'number' ? (Number.isInteger(val) ? String(val) : val.toFixed(2)) : String(val);
      doc.text(displayVal, mx + 40, my);
    });

    y += mH + 3;
  }

  // ── AI Insight ──
  if (aiFeature?.aiInsight) {
    y = ensureSpace(doc, y, 14);
    const cleanInsight = localizeNarrativeText(
      aiFeature.aiInsight
        .replace(/Параметры:[^.]+\./gi, '')
        .replace(/Parameters:[^.]+\./gi, '')
        .replace(/Status:\s*Attention\.?/gi, '')
        .replace(/Status:\s*Needs Attention\.?/gi, '')
        .replace(/✦\s*(AI-инсайт|AI insight|AI-insight):\s*/gi, '')
        .trim(),
      lang,
    );

    setFill(doc, [245, 240, 255]);
    const insightLines = wrapText(doc, cleanInsight, CONTENT_W - 14);
    const insightH = insightLines.length * 3.5 + 6;
    doc.roundedRect(MARGIN + 2, y, CONTENT_W - 4, insightH, 1.5, 1.5, 'F');

    setColor(doc, [90, 50, 160]);
    doc.setFontSize(7);
    doc.text(insightLines, MARGIN + 6, y + 4.5);
    y += insightH + 2;
  }

  // ── Recommendations ──
  const recs = localizeNarrativeList(aiFeature?.aiRecommendations ?? feature.recommendations, lang);
  if (recs.length > 0) {
    for (const rec of recs) {
      y = ensureSpace(doc, y, 6);
      setColor(doc, COLOR.dark);
      doc.setFontSize(7);
      const recLines = wrapText(doc, `→ ${rec}`, CONTENT_W - 10);
      doc.text(recLines, MARGIN + 6, y + 3);
      y += recLines.length * 3.2 + 1.5;
    }
    y += 2;
  }

  // ── Card border line ──
  y += 2;
  setDraw(doc, COLOR.lightGray);
  doc.setLineWidth(0.2);
  doc.line(MARGIN + 10, y, PAGE_W - MARGIN - 10, y);
  y += 4;

  return y;
}
