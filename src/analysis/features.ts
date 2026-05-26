/**
 * Feature analysis for all 11 protocol features.
 * Each function returns a FeatureAnalysis object.
 */

import type { FeatureAnalysis, NormalizedLandmark } from '../types';
import * as M from './metrics';
import { CHEEKS } from './landmarks';
import {
  extractSoftTissueProfile,
  computeSoftTissueMetrics,
  fuseSoftTissueMetrics,
  type SoftTissueMetrics,
} from './softTissueProfile';

type Lm = NormalizedLandmark[];

// ─── Helper ──────────────────────────────────────────────────────────────────

function round(n: number, d = 3): number {
  return Math.round(n * 10 ** d) / 10 ** d;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function pushIfFinite(arr: number[], value: number): void {
  if (Number.isFinite(value)) arr.push(value);
}

function avgOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function statusFromConfidence(
  confidence: number,
  isNormal: boolean,
  severity = 1,
  allIdeal = false,
): 'within_norm' | 'strength' | 'attention' | 'insufficient_data' {
  if (confidence < 0.45) return 'insufficient_data';
  // strength: high confidence, all proportions ideal, zero deviation
  if (isNormal && allIdeal && severity === 0 && confidence >= 0.70) return 'strength';
  if (isNormal) return 'within_norm';
  // Small deviations are often pose/lighting-related in 2D and should not be over-penalized.
  if (severity <= 0.18) return 'within_norm';
  if (severity <= 0.35 && confidence < 0.65) return 'within_norm';
  return 'attention';
}

function rangeSeverity(value: number, min: number, max: number, softness = 0.25): number {
  if (value >= min && value <= max) return 0;
  const span = Math.max(1e-6, max - min);
  const delta = value < min ? min - value : value - max;
  return Math.min(1, delta / (span * softness));
}

function lowBoundSeverity(value: number, min: number, softness = 0.25): number {
  if (value >= min) return 0;
  const scale = Math.max(1e-6, min * softness);
  return Math.min(1, (min - value) / scale);
}

function combineSeverity(...parts: number[]): number {
  if (parts.length === 0) return 0;
  const clamped = parts.map((p) => Math.max(0, Math.min(1, p)));
  // Weighted toward max deviation while keeping moderate signals meaningful.
  return Math.max(...clamped) * 0.65 + (clamped.reduce((a, b) => a + b, 0) / clamped.length) * 0.35;
}

/**
 * Dynamic confidence: base × softened qualityFactor, clamped to [0.05, base].
 * qualityFactor comes from photo quality (face detection confidence, lighting, resolution).
 * Softened formula: base × (0.5 + 0.5 × qualityFactor) — at worst quality,
 * confidence drops by 50% instead of 100%.
 */
function dynConf(base: number, qualityFactor: number): number {
  const softened = 0.5 + 0.5 * qualityFactor;
  return round(Math.min(base, Math.max(0.05, base * softened)), 2);
}

/**
 * Extract and fuse soft-tissue cephalometric metrics from available profiles.
 * Returns null if no profile landmarks are available.
 */
function extractAndFuseSoftTissue(
  profileLeftLm?: Lm | null,
  profileRightLm?: Lm | null,
  imageAspectRatio = 1,
): SoftTissueMetrics | null {
  let leftMetrics: SoftTissueMetrics | null = null;
  let rightMetrics: SoftTissueMetrics | null = null;

  if (profileLeftLm) {
    const profile = extractSoftTissueProfile(profileLeftLm, 'left', imageAspectRatio);
    if (profile.overallConfidence > 0.1) {
      leftMetrics = computeSoftTissueMetrics(profile, imageAspectRatio);
    }
  }
  if (profileRightLm) {
    const profile = extractSoftTissueProfile(profileRightLm, 'right', imageAspectRatio);
    if (profile.overallConfidence > 0.1) {
      rightMetrics = computeSoftTissueMetrics(profile, imageAspectRatio);
    }
  }

  return fuseSoftTissueMetrics(leftMetrics, rightMetrics);
}

// ─── 1. Eyebrows ────────────────────────────────────────────────────────────

export function analyzeEyebrows(lm: Lm, qualityFactor = 1, hasProfiles = false, imageAspectRatio = 1): FeatureAnalysis {
  const rAngle = M.eyebrowArchAngle(lm, 'right', imageAspectRatio);
  const lAngle = M.eyebrowArchAngle(lm, 'left', imageAspectRatio);
  const symmetry = M.eyebrowSymmetry(lm, imageAspectRatio);
  const rLength = M.eyebrowLengthProxy(lm, 'right', imageAspectRatio);
  const lLength = M.eyebrowLengthProxy(lm, 'left', imageAspectRatio);
  const rEyeDist = M.eyebrowEyeDistance(lm, 'right', imageAspectRatio);
  const lEyeDist = M.eyebrowEyeDistance(lm, 'left', imageAspectRatio);
  const avgEyeDist = (rEyeDist + lEyeDist) / 2;
  const avgLength = (rLength + lLength) / 2;

  // isSymmetric bounds aligned with rangeSeverity bounds (0.045, 0.115) — P.ts unisex
  const isSymmetric = symmetry > 0.85 && avgEyeDist > 0.045 && avgEyeDist < 0.115;
  const severity = combineSeverity(
    lowBoundSeverity(symmetry, 0.85, 0.35),
    rangeSeverity(avgEyeDist, 0.045, 0.115, 0.4),
  );
  const observations: string[] = [];
  const recommendations: string[] = [];

  observations.push(
    `Угол арки: справа ${round(rAngle, 1)}°, слева ${round(lAngle, 1)}°`,
  );
  observations.push(`Индекс симметрии: ${round(symmetry)}`);
  observations.push(
    `Расстояние бровь-глаз (нормализованное): ${round(avgEyeDist)}`,
  );
  observations.push(`Длина бровей (прокси): ${round(avgLength)}`);

  if (symmetry > 0.9) {
    observations.push('Брови демонстрируют хорошую двустороннюю симметрию');
  } else if (symmetry > 0.8) {
    observations.push('Обнаружена легкая асимметрия бровей');
    recommendations.push(
      'При желании мастер-бровист может скорректировать небольшую асимметрию с помощью ухода и формы',
    );
  } else {
    observations.push('Выраженная асимметрия между бровями');
    recommendations.push(
      'Можно проконсультироваться с бровистом по симметрии — умеренная асимметрия естественна и очень распространена',
    );
  }

  if (avgEyeDist < 0.045) {
    observations.push('Брови расположены близко к линии глаз');
  } else if (avgEyeDist > 0.115) {
    observations.push('Брови расположены высоко относительно линии глаз');
  }

  if (hasProfiles) {
    observations.push('Профильные снимки предоставлены — форма бровей оценена только по фронтальному ракурсу');
  }

  // Profile data doesn't contribute additional eyebrow measurements (one eyebrow
  // is fully or partially occluded on each profile), but we slightly boost confidence
  // when profiles confirm face detection quality.
  const base = hasProfiles ? 0.77 : 0.75;

  return {
    name: 'Eyebrows',
    status: statusFromConfidence(dynConf(base, qualityFactor), isSymmetric, severity),
    observations,
    measurements: {
      rightArchAngle: round(rAngle, 1),
      leftArchAngle: round(lAngle, 1),
      symmetryIndex: round(symmetry),
      rightLengthProxy: round(rLength),
      leftLengthProxy: round(lLength),
      browToEyeDistance: round(avgEyeDist),
    },
    recommendations,
    confidence: dynConf(base, qualityFactor),
    limitations: [
      'Толщину и плотность бровей нельзя точно измерить только по ключевым точкам',
      'Для оценки густоты, цвета и текстуры нужен крупный план',
      'Мимика влияет на положение и форму бровей',
      ...(hasProfiles ? [] : ['Профильный анализ бровей недоступен — одна бровь скрыта в профиль']),
    ],
  };
}

// ─── 3. Eyes ────────────────────────────────────────────────────────────────

export function analyzeEyes(
  lm: Lm,
  qualityFactor = 1,
  hasProfiles = false,
  imageAspectRatio = 1,
): FeatureAnalysis {
  const rEAR = M.eyeAspectRatio(lm, 'right', imageAspectRatio);
  const lEAR = M.eyeAspectRatio(lm, 'left', imageAspectRatio);
  const symmetry = M.eyeSymmetry(lm, imageAspectRatio);
  const ipd = M.interpupillaryDistance(lm, imageAspectRatio);
  const rWidthRatio = M.eyeWidthRatio(lm, 'right', imageAspectRatio);
  const lWidthRatio = M.eyeWidthRatio(lm, 'left', imageAspectRatio);
  const fifths = M.facialFifthsProxy(lm, imageAspectRatio);
  const rCanthalTilt = M.canthalTilt(lm, 'right', imageAspectRatio);
  const lCanthalTilt = M.canthalTilt(lm, 'left', imageAspectRatio);
  const avgCanthalTilt = (rCanthalTilt + lCanthalTilt) / 2;

  const avgEAR = (rEAR + lEAR) / 2;
  // EAR ranges for 3-pair Soukupova formula. isNormal lower bound aligned with proportion ideal (0.38 female)
  // 0.30 is the physiological gate (not pathological); 0.38+ is the aesthetic optimum tracked separately
  const isNormal =
    avgEAR > 0.30 &&
    avgEAR < 0.55 &&
    symmetry > 0.85 &&
    // isNormal aligned with rangeSeverity bounds (0.85, 1.15) — P.ts unisex
    fifths.intercanthalToEye > 0.85 &&
    fifths.intercanthalToEye < 1.15;
  const severity = combineSeverity(
    rangeSeverity(avgEAR, 0.30, 0.55, 0.35),
    lowBoundSeverity(symmetry, 0.85, 0.35),
    rangeSeverity(fifths.intercanthalToEye, 0.85, 1.15, 0.45),
  );

  const observations: string[] = [];
  const recommendations: string[] = [];

  observations.push(`Открытость глаз (EAR): справа ${round(rEAR)}, слева ${round(lEAR)}`);
  observations.push(`Симметрия глаз: ${round(symmetry)}`);
  observations.push(`Межзрачковое расстояние (нормализованное): ${round(ipd)}`);
  observations.push(`Соотношение межкантального расстояния к ширине глаза: ${round(fifths.intercanthalToEye)}`);
  observations.push(`Кантальный наклон: справа ${round(rCanthalTilt, 3)}, слева ${round(lCanthalTilt, 3)}`);
  if (avgCanthalTilt > 0.005) {
    observations.push('Позитивный кантальный наклон (латеральный уголок выше медиального) — ассоциируется с молодостью');
  } else if (avgCanthalTilt < -0.005) {
    observations.push('Негативный кантальный наклон (латеральный уголок ниже медиального)');
  }

  if (avgEAR < 0.30) {
    observations.push('Глаза выглядят более узкими или частично прикрытыми — это может зависеть от прищура, освещения или естественной формы');
  } else if (avgEAR >= 0.55) {
    observations.push('Глаза выглядят широко раскрытыми');
  } else {
    observations.push('Открытость глаз в типичном диапазоне');
  }

  if (symmetry > 0.9) {
    observations.push('Хорошая двусторонняя симметрия глаз');
  } else if (symmetry > 0.8) {
    observations.push('Небольшая асимметрия открытости глаз — это очень распространено и часто незаметно');
  } else {
    observations.push('Обнаружена выраженная асимметрия открытости глаз');
    recommendations.push(
      'При заметной асимметрии глаз можно обратиться к офтальмологу, чтобы исключить птоз или другие состояния',
    );
  }

  if (hasProfiles) {
    observations.push('Профильные снимки предоставлены — глаза оцениваются только по фронтальному ракурсу (в профиль один глаз полностью скрыт)');
  }

  // Profile captures don't add direct eye measurements (the farther eye is
  // fully occluded on each profile), but their availability implies a complete
  // 3-angle capture session, slightly improving our overall quality signal.
  const base = hasProfiles ? 0.87 : 0.85;
  // strength: all key proportions ideal AND zero severity (perfect symmetry + openness + placement)
  const allIdeal = isNormal && severity === 0 && symmetry > 0.95 &&
    fifths.intercanthalToEye > 0.90 && fifths.intercanthalToEye < 1.10;

  return {
    name: 'Eyes',
    status: statusFromConfidence(dynConf(base, qualityFactor), isNormal, severity, allIdeal),
    observations,
    measurements: {
      rightEAR: round(rEAR),
      leftEAR: round(lEAR),
      symmetryIndex: round(symmetry),
      interpupillaryDistance: round(ipd),
      rightWidthRatio: round(rWidthRatio),
      leftWidthRatio: round(lWidthRatio),
      intercanthalToEyeWidth: round(fifths.intercanthalToEye),
      facialWidthToEyeWidth: round(fifths.facialWidthToEye),
      canthalTiltRight: round(rCanthalTilt, 3),
      canthalTiltLeft: round(lCanthalTilt, 3),
      canthalTiltAvg: round(avgCanthalTilt, 3),
    },
    recommendations:
      recommendations.length > 0
        ? recommendations
        : ['Параметры глаз находятся в типичном диапазоне'],
    confidence: dynConf(base, qualityFactor),
    limitations: [
      'Анализ склеры (покраснение, оттенок) требует крупного плана высокого разрешения',
      'Цвет глаз и рисунок радужки не оцениваются',
      'Тип и глубина складки века требуют специализированного измерения',
      'Моргание, прищур и мимика влияют на значения EAR',
    ],
  };
}

// ─── 4. Nose ────────────────────────────────────────────────────────────────

export function analyzeNose(
  lm: Lm,
  qualityFactor = 1,
  hasProfiles = false,
  profileLeftLm?: Lm | null,
  profileRightLm?: Lm | null,
  imageAspectRatio = 1,
  profileImageAspectRatio = imageAspectRatio,
): FeatureAnalysis {
  const widthRatio = M.noseWidthRatio(lm, imageAspectRatio);
  const widthToIntercanthal = M.noseToIntercanthalRatio(lm, imageAspectRatio);
  const lengthRatio = M.noseLengthRatio(lm, imageAspectRatio);
  const symmetry = M.noseSymmetry(lm, imageAspectRatio);

  const isNormal =
    // Bounds aligned with rangeSeverity — P.ts unisex: widthToIntercanthal 0.85–1.15, lengthRatio 0.17–0.29
    widthToIntercanthal > 0.85 &&
    widthToIntercanthal < 1.15 &&
    lengthRatio > 0.17 &&
    lengthRatio < 0.29 &&
    symmetry > 0.85;
  const severity = combineSeverity(
    rangeSeverity(widthToIntercanthal, 0.85, 1.15, 0.35), // Farkas ICD norm — P.ts unisex
    rangeSeverity(widthRatio, 0.5, 0.95, 0.50),           // secondary: IPD ratio as soft signal
    rangeSeverity(lengthRatio, 0.17, 0.29, 0.4),          // P.ts unisex
    lowBoundSeverity(symmetry, 0.85, 0.35),
  );

  const observations: string[] = [];
  const recommendations: string[] = [];

  observations.push(`Соотношение ширины носа (alar/IPD): ${round(widthRatio)}`);
  observations.push(`Соотношение ширины носа к межкантальному расстоянию: ${round(widthToIntercanthal)}`);
  observations.push(`Соотношение длины носа (к высоте лица): ${round(lengthRatio)}`);
  observations.push(`Индекс симметрии носа: ${round(symmetry)}`);

  if (widthRatio < 0.55) {
    observations.push('Нос выглядит относительно узким');
  } else if (widthRatio > 0.72) {
    observations.push('Нос выглядит относительно широким');
  } else {
    observations.push('Ширина носа в типичном пропорциональном диапазоне');
  }

  if (symmetry < 0.85) {
    observations.push('Обнаружена небольшая асимметрия носа');
    recommendations.push(
      'Небольшая асимметрия носа встречается часто; при беспокойстве можно проконсультироваться с ЛОР-врачом по структурным особенностям',
    );
  }

  // ── Profile metrics ──
  const measurements: Record<string, number | string> = {
    alarWidthToIPD: round(widthRatio),
    alarWidthToIntercanthal: round(widthToIntercanthal),
    noseLengthRatio: round(lengthRatio),
    symmetryIndex: round(symmetry),
  };

  const hasProfileLandmarks = !!(profileLeftLm || profileRightLm);

  if (hasProfileLandmarks) {
    const projValues: number[] = [];
    if (profileLeftLm) pushIfFinite(projValues, M.noseProjectionRatio(profileLeftLm, profileImageAspectRatio));
    if (profileRightLm) pushIfFinite(projValues, M.noseProjectionRatio(profileRightLm, profileImageAspectRatio));
    const avgProj = avgOrNull(projValues);
    if (avgProj !== null) {
      measurements.noseProjectionRatio = round(avgProj);
      observations.push(`Проекция носа (профиль): ${round(avgProj)}`);
    }

    const nfValues: number[] = [];
    if (profileLeftLm) pushIfFinite(nfValues, M.nasofrontalDepthProxy(profileLeftLm, profileImageAspectRatio));
    if (profileRightLm) pushIfFinite(nfValues, M.nasofrontalDepthProxy(profileRightLm, profileImageAspectRatio));
    const avgNf = avgOrNull(nfValues);
    if (avgNf !== null) {
      const nfRounded = round(avgNf, 1);
      if (isFiniteNumber(nfRounded)) {
        measurements.nasofrontalAngle = nfRounded;
        observations.push(`Носолобный угол (профиль): ${nfRounded}°`);
      }
    }

    const nlValues: number[] = [];
    if (profileLeftLm) pushIfFinite(nlValues, M.nasolabialAngleProxy(profileLeftLm, profileImageAspectRatio));
    if (profileRightLm) pushIfFinite(nlValues, M.nasolabialAngleProxy(profileRightLm, profileImageAspectRatio));
    const avgNl = avgOrNull(nlValues);
    if (avgNl !== null) {
      const nlRounded = round(avgNl, 1);
      if (isFiniteNumber(nlRounded)) {
        measurements.nasolabialAngle = nlRounded;
        observations.push(`Носогубный угол (профиль): ${nlRounded}°`);
      }
    }

    // Soft-tissue profile metrics
    const stMetrics = extractAndFuseSoftTissue(profileLeftLm, profileRightLm, profileImageAspectRatio);
    if (stMetrics) {
      measurements.softTissue_nPrnRatio = round(stMetrics.nPrnRatio, 4);
      measurements.softTissue_noseProtrusion = round(stMetrics.noseProtrusion, 4);
      measurements.softTissue_nasofrontalAngle = round(stMetrics.nasofrontalAngle, 1);
      measurements.softTissue_nasolabialAngle = round(stMetrics.nasolabialAngle, 1);
      measurements.softTissue_cmSnRatio = round(stMetrics.cmSnRatio, 4);
      measurements.softTissue_confidence = round(stMetrics.confidence, 3);
      // If one profile produced NaN for proxy NFA/NLA, keep bars visible via fused soft-tissue values.
      if (!isFiniteNumber(measurements.nasofrontalAngle) && isFiniteNumber(stMetrics.nasofrontalAngle)
          && stMetrics.nasofrontalAngle >= 95 && stMetrics.nasofrontalAngle <= 170) {
        measurements.nasofrontalAngle = round(stMetrics.nasofrontalAngle, 1);
      }
      if (!isFiniteNumber(measurements.nasolabialAngle) && isFiniteNumber(stMetrics.nasolabialAngle)) {
        measurements.nasolabialAngle = round(stMetrics.nasolabialAngle, 1);
      }
      observations.push(`Мягкотканевый анализ: проекция носа n→prn/n→pg = ${round(stMetrics.nPrnRatio, 3)}, протрузия = ${round(stMetrics.noseProtrusion, 3)}`);
    }
  }

  const base = hasProfileLandmarks ? 0.85 : (hasProfiles ? 0.85 : 0.80);
  if (hasProfiles) {
    observations.push('Профильные снимки предоставлены для комплексного анализа носа');
  }

  const limitations: string[] = [
    'Перспективные искажения объектива влияют на измерения носа',
  ];
  if (!hasProfiles && !hasProfileLandmarks) {
    limitations.unshift(
      'Высоту спинки и профиль носа нельзя оценить по фронтальному ракурсу',
      'Носолобный и носогубный углы требуют бокового ракурса',
      'Оценка формы ноздрей и отклонения перегородки ограничена в 2D',
    );
  } else {
    limitations.push('Точные угловые измерения профиля требуют цефалометрического анализа');
  }

  // strength: ICD norm ideal + good symmetry + zero severity
  const allIdealNose = isNormal && severity === 0 &&
    widthToIntercanthal > 0.90 && widthToIntercanthal < 1.10 && symmetry > 0.92;

  return {
    name: 'Nose',
    status: statusFromConfidence(dynConf(base, qualityFactor), isNormal, severity, allIdealNose),
    observations,
    measurements,
    recommendations:
      recommendations.length > 0
        ? recommendations
        : ['Пропорции носа в типичном диапазоне для фронтальной оценки'],
    confidence: dynConf(base, qualityFactor),
    limitations,
  };
}

// ─── 5. Cheeks ──────────────────────────────────────────────────────────────

export function analyzeCheeks(
  lm: Lm,
  skinMetrics?: M.SkinMetrics,
  qualityFactor = 1,
  hasProfiles = false,
  profileLeftLm?: Lm | null,
  profileRightLm?: Lm | null,
  imageAspectRatio = 1,
  profileImageAspectRatio = imageAspectRatio,
): FeatureAnalysis {
  const hwRatio = M.faceHeightWidthRatio(lm, imageAspectRatio);
  const fifths = M.facialFifthsProxy(lm, imageAspectRatio);

  const observations: string[] = [];
  const recommendations: string[] = [];

  observations.push(`Соотношение высоты и ширины лица: ${round(hwRatio)}`);
  observations.push(`Бикулярная ширина к ширине лица: ${round(fifths.biocularToFaceWidth)}`);

  if (hwRatio < 1.05) {
    observations.push('Форма лица ближе к круглой/широкой — щеки могут выглядеть более объёмными');
  } else if (hwRatio < 1.28) {
    observations.push('Форма лица ближе к квадратной/средней — ниже типичного овального диапазона');
  } else if (hwRatio <= 1.48) {
    observations.push('Пропорции лица в типичном овальном диапазоне');
  } else {
    observations.push('Форма лица ближе к вытянутой/удлинённой — щеки могут выглядеть более узкими');
  }

  if (skinMetrics) {
    observations.push(`Однородность кожи щек: ${round(skinMetrics.colorUniformity)}`);
    // Threshold 0.08 (raised from 0.05): the R/(R+G+B)-0.333 formula fires on normal
    // warm skin tones and camera white-balance at lower values; 0.08 corresponds to
    // perceptible erythema excess relative to neutral grey (Fullerton 1996).
    if (skinMetrics.rednessIndex > 0.08) {
      observations.push('Повышенный цветовой индекс красноты в зоне щек (возможны освещение или покраснение)');
      recommendations.push(
        'При стойком покраснении щек рекомендуется консультация дерматолога — это может указывать на розацеа или чувствительность кожи',
      );
    }
  }

  // ── Profile metrics ──
  const measurements: Record<string, number | string> = {
    faceHeightWidthRatio: round(hwRatio),
    biocularToFaceWidth: round(fifths.biocularToFaceWidth),
    ...(skinMetrics
      ? {
          skinUniformity: round(skinMetrics.colorUniformity),
          rednessIndex: round(skinMetrics.rednessIndex),
        }
      : {}),
  };

  const hasProfileLandmarks = !!(profileLeftLm || profileRightLm);

  if (hasProfileLandmarks) {
    const malarValues: number[] = [];
    if (profileLeftLm) pushIfFinite(malarValues, M.malarProjectionProxy(profileLeftLm, 'left', profileImageAspectRatio));
    if (profileRightLm) pushIfFinite(malarValues, M.malarProjectionProxy(profileRightLm, 'right', profileImageAspectRatio));
    const avgMalar = avgOrNull(malarValues);
    if (avgMalar !== null) {
      measurements.malarProjectionProxy = round(avgMalar);
      observations.push(`Проекция скул (профиль): ${round(avgMalar)}`);
    }
  }

  const base = hasProfileLandmarks ? 0.68 : (hasProfiles ? 0.65 : 0.55);
  if (hasProfiles) {
    observations.push('Профильные снимки предоставлены для оценки скуловой проекции');
  }

  const limitations: string[] = [
    'Распределение подкожной жировой ткани не измеряется',
    'Освещение сильно влияет на восприятие полноты щек',
    'Цветовые показатели (однородность, покраснение) зависят от освещения и баланса белого камеры — не являются диагностическими',
  ];
  if (!hasProfiles && !hasProfileLandmarks) {
    limitations.unshift(
      'Объем и проекция щек не измеряются по 2D-изображению',
      'Оценка скуловой проекции требует 3D или бокового ракурса',
    );
  }

  // rednessIndex > 0.08 consistent with observation threshold above
  const rednessConcern = !!skinMetrics && skinMetrics.rednessIndex > 0.08;
  // isBalanced uses unisex range from CHEEKS_STANDARDS (min: 1.28, max: 1.48)
  const isBalanced = hwRatio >= 1.28 && hwRatio <= 1.48 && !rednessConcern;
  const rednessSeverity = skinMetrics ? rangeSeverity(skinMetrics.rednessIndex, 0.0, 0.08, 0.8) : 0;
  const severity = combineSeverity(
    // Use unisex bounds from CHEEKS_STANDARDS.faceHeightWidthRatio
    rangeSeverity(hwRatio, 1.28, 1.48, 0.45),
    rednessSeverity,
  );

  return {
    name: 'Cheeks',
    status: statusFromConfidence(dynConf(base, qualityFactor), isBalanced, severity),
    observations,
    measurements,
    recommendations:
      recommendations.length > 0
        ? recommendations
        : hasProfiles
          ? ['Оценка щек выполнена по фронтальному и профильному ракурсам']
          : ['Оценка щек по одному фронтальному изображению ограничена'],
    confidence: dynConf(base, qualityFactor),
    limitations,
  };
}

// ─── 6. Jaw ─────────────────────────────────────────────────────────────────

export function analyzeJaw(
  lm: Lm,
  qualityFactor = 1,
  hasProfiles = false,
  profileLeftLm?: Lm | null,
  profileRightLm?: Lm | null,
  imageAspectRatio = 1,
  profileImageAspectRatio = imageAspectRatio,
): FeatureAnalysis {
  const widthRatio = M.jawWidthRatio(lm, imageAspectRatio);
  const vShape = M.vShapeProxy(lm, imageAspectRatio);
  const symmetry = M.jawSymmetry(lm, imageAspectRatio);
  const hwRatio = M.faceHeightWidthRatio(lm, imageAspectRatio);

  // All bounds aligned with P.ts unisex: vShape 0.72–0.90, hwRatio 1.28–1.48
  const isNormal = symmetry > 0.85 && vShape > 0.72 && vShape < 0.90 && hwRatio > 1.28 && hwRatio < 1.48;
  const severity = combineSeverity(
    lowBoundSeverity(symmetry, 0.85, 0.35),
    rangeSeverity(vShape, 0.72, 0.90, 0.45),
    rangeSeverity(hwRatio, 1.28, 1.48, 0.45),
  );

  const observations: string[] = [];
  const recommendations: string[] = [];

  observations.push(`Соотношение ширины челюсти (к ширине лица): ${round(widthRatio)}`);
  observations.push(`Прокси V-формы (челюсть/лоб): ${round(vShape)}`);
  observations.push(`Симметрия челюсти: ${round(symmetry)}`);

  if (vShape < 0.72) {
    observations.push('Лицо заметно сужается к подбородку (тенденция к V-форме)');
  } else if (vShape > 0.90) {
    observations.push('Челюсть выглядит шире лба (тенденция к квадратной/прямоугольной форме)');
  } else {
    observations.push('Соотношение челюсти и лба в сбалансированном диапазоне');
  }

  if (symmetry < 0.85) {
    observations.push('Обнаружена небольшая асимметрия челюсти');
    recommendations.push(
      'Асимметрия челюсти встречается часто; при выраженности можно обратиться к челюстно-лицевому специалисту',
    );
  }

  // ── Profile metrics ──
  const measurements: Record<string, number | string> = {
    jawWidthRatio: round(widthRatio),
    vShapeProxy: round(vShape),
    symmetryIndex: round(symmetry),
    faceHeightWidthRatio: round(hwRatio),
  };

  const hasProfileLandmarks = !!(profileLeftLm || profileRightLm);

  if (hasProfileLandmarks) {
    const gonialValues: number[] = [];
    if (profileLeftLm) pushIfFinite(gonialValues, M.jawProfileAngleProxy(profileLeftLm, 'left', profileImageAspectRatio));
    if (profileRightLm) pushIfFinite(gonialValues, M.jawProfileAngleProxy(profileRightLm, 'right', profileImageAspectRatio));
    const avgGonial = avgOrNull(gonialValues);
    if (avgGonial !== null) {
      measurements.gonialAngleProxy = round(avgGonial, 1);
      observations.push(`Гониальный угол (профиль): ${round(avgGonial, 1)}°`);
    }
  }

  const base = hasProfileLandmarks ? 0.78 : (hasProfiles ? 0.78 : 0.7);
  if (hasProfiles) {
    observations.push('Профильные снимки предоставлены для оценки контура челюсти');
  }

  const limitations: string[] = [
    'Оценка жевательных мышц невозможна по 2D-изображению',
    'Нельзя надежно разделить вклад мягких тканей и костной формы челюсти',
  ];
  if (!hasProfiles && !hasProfileLandmarks) {
    limitations.unshift(
      'Угол челюсти и гониальный угол требуют бокового/косого ракурса',
      'Анализ контура нижней челюсти ограничен без 3D-данных',
    );
  }

  return {
    name: 'Jaw',
    status: statusFromConfidence(dynConf(base, qualityFactor), isNormal, severity),
    observations,
    measurements,
    recommendations:
      recommendations.length > 0
        ? recommendations
        : ['Пропорции челюсти выглядят сбалансированными во фронтальном ракурсе'],
    confidence: dynConf(base, qualityFactor),
    limitations,
  };
}

// ─── 7. Lips ────────────────────────────────────────────────────────────────

export function analyzeLips(
  lm: Lm,
  qualityFactor = 1,
  hasProfiles = false,
  profileLeftLm?: Lm | null,
  profileRightLm?: Lm | null,
  imageAspectRatio = 1,
  profileImageAspectRatio = imageAspectRatio,
): FeatureAnalysis {
  const ratio = M.lipRatio(lm, imageAspectRatio);
  const mouthWidth = M.mouthWidthRatio(lm, imageAspectRatio);
  const mouthToNose = M.mouthToNoseWidthRatio(lm, imageAspectRatio);
  const tilt = M.mouthCornerTilt(lm, imageAspectRatio);
  const symmetry = M.lipSymmetry(lm, imageAspectRatio);

  // isNormal bounds aligned with rangeSeverity — P.ts unisex: mouthToNose 1.28–1.62, tilt -2.0–4.0
  const isNormal = ratio > 0.64 && ratio < 1.08 && mouthToNose > 1.28 && mouthToNose < 1.62 && symmetry > 0.85 && tilt > -2.0 && tilt < 4.0;
  const severity = combineSeverity(
    rangeSeverity(ratio, 0.64, 1.08, 0.45),
    rangeSeverity(mouthToNose, 1.28, 1.62, 0.45),
    lowBoundSeverity(symmetry, 0.85, 0.35),
    rangeSeverity(tilt, -2.0, 4.0, 0.55),
  );

  const observations: string[] = [];
  const recommendations: string[] = [];

  observations.push(`Соотношение верхней/нижней губы: ${round(ratio)}`);
  observations.push(`Ширина рта (к IPD): ${round(mouthWidth)}`);
  observations.push(`Ширина рта к ширине носа: ${round(mouthToNose)}`);
  observations.push(`Наклон линии рта: ${round(tilt, 1)}°`);
  observations.push(`Симметрия губ: ${round(symmetry)}`);

  if (ratio < 0.64) {
    observations.push('Верхняя губа выглядит тоньше относительно нижней');
  } else if (ratio > 1.08) {
    observations.push('Верхняя губа выглядит более выраженной относительно нижней');
  } else {
    observations.push('Пропорции губ в распространенном диапазоне');
  }

  if (tilt < -2.0) {
    observations.push('Уголки рта слегка направлены вниз — это может зависеть от мимики');
  } else if (tilt > 4.0) {
    observations.push('Уголки рта слегка направлены вверх');
  }

  // ── Profile metrics ──
  const measurements: Record<string, number | string> = {
    upperLowerRatio: round(ratio),
    mouthWidthToIPD: round(mouthWidth),
    mouthToNoseWidthRatio: round(mouthToNose),
    cornerTilt: round(tilt, 1),
    symmetryIndex: round(symmetry),
  };

  const hasProfileLandmarks = !!(profileLeftLm || profileRightLm);

  if (hasProfileLandmarks) {
    const projValues: number[] = [];
    if (profileLeftLm) pushIfFinite(projValues, M.lipProjectionRatio(profileLeftLm, profileImageAspectRatio, 'left'));
    if (profileRightLm) pushIfFinite(projValues, M.lipProjectionRatio(profileRightLm, profileImageAspectRatio, 'right'));
    const avgProj = avgOrNull(projValues);
    if (avgProj !== null) {
      measurements.lipProjectionRatio = round(avgProj);
      observations.push(`Проекция губ (профиль): ${round(avgProj)}`);
    }

    // Soft-tissue profile metrics
    const stMetrics = extractAndFuseSoftTissue(profileLeftLm, profileRightLm, profileImageAspectRatio);
    if (stMetrics) {
      measurements.softTissue_snLsRatio = round(stMetrics.snLsRatio, 4);
      measurements.softTissue_lipProtrusion = round(stMetrics.lipProtrusion, 4);
      measurements.softTissue_confidence = round(stMetrics.confidence, 3);
      observations.push(`Мягкотканевый анализ: sn→ls/n→pg = ${round(stMetrics.snLsRatio, 3)}, протрузия губ = ${round(stMetrics.lipProtrusion, 3)}`);
    }
  }

  const base = hasProfileLandmarks ? 0.80 : (hasProfiles ? 0.78 : 0.75);

  return {
    name: 'Lips',
    status: statusFromConfidence(dynConf(base, qualityFactor), isNormal, severity),
    observations,
    measurements,
    recommendations:
      recommendations.length > 0
        ? recommendations
        : ['Пропорции губ оценены в типичном диапазоне для фронтального кадра'],
    confidence: dynConf(base, qualityFactor),
    limitations: [
      'Объем губ нельзя оценить только по 2D-ключевым точкам',
      'Для оценки цвета и текстуры губ нужен крупный план',
      'Мимика (улыбка, напряжение) существенно влияет на измерения губ',
      'Контур «лука Купидона» и четкость каймы губ требуют высокого разрешения',
    ],
  };
}

// ─── 8. Chin ────────────────────────────────────────────────────────────────

export function analyzeChin(
  lm: Lm,
  qualityFactor = 1,
  hasProfiles = false,
  profileLeftLm?: Lm | null,
  profileRightLm?: Lm | null,
  imageAspectRatio = 1,
  profileImageAspectRatio = imageAspectRatio,
): FeatureAnalysis {
  const chinHeight = M.chinHeightRatio(lm, imageAspectRatio);
  const thirds = M.faceThirds(lm, imageAspectRatio);
  const lowerFace = M.lowerFaceRatio(lm, imageAspectRatio);

  // Bounds aligned with P.ts unisex: chinHeight 0.14–0.21, lowerFace 0.40–0.62 (Farkas 1994)
  const isNormal = chinHeight > 0.14 && chinHeight < 0.21 && lowerFace > 0.40 && lowerFace < 0.62;
  const severity = combineSeverity(
    rangeSeverity(chinHeight, 0.14, 0.21, 0.4),
    rangeSeverity(lowerFace, 0.40, 0.62, 0.45),
    rangeSeverity(Math.abs(thirds.upper - thirds.middle), 0, 0.08, 0.6),
    rangeSeverity(Math.abs(thirds.middle - thirds.lower), 0, 0.1, 0.6),
  );

  const observations: string[] = [];
  const recommendations: string[] = [];

  observations.push(`Соотношение высоты подбородка (к лицу): ${round(chinHeight)}`);
  observations.push(`Соотношение subnasale→stomion к stomion→menton: ${round(lowerFace)}`);
  observations.push(
    `Фронтальные сегменты лица (приближенно): верхний ${round(thirds.upper)}, средний ${round(thirds.middle)}, нижний ${round(thirds.lower)}`,
  );

  // Ideal face thirds are roughly equal (~0.33 each)
  const thirdDeviation =
    Math.abs(thirds.upper - 0.33) + Math.abs(thirds.middle - 0.33) + Math.abs(thirds.lower - 0.33);

  if (thirdDeviation < 0.1) {
    observations.push('Трети лица хорошо сбалансированы');
  } else {
    observations.push('Есть дисбаланс в пропорциях третей лица');
    if (thirds.lower > 0.37) {
      observations.push('Нижняя треть выглядит относительно длинной');
    } else if (thirds.lower < 0.28) {
      observations.push('Нижняя треть выглядит относительно короткой');
    }
  }

  // ── Profile metrics ──
  const measurements: Record<string, number | string> = {
    chinHeightRatio: round(chinHeight),
    faceThirdUpper: round(thirds.upper),
    faceThirdMiddle: round(thirds.middle),
    faceThirdLower: round(thirds.lower),
    lowerFaceRatio: round(lowerFace),
  };

  const hasProfileLandmarks = !!(profileLeftLm || profileRightLm);

  if (hasProfileLandmarks) {
    const projValues: number[] = [];
    if (profileLeftLm) pushIfFinite(projValues, M.chinProjectionRatio(profileLeftLm, profileImageAspectRatio, 'left'));
    if (profileRightLm) pushIfFinite(projValues, M.chinProjectionRatio(profileRightLm, profileImageAspectRatio, 'right'));
    const avgProj = avgOrNull(projValues);
    if (avgProj !== null) {
      measurements.chinProjectionRatio = round(avgProj);
      observations.push(`Проекция подбородка (профиль): ${round(avgProj)}`);
    }

    // Soft-tissue profile metrics
    const stMetrics = extractAndFuseSoftTissue(profileLeftLm, profileRightLm, profileImageAspectRatio);
    if (stMetrics) {
      measurements.softTissue_lsPgRatio = round(stMetrics.lsPgRatio, 4);
      measurements.softTissue_gNRatio = round(stMetrics.gNRatio, 4);
      measurements.softTissue_nPgDistance = round(stMetrics.nPgDistance, 4);
      measurements.softTissue_confidence = round(stMetrics.confidence, 3);
      observations.push(`Мягкотканевый анализ: ls→pg/n→pg = ${round(stMetrics.lsPgRatio, 3)}, g→n/n→pg = ${round(stMetrics.gNRatio, 3)}`);
    }
  }

  const base = hasProfileLandmarks ? 0.72 : (hasProfiles ? 0.72 : 0.6);
  if (hasProfiles) {
    observations.push('Профильные снимки предоставлены — доступна дополнительная информация о проекции подбородка');
  }

  const limitations: string[] = [
    'Толщину мягких тканей подбородка нельзя измерить по 2D-изображению',
  ];
  if (!hasProfiles && !hasProfileLandmarks) {
    limitations.unshift(
      'Проекцию подбородка нельзя оценить по фронтальному ракурсу',
      'Ментолабиальный угол требует бокового цефалометрического анализа',
      'Положение pogonion и menton требует 3D или боковой визуализации',
    );
  }

  return {
    name: 'Chin',
    status: statusFromConfidence(dynConf(base, qualityFactor), isNormal, severity),
    observations,
    measurements,
    recommendations:
      recommendations.length > 0
        ? recommendations
        : hasProfiles
          ? ['Пропорции подбородка оценены по фронтальному и профильному ракурсам']
          : ['Пропорции подбородка оценены только по фронтальному ракурсу — для полной оценки желателен профильный снимок'],
    confidence: dynConf(base, qualityFactor),
    limitations,
  };
}

// ─── 9. Skin ────────────────────────────────────────────────────────────────

export function analyzeSkin(
  lm: Lm,
  imageData: ImageData | null,
  imageWidth: number,
  imageHeight: number,
  qualityFactor = 1,
  hasProfiles = false,
): FeatureAnalysis {
  const observations: string[] = [];
  const recommendations: string[] = [];
  const measurements: Record<string, number | string> = {};
  let isNormal = true;
  let severity = 0;

  const baseWithData = hasProfiles ? 0.68 : 0.58;
  let confidence = dynConf(0.45, qualityFactor);

  if (imageData) {
    // Analyze cheek regions as representative skin areas
    const cheekIndices = [CHEEKS.rightCenter, CHEEKS.leftCenter, CHEEKS.rightOuter, CHEEKS.leftOuter];
    const skinData = M.analyzeSkinRegion(imageData, lm, cheekIndices, imageWidth, imageHeight, 8);

    measurements.avgBrightness = round(skinData.avgBrightness, 0);
    measurements.textureVariance = round(skinData.brightnessVariance, 1);
    measurements.rednessIndex = round(skinData.rednessIndex);
    measurements.colorUniformity = round(skinData.colorUniformity);

    confidence = dynConf(baseWithData, qualityFactor);

    if (hasProfiles) {
      observations.push('Анализ кожи выполнен по нескольким ракурсам для повышенной точности');
    }
    observations.push(`Яркость кожи (область щек): ${round(skinData.avgBrightness, 0)}/255`);
    observations.push(`Однородность цвета: ${round(skinData.colorUniformity)}`);

    if (skinData.brightnessVariance > 500) {
      observations.push('Обнаружена повышенная вариативность текстуры — возможны выраженные поры или неровности');
      isNormal = false;
      recommendations.push(
        'При вопросах по текстуре кожи стоит обратиться к дерматологу для профессиональной оценки',
      );
      severity = Math.max(severity, rangeSeverity(skinData.brightnessVariance, 0, 500, 0.8));
    } else {
      observations.push('Вариативность текстуры в умеренном диапазоне');
    }

    // Aligned with analyzeCheeks threshold (0.08) — Fullerton 1996 perceptible erythema threshold
    if (skinData.rednessIndex > 0.08) {
      observations.push('В выбранных зонах обнаружен повышенный цветовой индекс красноты (возможны освещение или покраснение)');
      isNormal = false;
      recommendations.push(
        'При стойком покраснении лица полезна консультация дерматолога для исключения розацеа или повышенной чувствительности',
      );
      severity = Math.max(severity, rangeSeverity(skinData.rednessIndex, 0.0, 0.08, 0.8));
    } else if (skinData.rednessIndex > 0.04) {
      observations.push('В выбранных зонах есть лёгкий цветовой сдвиг в красный — возможно освещение или слабое покраснение');
    } else {
      observations.push('Уровень покраснения в выбранных зонах низкий');
    }

    if (skinData.colorUniformity < 0.7) {
      observations.push('Обнаружена неоднородность цвета — возможен неравномерный тон или вариации пигментации');
      isNormal = false;
      recommendations.push(
        'Если беспокоит неравномерный тон, дерматолог может подобрать целевой уход',
      );
      severity = Math.max(severity, lowBoundSeverity(skinData.colorUniformity, 0.7, 0.6));
    }
  } else {
    observations.push('Пиксельный анализ кожи не выполнен — данные изображения недоступны');
  }

  return {
    name: 'Skin',
    status: statusFromConfidence(confidence, isNormal, severity),
    observations,
    measurements,
    recommendations:
      recommendations.length > 0
        ? recommendations
        : ['Анализ кожи со стандартной веб-камеры имеет существенные ограничения — при вопросах рекомендована профессиональная консультация дерматолога'],
    confidence,
    limitations: [
      'Разрешение веб-камеры/камеры телефона ограничивает выявление мелких деталей кожи',
      'Условия освещения сильно влияют на восприятие цвета и текстуры кожи',
      'Анализ кожи основан на базовых эвристиках цвета/текстуры, а не на клинической дерматологии',
      'Состояния вроде акне, мелазмы и другие дерматологические вопросы требуют очной оценки специалиста',
      'Баланс белого и цветовой профиль камеры искажают реальные оттенки кожи',
    ],
  };
}

// ─── 10. Neck ───────────────────────────────────────────────────────────────

export function analyzeNeck(
  _lm: Lm,
  hasProfiles = false,
  qualityFactor = 1,
  profileLeftLm?: Lm | null,
  profileRightLm?: Lm | null,
  imageAspectRatio = 1,
): FeatureAnalysis {
  const profileAngles: number[] = [];
  if (profileLeftLm) pushIfFinite(profileAngles, M.lowerFaceProfileAngle(profileLeftLm, 'left', imageAspectRatio));
  if (profileRightLm) pushIfFinite(profileAngles, M.lowerFaceProfileAngle(profileRightLm, 'right', imageAspectRatio));

  if (hasProfiles && profileAngles.length > 0) {
    const avgAngle = profileAngles.reduce((a, b) => a + b, 0) / profileAngles.length;
    const severity = rangeSeverity(avgAngle, 115, 136, 0.55);
    const isNormal = severity < 0.35;
    const confidence = dynConf(0.62, qualityFactor);

    const observations = [
      'Профильные ракурсы использованы для прокси-оценки шейно-подбородочного контура',
      `Прокси-угол по линии нижней части лица: ${round(avgAngle, 1)}°`,
    ];
    const recommendations: string[] = [];
    if (!isNormal) {
      observations.push('Контур шейно-подбородочной зоны может отличаться от нейтрального диапазона');
      recommendations.push(
        'Для точной оценки шейно-подбородочной зоны рекомендуются стандартизированные профильные фото и очная консультация специалиста',
      );
    }

    return {
      name: 'Neck',
      status: statusFromConfidence(confidence, isNormal, severity),
      observations,
      measurements: {
        submentalContourProxyAngle: round(avgAngle, 1),
      },
      recommendations:
        recommendations.length > 0
          ? recommendations
          : ['Профильные ракурсы улучшили оценку шейно-подбородочного контура'],
      confidence,
      limitations: [
        'MediaPipe Face Mesh не включает отдельные ключевые точки шеи ниже линии челюсти',
        'Показатель является 2D-прокси и не заменяет клиническую оценку мягких тканей шеи',
      ],
    };
  }

  return {
    name: 'Neck',
    status: 'insufficient_data',
    observations: [
      'Анализ шеи ограничен: в текущих данных нет надежных профильных ориентиров',
      'Face mesh покрывает в основном область лица и челюсти, но не всю шею',
    ],
    measurements: {},
    recommendations: [
      'Для оценки шеи нужен профильный ракурс с захватом подчелюстной зоны и передней поверхности шеи',
      'При вопросах по коже шеи или осанке стоит обратиться к дерматологу или физиотерапевту соответственно',
    ],
    confidence: dynConf(0.45, qualityFactor),
    limitations: [
      'MediaPipe Face Mesh не включает ключевые точки шеи',
      'Качество кожи шеи, шейно-подбородочный угол и длина шеи требуют отдельной съемки',
      'Оценка осанки требует кадра в полный рост или минимум верхней части тела',
      'Фронтальная камера обычно не захватывает достаточно области шеи',
    ],
  };
}

// ─── 11. Ears ───────────────────────────────────────────────────────────────

export function analyzeEars(_lm: Lm, hasProfiles = false, qualityFactor = 1): FeatureAnalysis {
  if (hasProfiles) {
    const confidence = dynConf(0.58, qualityFactor);
    return {
      name: 'Ears',
      status: statusFromConfidence(confidence, true, 0.25),
      observations: [
        'Профильные снимки предоставлены — доступна визуальная информация о форме и расположении ушей',
        'Ключевые точки ушей не входят в модель face mesh, но профильные снимки дают контекст',
      ],
      measurements: {},
      recommendations: [
        'По профильным снимкам можно визуально оценить пропорции ушей',
        'По косметическим вопросам ушей корректную оценку даст ЛОР-врач',
      ],
      confidence,
      limitations: [
        'Face mesh не отслеживает ключевые точки ушей',
        'Автоматические измерения ушей не выполняются — только визуальный контекст из профильных снимков',
        'Волосы могут частично или полностью закрывать уши',
      ],
    };
  }

  return {
    name: 'Ears',
    status: 'insufficient_data',
    observations: [
      'Анализ ушей сильно ограничен во фронтальном face mesh',
      'Ключевые точки ушей не входят в стандартную модель face mesh',
      'По контуру лица можно лишь приблизительно оценить область козелка',
    ],
    measurements: {},
    recommendations: [
      'Оценка ушей (форма, степень выступания, тип мочки) требует боковых ракурсов',
      'По косметическим вопросам ушей корректную оценку даст ЛОР-врач или пластический хирург',
    ],
    confidence: dynConf(0.45, qualityFactor),
    limitations: [
      'Face mesh не отслеживает ключевые точки ушей',
      'Фронтальный ракурс обычно скрывает большую часть структуры уха',
      'Для оценки выступания, формы и размера ушей нужен профильный ракурс',
      'Волосы могут частично или полностью закрывать уши',
    ],
  };
}
