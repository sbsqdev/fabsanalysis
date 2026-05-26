// ─── Feature Names (strict order per protocol) ───────────────────────────────
export const FEATURE_NAMES = [
  'Eyebrows',
  'Eyes',
  'Nose',
  'Cheeks',
  'Jaw',
  'Lips',
  'Chin',
  'Skin',
  'Neck',
  'Ears',
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

// ─── Report Schema ───────────────────────────────────────────────────────────

export interface ReportMeta {
  date: string;
  version: string;
  modelSource: string;
  device: string;
  processingTime: number;
}

export interface ReportInputs {
  type: 'photo' | 'camera';
  resolution: { width: number; height: number };
  qualityScore: number; // 0-1
  lightingHeuristic: 'good' | 'moderate' | 'poor';
  faceFrameCoverage: number; // 0-1 fraction of frame occupied by face box
  poseRollDeg: number; // absolute frontal roll angle in degrees
}

export interface FaceDetection {
  bbox: { x: number; y: number; width: number; height: number };
  confidence: number;
}

export interface LandmarksMeta {
  count: number;
  model: string;
}

export type StatusLevel = 'within_norm' | 'strength' | 'attention' | 'insufficient_data';

export interface FeatureAnalysis {
  name: FeatureName;
  status: StatusLevel;
  observations: string[];
  measurements: Record<string, number | string>;
  recommendations: string[];
  confidence: number; // 0-1
  limitations: string[];
}

export interface AnalysisReport {
  meta: ReportMeta;
  inputs: ReportInputs;
  faceDetection: FaceDetection;
  landmarks: LandmarksMeta;
  features: FeatureAnalysis[];
  disclaimer: string;
}

// ─── User Profile (from survey during scan) ───────────────────────────────────

export type Gender = 'female' | 'male' | 'unspecified';

/**
 * Population group for proportion norm adjustment.
 * 'default' uses Western/universal norms.
 * 'east_asian' uses East-Asian-specific ranges where available.
 */
export type PopulationGroup = 'default' | 'east_asian';

export const COSMETIC_PROCEDURES = [
  'Ботокс / нейромодуляторы',
  'Гиалуроновые филлеры',
  'Ринопластика',
  'Блефаропластика',
  'Подтяжка лица / SMAS-лифтинг',
  'Нитевой лифтинг',
  'Лазерная шлифовка',
  'Химический пилинг',
  'Мезотерапия / биоревитализация',
  'Липолитики / коррекция овала',
  'Контурная пластика (подбородок, скулы)',
] as const;

export type CosmeticProcedure = (typeof COSMETIC_PROCEDURES)[number];

export interface UserProfile {
  gender: Gender | null;
  population: PopulationGroup;
  procedures: CosmeticProcedure[];
  hasProcedures: boolean | null; // null = not answered yet
}

// ─── App State ───────────────────────────────────────────────────────────────

export type AppScreen = 'capture' | 'guided_capture' | 'scanning' | 'report';

export type CaptureAngle = 'front' | 'left' | 'right';

export interface AngleCapture {
  canvas: HTMLCanvasElement;
  imageData: ImageData;
  angle: CaptureAngle;
  /** Whether the captured frame was horizontally mirrored (selfie-mode). */
  mirrored: boolean;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface NormalizedLandmark {
  x: number; // 0-1 normalized
  y: number; // 0-1 normalized
  z: number; // depth
}

// ─── JSON Schema (for validation / export) ───────────────────────────────────

export const REPORT_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'FacialAnalysisReport',
  type: 'object',
  required: ['meta', 'inputs', 'faceDetection', 'landmarks', 'features', 'disclaimer'],
  properties: {
    meta: {
      type: 'object',
      properties: {
        date: { type: 'string', format: 'date-time' },
        version: { type: 'string' },
        modelSource: { type: 'string' },
        device: { type: 'string' },
        processingTime: { type: 'number' },
      },
      required: ['date', 'version', 'modelSource', 'device', 'processingTime'],
    },
    inputs: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['photo', 'camera'] },
        resolution: {
          type: 'object',
          properties: {
            width: { type: 'number' },
            height: { type: 'number' },
          },
        },
        qualityScore: { type: 'number', minimum: 0, maximum: 1 },
        lightingHeuristic: { type: 'string', enum: ['good', 'moderate', 'poor'] },
        faceFrameCoverage: { type: 'number', minimum: 0, maximum: 1 },
        poseRollDeg: { type: 'number', minimum: 0 },
      },
      required: ['type', 'resolution', 'qualityScore', 'lightingHeuristic', 'faceFrameCoverage', 'poseRollDeg'],
    },
    faceDetection: {
      type: 'object',
      properties: {
        bbox: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    landmarks: {
      type: 'object',
      properties: {
        count: { type: 'number' },
        model: { type: 'string' },
      },
    },
    features: {
      type: 'array',
      minItems: 10,
      maxItems: 10,
      items: {
        type: 'object',
        required: ['name', 'status', 'observations', 'measurements', 'recommendations', 'confidence', 'limitations'],
        properties: {
          name: { type: 'string' },
          status: { type: 'string', enum: ['within_norm', 'strength', 'attention', 'insufficient_data'] },
          observations: { type: 'array', items: { type: 'string' } },
          measurements: { type: 'object' },
          recommendations: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          limitations: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    disclaimer: { type: 'string' },
  },
};

export const DISCLAIMER_TEXT_RU =
  'Этот анализ предназначен только для образовательных и демонстрационных целей. ' +
  'Он не является медицинской, дерматологической или косметологической рекомендацией. ' +
  'Автоматический анализ лица по одному 2D-изображению имеет объективные ограничения точности ' +
  'и не должен использоваться для клинических решений. ' +
  'Для персональных рекомендаций обращайтесь к квалифицированным специалистам.';

export const DISCLAIMER_TEXT_EN =
  'This analysis is for educational and demonstration purposes only. ' +
  'It is not medical, dermatological, or cosmetic advice. ' +
  'Automated facial analysis from a single 2D image has objective accuracy limitations ' +
  'and must not be used for clinical decisions. ' +
  'For personalized recommendations, consult qualified specialists.';

export const DISCLAIMER_TEXT = DISCLAIMER_TEXT_RU;

export function getDisclaimerText(lang: 'ru' | 'en'): string {
  return lang === 'en' ? DISCLAIMER_TEXT_EN : DISCLAIMER_TEXT_RU;
}
