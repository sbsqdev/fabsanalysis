/**
 * PDF export — generates a clean, branded report with photos, metrics, and AI insights.
 * Uses jsPDF (no html2canvas dependency).
 */
import { jsPDF } from 'jspdf';
import type { AnalysisReport, FeatureAnalysis, StatusLevel } from '../types';
import type { LLMAnalysisResult } from './llm';
import { featureLabel, statusLabel, lightingLabel, measurementInfo, deviceLabel, getLocaleCode } from '../i18n';
import { getCurrentLang, type Lang } from '../lib/language';
import { computeOverallScore, countByStatus } from './scoring';
import { buildLipConsultationCTA } from './consultation';
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

/** Draw a circular arc (jsPDF has no native arc) by stroking short segments.
 *  Angles in degrees; 0° = 3 o'clock, increasing clockwise on the page. */
function drawArc(
  doc: jsPDF,
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
  color: readonly [number, number, number],
  width: number,
) {
  setDraw(doc, color);
  doc.setLineWidth(width);
  doc.setLineCap('round');
  const steps = Math.max(4, Math.round(Math.abs(endDeg - startDeg) / 4));
  let prev: { x: number; y: number } | null = null;
  for (let i = 0; i <= steps; i++) {
    const deg = startDeg + (endDeg - startDeg) * (i / steps);
    const rad = (deg * Math.PI) / 180;
    const px = cx + r * Math.cos(rad);
    const py = cy + r * Math.sin(rad);
    if (prev) doc.line(prev.x, prev.y, px, py);
    prev = { x: px, y: py };
  }
  doc.setLineCap('butt');
}

/** Load an image and resolve its natural pixel dimensions (async — required for
 *  correct aspect ratios; reading naturalWidth synchronously returns 0). */
function loadImageDims(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    img.onerror = () => resolve({ w: 1, h: 1 });
    img.src = dataUrl;
  });
}

function pdfT(lang: Lang, key: string, fallback: string): string {
  return PDF_TRANSLATIONS[lang][key] ?? PDF_TRANSLATIONS.ru[key] ?? fallback;
}

/** Wrap text to fit within maxWidth, return lines */
function wrapText(doc: jsPDF, text: string, maxWidth: number): string[] {
  return doc.splitTextToSize(text, maxWidth) as string[];
}

/** Add image from dataURL, fitting within maxW×maxH, centered in the box while
 *  preserving the image's true aspect ratio. */
async function addImage(
  doc: jsPDF,
  dataUrl: string,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
  placeholderText: string,
): Promise<{ w: number; h: number }> {
  const isJpeg = dataUrl.includes('image/jpeg') || dataUrl.includes('image/jpg');
  const format = isJpeg ? 'JPEG' : 'PNG';

  // Read the real pixel dimensions (must await — they are 0 before load).
  const dims = await loadImageDims(dataUrl);
  const ratio = dims.h / dims.w;

  // Fit inside the box, keeping aspect ratio (contain).
  let w = maxW;
  let h = w * ratio;
  if (h > maxH) {
    h = maxH;
    w = h / ratio;
  }

  // Center both horizontally and vertically within the box.
  const offsetX = x + (maxW - w) / 2;
  const offsetY = y + (maxH - h) / 2;

  try {
    // Soft frame behind the photo for a finished look.
    setDraw(doc, COLOR.lightGray);
    doc.setLineWidth(0.3);
    doc.roundedRect(offsetX - 0.6, offsetY - 0.6, w + 1.2, h + 1.2, 2, 2, 'S');
    doc.addImage(dataUrl, format, offsetX, offsetY, w, h, undefined, 'FAST');
  } catch {
    setFill(doc, COLOR.lightGray);
    doc.roundedRect(offsetX, offsetY, w, h, 3, 3, 'F');
    setColor(doc, COLOR.gray);
    doc.setFontSize(9);
    doc.text(placeholderText, offsetX + w / 2, offsetY + h / 2, { align: 'center' });
  }

  return { w, h };
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > PAGE_H - MARGIN) {
    doc.addPage();
    doc.setFont('Roboto', 'normal');
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

let fontCacheRegular: string | null = null;
let fontCacheBold: string | null = null;

async function fetchFontBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load font: ${url}`);
  return arrayBufferToBase64(await res.arrayBuffer());
}

/** Load Roboto Regular + Medium (used as bold) — both with full Cyrillic support.
 *  Headings use 'bold' so the document has real typographic hierarchy. */
async function loadFonts(doc: jsPDF): Promise<void> {
  if (!fontCacheRegular) {
    fontCacheRegular = await fetchFontBase64(
      'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Regular.ttf',
    );
  }
  if (!fontCacheBold) {
    try {
      fontCacheBold = await fetchFontBase64(
        'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Medium.ttf',
      );
    } catch {
      // Fall back to regular if the bold face can't be fetched.
      fontCacheBold = fontCacheRegular;
    }
  }
  doc.addFileToVFS('Roboto-Regular.ttf', fontCacheRegular);
  doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
  doc.addFileToVFS('Roboto-Medium.ttf', fontCacheBold);
  doc.addFont('Roboto-Medium.ttf', 'Roboto', 'bold');
  doc.setFont('Roboto', 'normal');
}

/** Set Roboto at a given weight in one call. */
function font(doc: jsPDF, weight: 'normal' | 'bold', size: number) {
  doc.setFont('Roboto', weight);
  doc.setFontSize(size);
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

  // Load fonts (regular + bold) before any text rendering
  await loadFonts(doc);

  const overallScore = Math.round(computeOverallScore(report.features));
  const statusCounts = countByStatus(report.features);
  const scoreColor =
    overallScore >= 80 ? COLOR.green :
    overallScore >= 60 ? COLOR.brand :
    COLOR.amber;

  let y = MARGIN;

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 1: Header + Score + Photos + Summary
  // ══════════════════════════════════════════════════════════════════════════

  // ── Brand header bar ──
  setFill(doc, COLOR.dark);
  doc.rect(0, 0, PAGE_W, 18, 'F');

  setColor(doc, COLOR.white);
  font(doc, 'bold', 13);
  doc.text('FABS', MARGIN, 12);
  setColor(doc, COLOR.gold);
  doc.text('  ProFace', MARGIN + doc.getTextWidth('FABS'), 12);

  setColor(doc, [180, 180, 185]);
  font(doc, 'normal', 8);
  doc.text(
    pdfT(lang, 'report.createdAt', lang === 'en' ? 'Generated' : 'Сформирован') +
      ' ' + new Date(report.meta.date).toLocaleDateString(locale),
    PAGE_W - MARGIN,
    12,
    { align: 'right' },
  );

  y = 26;

  // ── Report title ──
  setColor(doc, COLOR.dark);
  font(doc, 'bold', 16);
  doc.text(pdfT(lang, 'report.title', lang === 'en' ? 'Face Analysis Report' : 'Отчёт анализа лица'), PAGE_W / 2, y + 8, { align: 'center' });

  setColor(doc, COLOR.gray);
  font(doc, 'normal', 8.5);
  doc.text(
    `${report.features.length} ${pdfT(lang, 'report.features', lang === 'en' ? 'features analysed' : 'параметров проанализировано')}`,
    PAGE_W / 2,
    y + 15,
    { align: 'center' },
  );

  // ── Overall score ring ──
  const scoreCx = PAGE_W / 2;
  const scoreCy = y + 22 + 18;
  const scoreR = 20;

  // Track ring (full, light gray)
  setDraw(doc, [225, 225, 230]);
  doc.setLineWidth(3.5);
  doc.circle(scoreCx, scoreCy, scoreR, 'S');

  // Progress arc proportional to the score, starting at 12 o'clock, clockwise
  const startAngle = -90;
  const endAngle = -90 + 360 * (Math.min(100, Math.max(0, overallScore)) / 100);
  drawArc(doc, scoreCx, scoreCy, scoreR, startAngle, endAngle, scoreColor, 3.5);

  // Score number + denominator
  setColor(doc, COLOR.dark);
  font(doc, 'bold', 22);
  doc.text(String(overallScore), scoreCx, scoreCy + 3, { align: 'center' });
  setColor(doc, COLOR.gray);
  font(doc, 'normal', 7.5);
  doc.text('/ 100', scoreCx, scoreCy + 10, { align: 'center' });

  y = scoreCy + scoreR + 8;

  // ── Status pills row ──
  const pillItems = [
    { count: statusCounts.strength, label: lang === 'en' ? 'Strengths' : 'Сильные стороны', color: COLOR.brand },
    { count: statusCounts.within_norm, label: lang === 'en' ? 'Within Norm' : 'В норме', color: COLOR.green },
    { count: statusCounts.attention, label: lang === 'en' ? 'Needs Attention' : 'К улучшению', color: COLOR.amber },
  ].filter(p => p.count > 0);

  const pillW = 44;
  const pillGap = 5;
  const pillsTotal = pillItems.length * pillW + (pillItems.length - 1) * pillGap;
  let px = (PAGE_W - pillsTotal) / 2;
  for (const pill of pillItems) {
    setFill(doc, [pill.color[0], pill.color[1], pill.color[2]]);
    doc.roundedRect(px, y, pillW, 9, 4.5, 4.5, 'F');
    setColor(doc, COLOR.white);
    font(doc, 'bold', 7.5);
    doc.text(`${pill.count}  ${pill.label}`, px + pillW / 2, y + 5.9, { align: 'center' });
    px += pillW + pillGap;
  }

  y += 15;

  // Gold divider
  setDraw(doc, COLOR.gold);
  doc.setLineWidth(0.4);
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
        await addImage(doc, profileImageDataUrls.left, startX, y, profileW, photoRowH, photoUnavailable);
      }

      // Front photo (centered, larger)
      await addImage(doc, frontImageDataUrl, startX + profileW + gap, y, frontW, photoRowH, photoUnavailable);

      // Right profile
      if (profileImageDataUrls.right) {
        await addImage(
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
      await addImage(doc, frontImageDataUrl, MARGIN + CONTENT_W / 2 - 30, y, 60, photoRowH, photoUnavailable);
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
    font(doc, 'bold', 6.5);
    doc.text(s.label.toUpperCase(), sx + 4, y + 5.5);

    setColor(doc, COLOR.dark);
    font(doc, 'bold', 14);
    doc.text(s.value, sx + 4, y + 13);

    setColor(doc, COLOR.gray);
    font(doc, 'normal', 6.5);
    doc.text(wrapText(doc, s.sub, statW - 6)[0] ?? s.sub, sx + 4, y + 17.5);
  });

  y += 26;

  y += 4;

  // ══════════════════════════════════════════════════════════════════════════
  // FEATURE CARDS
  // ══════════════════════════════════════════════════════════════════════════

  for (const feature of report.features) {
    const aiFeature = aiResult?.features.find(a => a.name === feature.name);
    y = renderFeatureCard(doc, feature, aiFeature, y, lang);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PROFACE CTA
  // ══════════════════════════════════════════════════════════════════════════

  // ── Data-driven consultation CTA (built from the client's lip measurements) ──
  const lipsFeature = report.features.find((f) => f.name === 'Lips') ?? report.features[0];
  const cta = lipsFeature ? buildLipConsultationCTA(lipsFeature, lang, overallScore) : null;

  if (cta) {
    // Pre-measure so we can size the card and keep it on one page.
    font(doc, 'normal', 8);
    const introLines = wrapText(doc, cta.intro, CONTENT_W - 16);
    const pointLineSets = cta.points.map((p) => wrapText(doc, p, CONTENT_W - 22));
    const closingLines = wrapText(doc, cta.closing, CONTENT_W - 16);
    const pointsTotalLines = pointLineSets.reduce((s, l) => s + l.length, 0);
    const cardH =
      10 /* header */ +
      introLines.length * 3.8 + 2 +
      pointsTotalLines * 3.8 + cta.points.length * 1.5 + 2 +
      closingLines.length * 3.6 + 3 +
      8 /* whatsapp button */ + 6;

    y = ensureSpace(doc, y, cardH + 6);
    y += 4;

    // Card
    setFill(doc, [235, 240, 255]);
    setDraw(doc, COLOR.brand);
    doc.setLineWidth(0.4);
    doc.roundedRect(MARGIN, y, CONTENT_W, cardH, 3, 3, 'FD');

    let cy = y + 7;

    // Brand badge + headline
    setFill(doc, COLOR.brand);
    doc.circle(MARGIN + 8, cy - 1, 3.5, 'F');
    setColor(doc, COLOR.white);
    font(doc, 'bold', 6.5);
    doc.text('PF', MARGIN + 8, cy + 0.5, { align: 'center' });

    setColor(doc, [30, 40, 100]);
    font(doc, 'bold', 11);
    doc.text(cta.headline, MARGIN + 15, cy + 1);
    cy += 7;

    // Intro
    setColor(doc, [60, 70, 140]);
    font(doc, 'normal', 8);
    doc.text(introLines, MARGIN + 6, cy);
    cy += introLines.length * 3.8 + 2;

    // Data-driven bullet points
    pointLineSets.forEach((lines) => {
      setFill(doc, COLOR.brand);
      doc.circle(MARGIN + 8, cy - 1, 0.8, 'F');
      setColor(doc, [45, 55, 110]);
      font(doc, 'normal', 8);
      doc.text(lines, MARGIN + 12, cy);
      cy += lines.length * 3.8 + 1.5;
    });
    cy += 1;

    // Closing line
    setColor(doc, [70, 80, 150]);
    font(doc, 'normal', 7.5);
    doc.text(closingLines, MARGIN + 6, cy);
    cy += closingLines.length * 3.6 + 2;

    // WhatsApp button (clickable link in the PDF)
    const btnLabel = `${cta.whatsappLabel}  ${cta.whatsappDisplay}`;
    font(doc, 'bold', 8);
    const btnW = Math.min(CONTENT_W - 12, doc.getTextWidth(btnLabel) + 14);
    const btnX = MARGIN + 6;
    setFill(doc, COLOR.brand);
    doc.roundedRect(btnX, cy, btnW, 8, 4, 4, 'F');
    setColor(doc, COLOR.white);
    doc.text(btnLabel, btnX + btnW / 2, cy + 5.3, { align: 'center' });
    doc.link(btnX, cy, btnW, 8, { url: cta.whatsappUrl });

    y += cardH + 6;
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
  font(doc, 'bold', 9);
  doc.text(pdfT(lang, 'report.disclaimer', lang === 'en' ? 'Disclaimer' : 'Важно знать'), MARGIN + 6, y + 6);

  setColor(doc, [120, 53, 15]);
  font(doc, 'normal', 7.5);
  doc.text(disclaimerLines, MARGIN + 6, y + 12);

  y += disclaimerH + 6;

  // ── Footer ──
  y = ensureSpace(doc, y, 10);
  setColor(doc, COLOR.gray);
  font(doc, 'normal', 7);
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

  // ── Header: colored left bar + name + status badge ──
  y += 3;
  const statusColor = STATUS_COLOR[feature.status];

  // Colored left accent bar
  setFill(doc, statusColor);
  doc.roundedRect(MARGIN, y, 2.5, 8, 1, 1, 'F');

  setColor(doc, COLOR.dark);
  font(doc, 'bold', 11);
  doc.text(featureLabel(feature.name), MARGIN + 6, y + 6);

  // Status badge
  const status = statusLabel(feature.status);
  font(doc, 'bold', 7);
  const badgeW = doc.getTextWidth(status) + 10;
  const badgeX = PAGE_W - MARGIN - badgeW - 4;
  setFill(doc, statusColor);
  doc.roundedRect(badgeX, y + 0.5, badgeW, 6.5, 3.25, 3.25, 'F');
  setColor(doc, COLOR.white);
  doc.text(status, badgeX + badgeW / 2, y + 4.8, { align: 'center' });

  y += 12;

  // ── Observations ──
  const localizedObservations = localizeNarrativeList(feature.observations, lang);
  if (localizedObservations.length > 0) {
    setColor(doc, [60, 60, 68]);
    font(doc, 'normal', 7.5);
    for (const obs of localizedObservations) {
      y = ensureSpace(doc, y, 6);
      const lines = wrapText(doc, obs, CONTENT_W - 12);
      // colored bullet
      setFill(doc, statusColor);
      doc.circle(MARGIN + 7, y + 1.6, 0.7, 'F');
      setColor(doc, [60, 60, 68]);
      doc.text(lines, MARGIN + 10, y + 3);
      y += lines.length * 3.6 + 1.5;
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
      const colW = CONTENT_W / 2 - 4;
      const mx = MARGIN + 6 + col * colW;
      const my = y + 4 + row * 6;

      const meta = measurementInfo(key);
      setColor(doc, COLOR.gray);
      font(doc, 'normal', 6.5);
      doc.text(wrapText(doc, meta.label, colW - 24)[0] ?? meta.label, mx, my);

      setColor(doc, COLOR.dark);
      font(doc, 'bold', 7);
      const displayVal = typeof val === 'number' ? (Number.isInteger(val) ? String(val) : val.toFixed(2)) : String(val);
      doc.text(displayVal, mx + colW - 6, my, { align: 'right' });
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

    const insightLabel = lang === 'en' ? 'What this means' : 'Что это значит';
    font(doc, 'normal', 7);
    const insightLines = wrapText(doc, cleanInsight, CONTENT_W - 16);
    const insightH = insightLines.length * 3.6 + 9;
    y = ensureSpace(doc, y, insightH + 2);
    setFill(doc, [245, 240, 255]);
    doc.roundedRect(MARGIN + 2, y, CONTENT_W - 4, insightH, 1.5, 1.5, 'F');
    // accent bar
    setFill(doc, COLOR.brand);
    doc.roundedRect(MARGIN + 2, y, 1.5, insightH, 0.75, 0.75, 'F');

    setColor(doc, COLOR.brand);
    font(doc, 'bold', 6.5);
    doc.text(insightLabel.toUpperCase(), MARGIN + 7, y + 4);
    setColor(doc, [70, 50, 120]);
    font(doc, 'normal', 7);
    doc.text(insightLines, MARGIN + 7, y + 8);
    y += insightH + 2;
  }

  // ── Recommendations ──
  const recs = localizeNarrativeList(aiFeature?.aiRecommendations ?? feature.recommendations, lang);
  if (recs.length > 0) {
    y = ensureSpace(doc, y, 7);
    setColor(doc, COLOR.gray);
    font(doc, 'bold', 6.5);
    doc.text(
      (lang === 'en' ? 'What you can do' : 'Что можно сделать').toUpperCase(),
      MARGIN + 6, y + 3,
    );
    y += 5;
    for (const rec of recs) {
      y = ensureSpace(doc, y, 6);
      const recLines = wrapText(doc, rec, CONTENT_W - 12);
      setFill(doc, COLOR.green);
      doc.circle(MARGIN + 7, y + 1.6, 0.7, 'F');
      setColor(doc, [45, 45, 52]);
      font(doc, 'normal', 7);
      doc.text(recLines, MARGIN + 10, y + 3);
      y += recLines.length * 3.4 + 1.5;
    }
    y += 2;
  }

  // ── Card border line ──
  y += 2;
  setDraw(doc, COLOR.lightGray);
  doc.setLineWidth(0.2);
  doc.line(MARGIN + 6, y, PAGE_W - MARGIN - 6, y);
  y += 4;

  return y;
}
