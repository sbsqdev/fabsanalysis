/**
 * Report generation — orchestrates all 11 feature analyses into a full report.
 */

import type { AnalysisReport, NormalizedLandmark } from '../types';
import { getDisclaimerText } from '../types';
import { getCurrentLang } from '../lib/language';
import * as F from './features';
import * as M from './metrics';
import { CHEEKS } from './landmarks';

export interface ProfileData {
  imageData: ImageData;
  landmarks: NormalizedLandmark[] | null;
  width: number;
  height: number;
}

export interface AnalysisInput {
  landmarks: NormalizedLandmark[];
  imageData: ImageData | null;
  imageWidth: number;
  imageHeight: number;
  inputType: 'photo' | 'camera';
  faceConfidence: number;
  bbox: { x: number; y: number; width: number; height: number };
  startTime: number;
  profileLeft?: ProfileData;
  profileRight?: ProfileData;
}

export function generateReport(input: AnalysisInput): AnalysisReport {
  const { landmarks, imageData, imageWidth, imageHeight, inputType, faceConfidence, bbox, startTime, profileLeft, profileRight } = input;

  const hasProfiles = !!(profileLeft?.landmarks || profileRight?.landmarks);

  // Assess lighting
  const lighting = imageData
    ? M.assessLighting(imageData, imageWidth, imageHeight)
    : 'moderate';

  // Quality score heuristic
  const poseRollDeg = Math.abs(M.headRollDegrees(landmarks));
  const faceFrameCoverage = bbox.width * bbox.height;
  const qualityScore = calculateQualityScore(
    faceConfidence,
    lighting,
    imageWidth,
    imageHeight,
    faceFrameCoverage,
    poseRollDeg,
  );
  const qualityFactor = Math.max(0.15, Math.min(1, qualityScore)); // floor lowered: poor photos can now trigger insufficient_data

  // Compute cheek skin metrics for reuse
  let cheekSkinMetrics: M.SkinMetrics | undefined;
  if (imageData) {
    const cheekIndices = [CHEEKS.rightCenter, CHEEKS.leftCenter, CHEEKS.rightOuter, CHEEKS.leftOuter];
    cheekSkinMetrics = M.analyzeSkinRegion(imageData, landmarks, cheekIndices, imageWidth, imageHeight, 8);
  }

  // Aspect ratios: front camera and per-profile cameras (usually same device, but be precise)
  const frontAspect = imageHeight > 0 ? imageWidth / imageHeight : 1;
  const pLeftAspect = (profileLeft && profileLeft.height > 0) ? profileLeft.width / profileLeft.height : null;
  const pRightAspect = (profileRight && profileRight.height > 0) ? profileRight.width / profileRight.height : null;
  // Profile analyzers currently accept one shared aspect value.
  // If both profile captures exist, blend them to avoid side bias.
  const profileAspects = [pLeftAspect, pRightAspect].filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  const profileAspect = profileAspects.length > 0
    ? profileAspects.reduce((s, v) => s + v, 0) / profileAspects.length
    : frontAspect;

  // Run all 10 analyses — pass profile landmarks to all eligible analyzers
  const pLeftLm = profileLeft?.landmarks ?? null;
  const pRightLm = profileRight?.landmarks ?? null;

  const features = [
    F.analyzeEyebrows(landmarks, qualityFactor, hasProfiles, frontAspect),
    F.analyzeEyes(landmarks, qualityFactor, hasProfiles, frontAspect),
    F.analyzeNose(landmarks, qualityFactor, hasProfiles, pLeftLm, pRightLm, frontAspect, profileAspect),
    F.analyzeCheeks(landmarks, cheekSkinMetrics, qualityFactor, hasProfiles, pLeftLm, pRightLm, frontAspect, profileAspect),
    F.analyzeJaw(landmarks, qualityFactor, hasProfiles, pLeftLm, pRightLm, frontAspect, profileAspect),
    F.analyzeLips(landmarks, qualityFactor, hasProfiles, pLeftLm, pRightLm, frontAspect, profileAspect),
    F.analyzeChin(landmarks, qualityFactor, hasProfiles, pLeftLm, pRightLm, frontAspect, profileAspect),
    F.analyzeSkin(landmarks, imageData, imageWidth, imageHeight, qualityFactor, hasProfiles),
    F.analyzeNeck(landmarks, hasProfiles, qualityFactor, pLeftLm, pRightLm, profileAspect),
    F.analyzeEars(landmarks, hasProfiles, qualityFactor),
  ];

  const processingTime = Date.now() - startTime;

  return {
    meta: {
      date: new Date().toISOString(),
      version: '1.0.0-mvp',
      modelSource: 'MediaPipe Face Landmarker (float16)',
      device: detectDevice(),
      processingTime,
    },
    inputs: {
      type: inputType,
      resolution: { width: imageWidth, height: imageHeight },
      qualityScore,
      lightingHeuristic: lighting,
      faceFrameCoverage,
      poseRollDeg,
    },
    faceDetection: {
      bbox,
      confidence: faceConfidence,
    },
    landmarks: {
      count: landmarks.length,
      model: 'MediaPipe Face Mesh 478-point',
    },
    features,
    disclaimer: getDisclaimerText(getCurrentLang()),
  };
}

function calculateQualityScore(
  faceConf: number,
  lighting: 'good' | 'moderate' | 'poor',
  w: number,
  h: number,
  faceFrameCoverage: number,
  poseRollDeg: number,
): number {
  let score = faceConf * 0.3;

  // Lighting factor
  if (lighting === 'good') score += 0.2;
  else if (lighting === 'moderate') score += 0.12;
  else score += 0.04;

  // Resolution factor
  const minDim = Math.min(w, h);
  if (minDim >= 720) score += 0.2;
  else if (minDim >= 480) score += 0.14;
  else score += 0.08;

  // Face occupies enough of the frame to keep ratios stable.
  if (faceFrameCoverage >= 0.24) score += 0.2;
  else if (faceFrameCoverage >= 0.16) score += 0.14;
  else if (faceFrameCoverage >= 0.1) score += 0.08;
  else score += 0.03;

  // Large head roll reduces reliability of vertical/horizontal proportions.
  if (poseRollDeg <= 7) score += 0.1;
  else if (poseRollDeg <= 15) score += 0.06;
  else if (poseRollDeg <= 25) score += 0.03;

  return Math.min(1, Math.max(0, score));
}

function detectDevice(): string {
  const ua = navigator.userAgent;
  if (/Mobi|Android/i.test(ua)) return 'mobile';
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  return 'desktop';
}
