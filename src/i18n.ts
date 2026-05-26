import type { FeatureName, ReportInputs, StatusLevel } from './types';
import { getCurrentLang } from './lib/language';
import ruData from './locales/ru';
import enData from './locales/en';
import type { Lang } from './lib/language';

const TRANSLATIONS: Record<Lang, Record<string, string>> = { ru: ruData, en: enData };

function t(key: string): string {
  const lang = getCurrentLang();
  return TRANSLATIONS[lang][key] ?? TRANSLATIONS.ru[key] ?? key;
}

export function featureLabel(name: string): string {
  return t(`f.${name}`) !== `f.${name}` ? t(`f.${name}`) : name;
}

export function statusLabel(status: StatusLevel): string {
  return t(`s.${status}`);
}

export function lightingLabel(lighting: ReportInputs['lightingHeuristic']): string {
  return t(`l.${lighting}`);
}

export function inputTypeLabel(type: ReportInputs['type']): string {
  const lang = getCurrentLang();
  const labels: Record<Lang, Record<string, string>> = {
    ru: { photo: 'фото', camera: 'камера' },
    en: { photo: 'photo', camera: 'camera' },
  };
  return labels[lang][type] ?? type;
}

export function deviceLabel(device: string): string {
  return t(`d.${device}`) !== `d.${device}` ? t(`d.${device}`) : device;
}

export function getLocaleCode(): string {
  return t('locale.code');
}

// ─── Measurement Info (tooltips) ──────────────────────────────────────────────

export interface MeasurementMeta {
  label: string;
  description: string;
}

const MEASUREMENT_INFO_RU: Record<string, MeasurementMeta> = {
  // ── Брови ──
  rightArchAngle: {
    label: 'Изгиб брови (левая)',
    description:
      'Насколько сильно изогнута левая бровь — чем меньше угол, тем круче арка. Норма: 120–160°.',
  },
  leftArchAngle: {
    label: 'Изгиб брови (правая)',
    description:
      'Насколько сильно изогнута правая бровь. Норма: 120–160°.',
  },
  symmetryIndex: {
    label: 'Индекс симметрии',
    description:
      'Показывает симметричность левой и правой сторон. 1.0 — идеальная симметрия. Норма: выше 0.85. Рассчитывается как отношение разницы сторон к максимальному значению.',
  },
  rightLengthProxy: {
    label: 'Длина брови (левая)',
    description:
      'Длина правой брови относительно высоты лица. Расстояние от внутреннего до внешнего края, делённое на высоту лица.',
  },
  leftLengthProxy: {
    label: 'Длина брови (правая)',
    description:
      'Длина левой брови относительно высоты лица. Аналогично правой стороне.',
  },
  browToEyeDistance: {
    label: 'Расстояние бровь–глаз',
    description:
      'Вертикальный зазор между пиком брови и верхним веком, нормализованный к высоте лица. Норма: 0.02–0.09. Малые значения — низкие брови, большие — высокие.',
  },
  // ── Глаза ──
  rightEAR: {
    label: 'Открытость глаза (левый)',
    description:
      'Насколько широко открыт глаз: соотношение высоты и ширины глазной щели. Норма: 0.18–0.42. Низкие значения — узкий глаз, высокие — широко открытый.',
  },
  leftEAR: {
    label: 'Открытость глаза (правый)',
    description:
      'То же измерение для правого глаза. Сравнение с левым показывает симметрию. Норма: 0.18–0.42.',
  },
  interpupillaryDistance: {
    label: 'Межзрачковое расстояние',
    description:
      'Расстояние между центрами зрачков (нормализованное). Используется как базовая единица для расчёта многих пропорций лица.',
  },
  rightWidthRatio: {
    label: 'Ширина глаза (левый)',
    description:
      'Горизонтальный размер правой глазной щели относительно межзрачкового расстояния.',
  },
  leftWidthRatio: {
    label: 'Ширина глаза (правый)',
    description:
      'Горизонтальный размер левой глазной щели относительно межзрачкового расстояния.',
  },
  intercanthalToEyeWidth: {
    label: 'Межкантальное / ширина глаза',
    description:
      'Расстояние между внутренними уголками глаз ÷ средняя ширина глаза. По правилу «пятых» идеально ~1.0. Норма: 0.7–1.4.',
  },
  facialWidthToEyeWidth: {
    label: 'Ширина лица / ширина глаза',
    description:
      'Ширина лица по скулам ÷ средняя ширина глаза. Часть анализа «лицевых пятых» — горизонтальных пропорциональных зон.',
  },
  // ── Нос ──
  alarWidthToIPD: {
    label: 'Ширина носа / МЗР',
    description:
      'Ширина крыльев носа ÷ межзрачковое расстояние. Норма: 0.50–0.95. Классический канон: ширина носа ≈ расстояние между внутренними уголками глаз.',
  },
  alarWidthToIntercanthal: {
    label: 'Ширина носа / межкантальное',
    description:
      'Ширина крыльев носа ÷ расстояние между внутренними уголками глаз. Норма: 0.8–1.35. Идеал ~1.0.',
  },
  noseLengthRatio: {
    label: 'Длина носа',
    description:
      'Длина носа (от переносицы до кончика) ÷ высота лица. Норма: 0.12–0.28.',
  },
  // ── Щёки / Челюсть ──
  faceHeightWidthRatio: {
    label: 'Высота / ширина лица',
    description:
      'Высота лица ÷ ширина по скулам. Определяет форму лица. Норма: 1.15–1.58. Ниже 1.2 — круглое, выше 1.5 — вытянутое.',
  },
  biocularToFaceWidth: {
    label: 'Биокулярная / ширина лица',
    description:
      'Расстояние между наружными уголками глаз ÷ ширина лица по скулам. Показывает горизонтальные пропорции средней зоны.',
  },
  skinUniformity: {
    label: 'Однородность кожи',
    description:
      'Равномерность цвета кожи в зоне щёк (0–1). Норма: выше 0.7. Низкие значения — неравномерная пигментация.',
  },
  rednessIndex: {
    label: 'Индекс покраснения',
    description:
      'Отклонение красного канала от нейтрального баланса. Норма: ниже 0.06. Повышенные значения — покраснение, розацеа или чувствительность.',
  },
  // ── Челюсть ──
  jawWidthRatio: {
    label: 'Ширина челюсти',
    description:
      'Ширина челюсти (от угла до угла) ÷ ширина лица по скулам. Показывает массивность нижней челюсти.',
  },
  vShapeProxy: {
    label: 'V-форма лица',
    description:
      'Ширина челюсти ÷ ширина лба. Норма: 0.72–1.18. Ниже 0.8 — V-форма, выше 1.1 — квадратная форма.',
  },
  // ── Губы ──
  upperLowerRatio: {
    label: 'Верхняя / нижняя губа',
    description:
      'Высота верхней губы ÷ нижней. Классический идеал ~0.625 (1:1.6). Норма: 0.45–1.05.',
  },
  mouthWidthToIPD: {
    label: 'Ширина рта / МЗР',
    description:
      'Ширина рта ÷ межзрачковое расстояние. Показывает пропорциональность рта к средней зоне лица.',
  },
  mouthToNoseWidthRatio: {
    label: 'Ширина рта / ширина носа',
    description:
      'Ширина рта ÷ ширина крыльев носа. Норма: 1.15–1.95. Канон: рот шире носа примерно в 1.5 раза.',
  },
  cornerTilt: {
    label: 'Наклон уголков рта',
    description:
      'Угол линии уголков рта в градусах. 0° — ровная линия. Норма: ±6°. Положительные — правый уголок выше.',
  },
  // ── Подбородок ──
  chinHeightRatio: {
    label: 'Высота подбородка',
    description:
      'Расстояние от нижней губы до кончика подбородка ÷ высота лица. Норма: 0.10–0.27.',
  },
  faceThirdUpper: {
    label: 'Верхняя треть лица',
    description:
      'Доля верхней трети (от линии роста волос до бровей) в высоте лица. Идеал: ~0.33 (равные трети).',
  },
  faceThirdMiddle: {
    label: 'Средняя треть лица',
    description:
      'Доля средней трети (от бровей до основания носа) в высоте лица. Идеал: ~0.33.',
  },
  faceThirdLower: {
    label: 'Нижняя треть лица',
    description:
      'Доля нижней трети (от основания носа до подбородка) в высоте лица. Идеал: ~0.33.',
  },
  lowerFaceRatio: {
    label: 'Пропорция нижней части',
    description:
      'Расстояние от основания носа до линии смыкания губ ÷ от линии губ до подбородка. Норма: 0.25–0.80.',
  },
  // ── Кожа ──
  avgBrightness: {
    label: 'Яркость кожи',
    description:
      'Средняя яркость кожи в зоне щёк (0–255). Зависит от освещения и фототипа. Базовый ориентир.',
  },
  textureVariance: {
    label: 'Текстура кожи',
    description:
      'Вариативность яркости в зоне щёк. Норма: ниже 500. Высокие значения — неровности, расширенные поры.',
  },
  brightnessVariance: {
    label: 'Текстура кожи',
    description:
      'Вариативность яркости в зоне щёк. Норма: ниже 500. Высокие значения — неровности, расширенные поры.',
  },
  colorUniformity: {
    label: 'Однородность цвета',
    description:
      'Равномерность цвета кожи (0–1). Норма: выше 0.7. Основана на стандартном отклонении цветовых каналов.',
  },
  // ── Шея ──
  submentalContourProxyAngle: {
    label: 'Контур подбородок–шея',
    description:
      'Угол шейно-подбородочной зоны по профильному снимку. Норма: 95–145°. Меньший угол — более чёткий контур шеи.',
  },
  // ── Профильные метрики ──
  noseProjectionRatio: {
    label: 'Проекция носа (профиль)',
    description:
      'Насколько кончик носа выступает вперёд относительно вертикальной линии лица. Измеряется по фото в профиль.',
  },
  nasofrontalAngle: {
    label: 'Угол переносицы',
    description:
      'Угол перехода от лба к носу. Идеал: жен. 130–145°, муж. 125–140°. Определяет, насколько «чётким» выглядит переход лоб→нос.',
  },
  nasolabialAngle: {
    label: 'Угол кончика носа',
    description:
      'Угол между основанием носа и верхней губой. Идеал: жен. 95–115°, муж. 88–105°. Показывает, вздёрнут нос или опущен.',
  },
  chinProjectionRatio: {
    label: 'Выступание подбородка (профиль)',
    description:
      'Насколько подбородок выступает вперёд относительно вертикальной линии профиля. Положительные значения — выступающий подбородок.',
  },
  gonialAngle: {
    label: 'Угол челюсти',
    description:
      'Угол нижней челюсти по бокам. Норма: 120–135°. Меньший угол — квадратная челюсть, больший — узкое лицо.',
  },
  lipProjectionRatio: {
    label: 'Выступание губ в профиль',
    description:
      'Насколько губы выступают вперёд от линии нос–подбородок. Положительные значения = губы выступают вперёд.',
  },
  malarProjectionProxy: {
    label: 'Выступание скул (профиль)',
    description:
      'Насколько скулы выступают в сторону относительно центральной части лица.',
  },
  // ── Мягкотканевые метрики ──
  softTissue_nPrnRatio: {
    label: 'Выступание носа',
    description:
      'Насколько нос выступает вперёд относительно общей высоты профиля лица. Ориентировочный показатель по снимку в профиль.',
  },
  softTissue_noseProtrusion: {
    label: 'Выступание кончика носа',
    description:
      'Насколько кончик носа выдвинут вперёд от вертикальной линии профиля. Положительные значения = нос выступает.',
  },
  softTissue_nasofrontalAngle: {
    label: 'Угол переносицы (профиль)',
    description:
      'Угол перехода от лба к носу по снимку профиля. Ориентировочный показатель.',
  },
  softTissue_nasolabialAngle: {
    label: 'Угол кончика носа (профиль)',
    description:
      'Угол между основанием носа и верхней губой по профильному снимку. Ориентировочный показатель.',
  },
  softTissue_cmSnRatio: {
    label: 'Видимая часть основания носа',
    description:
      'Длина видимой части между кончиком носа и верхней губой, относительно высоты профиля.',
  },
  softTissue_snLsRatio: {
    label: 'Высота верхней губы',
    description:
      'Высота верхней губы от основания носа до края губы, относительно высоты профиля.',
  },
  softTissue_lipProtrusion: {
    label: 'Выступание губ',
    description:
      'Насколько губы выдвинуты вперёд относительно линии нос–подбородок. Ориентировочный показатель.',
  },
  softTissue_lsPgRatio: {
    label: 'Высота нижней части профиля',
    description:
      'Расстояние от верхней губы до подбородка относительно общей высоты профиля.',
  },
  softTissue_gNRatio: {
    label: 'Глубина надбровья',
    description:
      'Насколько глубоко переносица «утоплена» относительно надбровных дуг. Ориентировочный показатель.',
  },
  softTissue_nPgDistance: {
    label: 'Высота профиля нос–подбородок',
    description:
      'Расстояние от переносицы до подбородка. Используется как базовая единица для остальных показателей профиля.',
  },
  softTissue_confidence: {
    label: 'Точность профильного анализа',
    description:
      'Насколько чётко AI смог распознать ключевые точки на профильном снимке (0–1). Чем выше — тем точнее остальные показатели профиля.',
  },
};

const MEASUREMENT_INFO_EN: Record<string, MeasurementMeta> = {
  rightArchAngle: { label: 'Brow Curve (left)', description: 'How curved the left eyebrow is — a lower angle means a sharper arch. Norm: 120–160°.' },
  leftArchAngle: { label: 'Brow Curve (right)', description: 'How curved the right eyebrow is. Norm: 120–160°.' },
  symmetryIndex: { label: 'Symmetry Index', description: 'Shows left-right symmetry. 1.0 = perfect symmetry. Norm: above 0.85. Calculated as the ratio of side difference to maximum value.' },
  rightLengthProxy: { label: 'Brow Length (left)', description: 'Right eyebrow length relative to face height. Distance from inner to outer edge divided by face height.' },
  leftLengthProxy: { label: 'Brow Length (right)', description: 'Left eyebrow length relative to face height. Same as right side.' },
  browToEyeDistance: { label: 'Brow-Eye Distance', description: 'Vertical gap between brow peak and upper eyelid, normalized to face height. Norm: 0.02–0.09. Low = low brows, high = high brows.' },
  rightEAR: { label: 'Eye Openness (left)', description: 'How wide open the left eye is: height-to-width ratio of the eye opening. Norm: 0.18–0.42. Low = narrow eye, high = wide open.' },
  leftEAR: { label: 'Eye Openness (right)', description: 'Same measurement for the right eye. Comparing both shows symmetry. Norm: 0.18–0.42.' },
  interpupillaryDistance: { label: 'Interpupillary Distance', description: 'Distance between pupil centers (normalized). Used as a base unit for many facial proportion calculations.' },
  rightWidthRatio: { label: 'Eye Width (left)', description: 'Horizontal size of the right eye opening relative to interpupillary distance.' },
  leftWidthRatio: { label: 'Eye Width (right)', description: 'Horizontal size of the left eye opening relative to interpupillary distance.' },
  intercanthalToEyeWidth: { label: 'Intercanthal / Eye Width', description: 'Distance between inner eye corners ÷ average eye width. Ideally ~1.0 (rule of fifths). Norm: 0.7–1.4.' },
  facialWidthToEyeWidth: { label: 'Face Width / Eye Width', description: 'Face width at cheekbones ÷ average eye width. Part of the facial fifths analysis — horizontal proportional zones.' },
  alarWidthToIPD: { label: 'Nose Width / IPD', description: 'Alar width ÷ interpupillary distance. Norm: 0.50–0.95. Classic canon: nose width ≈ intercanthal distance.' },
  alarWidthToIntercanthal: { label: 'Nose Width / Intercanthal', description: 'Alar width ÷ intercanthal distance. Norm: 0.8–1.35. Ideal ~1.0.' },
  noseLengthRatio: { label: 'Nose Length', description: 'Nose length (bridge to tip) ÷ face height. Norm: 0.12–0.28.' },
  faceHeightWidthRatio: { label: 'Face Height / Width', description: 'Face height ÷ cheekbone width. Determines face shape. Norm: 1.15–1.58. Below 1.2 = round, above 1.5 = elongated.' },
  biocularToFaceWidth: { label: 'Biocular / Face Width', description: 'Distance between outer eye corners ÷ cheekbone width. Shows horizontal proportions of the middle zone.' },
  skinUniformity: { label: 'Skin Uniformity', description: 'Skin color evenness in the cheek area (0–1). Norm: above 0.7. Low values indicate uneven pigmentation.' },
  rednessIndex: { label: 'Redness Index', description: 'Red channel deviation from neutral balance. Norm: below 0.06. High values indicate redness, rosacea, or sensitivity.' },
  jawWidthRatio: { label: 'Jaw Width', description: 'Jaw width (angle to angle) ÷ cheekbone width. Shows jawline massiveness.' },
  vShapeProxy: { label: 'V-Shape Index', description: 'Jaw width ÷ forehead width. Norm: 0.72–1.18. Below 0.8 = V-shape, above 1.1 = square shape.' },
  upperLowerRatio: { label: 'Upper / Lower Lip', description: 'Upper lip height ÷ lower. Classic ideal ~0.625 (1:1.6). Norm: 0.45–1.05.' },
  mouthWidthToIPD: { label: 'Mouth Width / IPD', description: 'Mouth width ÷ interpupillary distance. Shows mouth proportionality to the mid-face.' },
  mouthToNoseWidthRatio: { label: 'Mouth Width / Nose Width', description: 'Mouth width ÷ alar width. Norm: 1.15–1.95. Canon: mouth is ~1.5× wider than nose.' },
  cornerTilt: { label: 'Mouth Corner Tilt', description: 'Angle of the mouth corner line in degrees. 0° = level. Norm: ±6°. Positive = right corner higher.' },
  chinHeightRatio: { label: 'Chin Height', description: 'Distance from lower lip to chin tip ÷ face height. Norm: 0.10–0.27.' },
  faceThirdUpper: { label: 'Upper Face Third', description: 'Upper third proportion (hairline to brows) of face height. Ideal: ~0.33 (equal thirds).' },
  faceThirdMiddle: { label: 'Middle Face Third', description: 'Middle third proportion (brows to nose base) of face height. Ideal: ~0.33.' },
  faceThirdLower: { label: 'Lower Face Third', description: 'Lower third proportion (nose base to chin) of face height. Ideal: ~0.33.' },
  lowerFaceRatio: { label: 'Lower Face Ratio', description: 'Nose base to lip line ÷ lip line to chin. Norm: 0.25–0.80.' },
  avgBrightness: { label: 'Skin Brightness', description: 'Average skin brightness in the cheek area (0–255). Depends on lighting and phototype. Baseline reference.' },
  textureVariance: { label: 'Skin Texture', description: 'Brightness variance in the cheek area. Norm: below 500. High values indicate roughness, enlarged pores.' },
  brightnessVariance: { label: 'Skin Texture', description: 'Brightness variance in the cheek area. Norm: below 500. High values indicate roughness, enlarged pores.' },
  colorUniformity: { label: 'Color Uniformity', description: 'Skin color evenness (0–1). Norm: above 0.7. Based on color channel standard deviation.' },
  submentalContourProxyAngle: { label: 'Chin-Neck Contour', description: 'Cervicomental angle from profile photo. Norm: 95–145°. Lower angle = sharper neck contour.' },
  noseProjectionRatio: { label: 'Nose Projection (profile)', description: 'How far the nose tip projects forward relative to the vertical face line. Measured from the profile photo.' },
  nasofrontalAngle: { label: 'Bridge Angle', description: 'Angle of the transition from forehead to nose. Ideal: female 130–145°, male 125–140°. Determines how defined the brow-to-nose transition looks.' },
  nasolabialAngle: { label: 'Nose Tip Angle', description: 'Angle between the base of the nose and upper lip. Ideal: female 95–115°, male 88–105°. Shows whether the nose tip points up or down.' },
  chinProjectionRatio: { label: 'Chin Projection (profile)', description: 'How much the chin sticks out relative to the vertical profile line. Positive = projecting chin.' },
  gonialAngle: { label: 'Jaw Angle', description: 'The angle of the lower jaw at each side. Norm: 120–135°. Smaller = square jaw, larger = narrower face.' },
  lipProjectionRatio: { label: 'Lip Projection (profile)', description: 'How much the lips stick out from the nose-to-chin line. Positive = lips project forward.' },
  malarProjectionProxy: { label: 'Cheekbone Projection (profile)', description: 'How much the cheekbones protrude sideways relative to the center of the face.' },
  softTissue_nPrnRatio: { label: 'Nose Projection', description: 'How much the nose projects relative to the overall profile height. Indicative reading from profile photo.' },
  softTissue_noseProtrusion: { label: 'Nose Tip Protrusion', description: 'How far the nose tip sticks out from the vertical profile line. Positive = nose projects forward.' },
  softTissue_nasofrontalAngle: { label: 'Bridge Angle (profile)', description: 'Angle of the forehead-to-nose transition from the profile photo. Indicative measurement.' },
  softTissue_nasolabialAngle: { label: 'Nose Tip Angle (profile)', description: 'Angle between the base of the nose and upper lip from the profile photo. Indicative measurement.' },
  softTissue_cmSnRatio: { label: 'Visible Nose Base Length', description: 'Length of the visible portion between nose tip and upper lip, relative to overall profile height.' },
  softTissue_snLsRatio: { label: 'Upper Lip Height', description: 'Height of the upper lip from the nose base to the lip edge, relative to profile height.' },
  softTissue_lipProtrusion: { label: 'Lip Protrusion (profile)', description: 'How much the lips protrude from the nose-to-chin line. Indicative measurement.' },
  softTissue_lsPgRatio: { label: 'Lower Profile Height', description: 'Distance from the upper lip to the chin relative to the overall profile height.' },
  softTissue_gNRatio: { label: 'Brow Ridge Depth', description: 'How deep the bridge of the nose sits relative to the brow ridges. Indicative measurement.' },
  softTissue_nPgDistance: { label: 'Profile Height (nose to chin)', description: 'Distance from the nose bridge to the chin. Used as a base unit for all other profile measurements.' },
  softTissue_confidence: { label: 'Profile Analysis Accuracy', description: 'How clearly AI detected key points on the profile photo (0–1). Higher = more reliable profile measurements.' },
};

const MEASUREMENT_INFO: Record<Lang, Record<string, MeasurementMeta>> = {
  ru: MEASUREMENT_INFO_RU,
  en: MEASUREMENT_INFO_EN,
};

export function measurementInfo(key: string): MeasurementMeta {
  const lang = getCurrentLang();
  return MEASUREMENT_INFO[lang][key] ?? MEASUREMENT_INFO.ru[key] ?? { label: key, description: '' };
}
