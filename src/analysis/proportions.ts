/**
 * Facial proportion standards — gender-specific ideal ranges based on
 * cosmetology research, neoclassical canons, and contemporary aesthetic studies.
 *
 * Sources:
 * - Neoclassical facial canons (da Vinci, facial fifths / thirds)
 * - PMC facial attractiveness studies (golden ratio applications)
 * - Contemporary cosmetic surgery references (NFA, NLA, canthal tilt, etc.)
 * - User-provided clinical proportion guide
 */

import type { FeatureName, Gender, PopulationGroup } from '../types';
import { getCurrentLang } from '../lib/language';
import { measurementInfo } from '../i18n';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProportionItem {
  /** Internal key matching existing measurement key or a derived metric */
  key: string;
  /** Russian display label */
  label: string;
  /** User's computed value */
  userValue: number;
  /** Ideal range minimum */
  idealMin: number;
  /** Ideal range maximum */
  idealMax: number;
  /** Center of the ideal range */
  idealCenter: number;
  /** Display unit (°, ratio, %, etc.) */
  unit: string;
  /** If true, shown for information only — not included in scoring/bonus calculations */
  informational?: boolean;
  /** One sentence: what this metric measures */
  description: string;
  /** How to interpret values above/below norm */
  howToRead: string;
  /** Why this metric matters for facial aesthetics */
  whyImportant: string;
  /** How the value is evaluated relative to ideal */
  status: 'ideal' | 'close' | 'deviation';
}

export interface FeatureProportions {
  featureName: FeatureName;
  items: ProportionItem[];
  /** Optional contextual note (e.g. when gender not specified) */
  note?: string;
}

// ─── Standard Ranges ─────────────────────────────────────────────────────────

interface IdealRange {
  female: { min: number; max: number; center: number };
  male: { min: number; max: number; center: number };
  unisex: { min: number; max: number; center: number };
  label: string;
  unit: string;
  /** One sentence: what this metric measures */
  description: string;
  /** How to interpret values above/below the norm */
  howToRead: string;
  /** Why this metric matters for facial aesthetics */
  whyImportant: string;
  /** Acceptable deviation band beyond ideal (for "close" status) */
  tolerance: number;
}

// Key: measurement key → IdealRange
type StandardsMap = Record<string, IdealRange>;

// ─── Eyebrow Standards ───────────────────────────────────────────────────────

const EYEBROW_STANDARDS: StandardsMap = {
  browToEyeDistance: {
    // Calibrated for current MediaPipe proxy:
    // (brow crest ↔ upper eyelid) / (landmark face height 10→152)
    female: { min: 0.050, max: 0.120, center: 0.082 },
    male:   { min: 0.040, max: 0.105, center: 0.072 },
    unisex: { min: 0.045, max: 0.115, center: 0.078 },
    label: 'Расстояние бровь–глаз',
    unit: '',
    description: 'Вертикальный зазор от гребня брови до верхнего века, нормализованный к высоте лица.',
    howToRead: 'Выше нормы → брови высоко подняты, открытый взгляд. Ниже нормы → брови нависают близко к веку, взгляд кажется строже.',
    whyImportant: 'Расстояние бровь–глаз определяет «открытость» взгляда. Оптимальный зазор создаёт приветливое, молодое выражение. Слишком малое расстояние визуально утяжеляет веко и придаёт усталый вид — это один из первых признаков, которые корректируют при блефаропластике.',
    tolerance: 0.025,
  },
  rightArchAngle: {
    // Calibrated for 3-point brow curvature proxy (inner-mid, peak, outer-mid).
    female: { min: 120, max: 145, center: 133 },
    male:   { min: 122, max: 150, center: 136 },
    unisex: { min: 120, max: 148, center: 135 },
    label: 'Угол арки (левая)',
    unit: '°',
    description: 'Угол изгиба дуги правой брови: чем меньше угол — тем круче арка.',
    howToRead: 'Ниже нормы (<120°) → резкая высокая арка. Выше нормы (>150°) → прямая, почти горизонтальная бровь.',
    whyImportant: 'Форма арки брови задаёт «характер» взгляда. Умеренная арка ассоциируется с женственностью и выразительностью, а более прямая линия — с мужественностью. Брови — один из главных элементов, формирующих эмоциональное восприятие лица.',
    tolerance: 10,
  },
  leftArchAngle: {
    female: { min: 120, max: 145, center: 133 },
    male:   { min: 122, max: 150, center: 136 },
    unisex: { min: 120, max: 148, center: 135 },
    label: 'Угол арки (правая)',
    unit: '°',
    description: 'Угол изгиба дуги левой брови: чем меньше угол — тем круче арка.',
    howToRead: 'Ниже нормы (<120°) → резкая высокая арка. Выше нормы (>150°) → прямая, почти горизонтальная бровь.',
    whyImportant: 'Симметрия арок бровей влияет на общую гармонию лица. Левая бровь в сочетании с правой должна создавать сбалансированную «рамку» для глаз, усиливая выразительность верхней трети лица.',
    tolerance: 10,
  },
};

// ─── Eyes Standards ──────────────────────────────────────────────────────────

const EYES_STANDARDS: StandardsMap = {
  rightEAR: {
    // Recalibrated for full 3-pair Soukupova formula (values ~35% higher than 2-pair)
    female: { min: 0.38, max: 0.54, center: 0.46 },
    male:   { min: 0.30, max: 0.48, center: 0.38 },
    unisex: { min: 0.34, max: 0.52, center: 0.42 },
    label: 'Соотношение глаза (правый)',
    unit: '',
    description: 'Высота глазной щели делённая на ширину (Eye Aspect Ratio, формула Soukupova 2016).',
    howToRead: 'Жен. норма 0.38–0.54, муж. 0.30–0.48. Выше нормы → широко раскрытый глаз. Ниже нормы → прищуренный или анатомически узкий глаз.',
    whyImportant: 'Пропорция глазной щели — ключевой индикатор «живости» взгляда. Оптимальное соотношение высоты к ширине создаёт эффект открытых, выразительных глаз. Этот параметр также используется в медицине для диагностики птоза (опущения века).',
    tolerance: 0.05,
  },
  leftEAR: {
    female: { min: 0.38, max: 0.54, center: 0.46 },
    male:   { min: 0.30, max: 0.48, center: 0.38 },
    unisex: { min: 0.34, max: 0.52, center: 0.42 },
    label: 'Соотношение глаза (левый)',
    unit: '',
    description: 'Высота глазной щели делённая на ширину (Eye Aspect Ratio, формула Soukupova 2016).',
    howToRead: 'Жен. норма 0.38–0.54, муж. 0.30–0.48. Выше нормы → широко раскрытый глаз. Ниже нормы → прищуренный или анатомически узкий глаз.',
    whyImportant: 'Симметрия глаз — один из самых заметных факторов привлекательности. Разница в раскрытии левого и правого глаза сразу бросается в глаза и может указывать на асимметрию лица или тонус мышц.',
    tolerance: 0.05,
  },
  intercanthalToEyeWidth: {
    female: { min: 0.85, max: 1.15, center: 1.00 },
    male:   { min: 0.85, max: 1.15, center: 1.00 },
    unisex: { min: 0.85, max: 1.15, center: 1.00 },
    label: 'Межкантальное / ширина глаза',
    unit: '',
    description: 'Расстояние между внутренними углами глаз делённое на ширину одного глаза.',
    howToRead: 'Идеал ≈ 1.0 (правило пятых). Выше нормы (>1.15) → глаза широко расставлены. Ниже нормы (<0.85) → глаза расположены близко к переносице.',
    whyImportant: 'Это «правило пятых» — классический канон пропорций лица, где расстояние между глазами равно ширине одного глаза. Этот баланс создаёт ощущение гармонии средней зоны лица и влияет на восприятие формы носа.',
    tolerance: 0.10,
  },
  facialWidthToEyeWidth: {
    female: { min: 4.8, max: 5.4, center: 5.0 },
    male:   { min: 4.8, max: 5.6, center: 5.2 },
    unisex: { min: 4.8, max: 5.5, center: 5.1 },
    label: 'Ширина лица / ширина глаза',
    unit: '',
    description: 'Ширина лица делённая на ширину одного глаза — проверка правила «пяти глаз».',
    howToRead: 'Идеал ≈ 5.0: лицо равно пяти ширинам глаза. Выше нормы → узкие глаза или широкое лицо. Ниже нормы → крупные глаза или узкое лицо.',
    whyImportant: 'Проверка классического правила «пяти глаз» — лицо должно быть равно пяти ширинам глаза. Этот канон используется в живописи, скульптуре и пластической хирургии для оценки горизонтальных пропорций лица.',
    tolerance: 0.4,
  },
};

// ─── Nose Standards ──────────────────────────────────────────────────────────

const NOSE_STANDARDS: StandardsMap = {
  alarWidthToIntercanthal: {
    female: { min: 0.85, max: 1.10, center: 1.00 },
    male:   { min: 0.90, max: 1.20, center: 1.05 },
    unisex: { min: 0.85, max: 1.15, center: 1.00 },
    label: 'Ширина крыльев / межкантальное',
    unit: '',
    description: 'Ширина крыльев носа делённая на расстояние между внутренними углами глаз.',
    howToRead: 'Жен. норма 0.85–1.10, муж. 0.90–1.20. Выше нормы → нос шире межкантального расстояния. Ниже нормы → нос уже, что характерно для европейских стандартов.',
    whyImportant: 'Соотношение ширины носа к межкантальному расстоянию — базовый ориентир ринопластики. Нос, гармонирующий с расстоянием между глазами, визуально «встраивается» в центр лица, не привлекая избыточного внимания.',
    tolerance: 0.10,
  },
  alarWidthToIPD: {
    female: { min: 0.55, max: 0.70, center: 0.62 },
    male:   { min: 0.58, max: 0.75, center: 0.66 },
    unisex: { min: 0.56, max: 0.72, center: 0.64 },
    label: 'Ширина крыльев / МЗР',
    unit: '',
    description: 'Ширина крыльев носа делённая на межзрачковое расстояние.',
    howToRead: 'Жен. норма 0.55–0.70, муж. 0.58–0.75. Выше нормы → широкий нос. Ниже нормы → узкий нос относительно расстояния между глазами.',
    whyImportant: 'Межзрачковое расстояние — стабильный ориентир, не зависящий от выражения лица. Ширина носа относительно МЗР помогает объективно оценить пропорциональность носа независимо от ракурса фото.',
    tolerance: 0.06,
  },
  noseLengthRatio: {
    // Recalibrated for nasion (lm168) origin — ~22% longer than old rhinion (lm6) measurements
    female: { min: 0.17, max: 0.27, center: 0.22 },
    male:   { min: 0.19, max: 0.30, center: 0.24 },
    unisex: { min: 0.17, max: 0.29, center: 0.23 },
    label: 'Длина носа / высота лица',
    unit: '',
    description: 'Длина носа (назион–основание) делённая на общую высоту лица. Назион — точка переносицы у лобно-носового шва.',
    howToRead: 'Жен. норма 0.17–0.27, муж. 0.19–0.30. Выше нормы → длинный нос. Ниже нормы → короткий или вздёрнутый нос.',
    whyImportant: 'Длина носа определяет баланс средней трети лица. Нос оптимальной длины поддерживает правило «трёх равных третей» и влияет на восприятие возраста: с годами нос визуально удлиняется из-за гравитационного птоза тканей.',
    tolerance: 0.03,
  },
};

// ─── Lips Standards ──────────────────────────────────────────────────────────

const LIPS_STANDARDS: StandardsMap = {
  upperLowerRatio: {
    female: { min: 0.65, max: 1.10, center: 0.85 },
    male:   { min: 0.62, max: 1.05, center: 0.82 },
    unisex: { min: 0.64, max: 1.08, center: 0.84 },
    label: 'Верхняя / нижняя губа',
    unit: '',
    description: 'Высота верхней губы делённая на высоту нижней губы.',
    howToRead: 'Выше нормы → верхняя губа визуально доминирует. Ниже нормы → нижняя губа выглядит полнее.',
    whyImportant: 'Баланс верхней и нижней губы — один из ключевых параметров эстетики рта. Современный стандарт красоты предполагает нижнюю губу чуть полнее верхней (соотношение ~1:1.6). Этот параметр активно используется при планировании контурной пластики губ.',
    tolerance: 0.16,
  },
  mouthWidthToIPD: {
    female: { min: 0.65, max: 0.92, center: 0.78 },
    male:   { min: 0.68, max: 0.98, center: 0.83 },
    unisex: { min: 0.65, max: 0.95, center: 0.80 },
    label: 'Ширина рта / МЗР',
    unit: '',
    description: 'Ширина рта делённая на межзрачковое расстояние.',
    howToRead: 'Жен. норма 0.65–0.92, муж. 0.68–0.98. Выше нормы → широкий рот. Ниже нормы → узкий рот относительно расстояния между глазами.',
    whyImportant: 'Ширина рта в гармонии с расстоянием между зрачками создаёт сбалансированное восприятие нижней трети лица. Слишком узкий или широкий рот нарушает горизонтальный ритм лица.',
    tolerance: 0.08,
  },
  mouthToNoseWidthRatio: {
    female: { min: 1.30, max: 1.65, center: 1.50 },
    male:   { min: 1.25, max: 1.60, center: 1.45 },
    unisex: { min: 1.28, max: 1.62, center: 1.48 },
    label: 'Ширина рта / ширина носа',
    unit: '',
    description: 'Ширина рта делённая на ширину крыльев носа.',
    howToRead: 'Идеал ≈ 1.5: рот на 50% шире носа. Выше нормы → рот слишком широк относительно носа. Ниже нормы → нос слишком широк или рот узкий.',
    whyImportant: 'Пропорция рта к носу — классический эстетический критерий. Идеальное соотношение ~1.5 обеспечивает визуальный баланс между двумя доминантными чертами центра лица.',
    tolerance: 0.12,
  },
  cornerTilt: {
    female: { min: -2.0, max: 4.0, center: 1.5 },
    male:   { min: -2.5, max: 3.5, center: 1.0 },
    unisex: { min: -2.0, max: 4.0, center: 1.2 },
    label: 'Наклон уголков рта',
    unit: '°',
    description: 'Угол наклона линии уголков рта относительно горизонтали.',
    howToRead: 'Жен. норма –2°…+4°, муж. –2.5°…+3.5°. Положительные значения → поднятые уголки (ассоциируются с молодостью). Отрицательные → опущенные уголки, придают угрюмый вид.',
    whyImportant: 'Наклон уголков рта — мощный индикатор настроения и возраста. Приподнятые уголки ассоциируются с доброжелательностью и молодостью. Опущенные — с усталостью и грустью. Это одна из первых зон, которую корректируют филлерами.',
    tolerance: 2.0,
  },
};

// ─── Jaw Standards ───────────────────────────────────────────────────────────

const JAW_STANDARDS: StandardsMap = {
  jawWidthRatio: {
    female: { min: 0.68, max: 0.78, center: 0.73 },
    male:   { min: 0.82, max: 0.92, center: 0.87 },
    unisex: { min: 0.72, max: 0.88, center: 0.80 },
    label: 'Ширина челюсти / ширина лица',
    unit: '',
    description: 'Бигониальная ширина (угол в угол нижней челюсти) делённая на бискуловую ширину лица.',
    howToRead: 'Жен. норма 0.68–0.78: узкая, V-образная челюсть. Муж. норма 0.82–0.92: широкая, квадратная челюсть. Выше нормы → массивная/квадратная челюсть для своего пола. Ниже нормы → изящная, зауженная линия.',
    whyImportant: 'Ширина челюсти — один из главных маркеров полового диморфизма. У женщин узкая V-линия ассоциируется с молодостью и утончённостью, у мужчин — выраженная челюсть подчёркивает маскулинность. Этот параметр часто корректируют ботулотоксином (массетер) или филлерами.',
    tolerance: 0.05,
  },
  vShapeProxy: {
    female: { min: 0.70, max: 0.82, center: 0.76 },
    male:   { min: 0.80, max: 0.95, center: 0.88 },
    unisex: { min: 0.72, max: 0.90, center: 0.82 },
    label: 'V-форма (челюсть / лоб)',
    unit: '',
    description: 'Ширина челюсти делённая на ширину лба — показатель V-образности контура лица.',
    howToRead: 'Жен. норма 0.70–0.82: чёткий V-овал. Муж. норма 0.80–0.95: прямоугольный/квадратный контур. Ниже нормы → резко сужающийся подбородок. Выше нормы → челюсть шире лба.',
    whyImportant: 'V-форма лица — один из самых востребованных эстетических параметров, особенно в азиатской косметологии. Соотношение ширины челюсти к лбу определяет общий контур лица: V-овал, квадрат, трапеция или «сердечко».',
    tolerance: 0.06,
  },
  faceHeightWidthRatio: {
    female: { min: 1.30, max: 1.50, center: 1.40 },
    male:   { min: 1.25, max: 1.45, center: 1.35 },
    unisex: { min: 1.28, max: 1.48, center: 1.38 },
    label: 'Высота / ширина лица',
    unit: '',
    description: 'Общая высота лица делённая на наибольшую ширину (скуловая).',
    howToRead: 'Жен. норма 1.30–1.50, муж. 1.25–1.45. Выше нормы → вытянутое, узкое лицо. Ниже нормы → широкое, «плоское» пропорционально.',
    whyImportant: 'Соотношение высоты к ширине лица определяет тип овала: вытянутый, овальный или круглый. Это фундаментальный параметр, от которого зависит выбор причёски, очков и стратегии макияжа.',
    tolerance: 0.08,
  },
};

// ─── Chin Standards ──────────────────────────────────────────────────────────

const CHIN_STANDARDS: StandardsMap = {
  chinHeightRatio: {
    female: { min: 0.14, max: 0.20, center: 0.17 },
    male:   { min: 0.15, max: 0.22, center: 0.19 },
    unisex: { min: 0.14, max: 0.21, center: 0.18 },
    label: 'Высота подбородка / лицо',
    unit: '',
    description: 'Высота подбородка делённая на общую высоту лица.',
    howToRead: 'Жен. норма 0.14–0.20, муж. 0.15–0.22. Выше нормы → подбородок высокий, доминирующий. Ниже нормы → слабовыраженный, утопающий подбородок.',
    whyImportant: 'Высота подбородка влияет на баланс нижней трети лица и профиль. Недостаточный подбородок (ретрогения) может нарушать гармонию профиля и привлекательность нижней челюсти. Часто корректируется филлерами или имплантами.',
    tolerance: 0.025,
  },
  faceThirdUpper: {
    female: { min: 0.28, max: 0.37, center: 0.33 },
    male:   { min: 0.28, max: 0.37, center: 0.33 },
    unisex: { min: 0.28, max: 0.37, center: 0.33 },
    label: 'Верхняя треть лица',
    unit: '',
    description: 'Доля верхней трети (лоб–брови) в общей высоте лица.',
    howToRead: 'Идеал ≈ 0.33 (равные трети). Выше нормы → высокий лоб, большая верхняя зона. Ниже нормы → низкая линия роста волос или короткий лоб.',
    whyImportant: 'Правило трёх равных третей — фундаментальный канон пропорций лица (Леонардо да Винчи). Верхняя треть задаёт «рамку» лица и влияет на восприятие интеллекта и открытости.',
    tolerance: 0.04,
  },
  faceThirdMiddle: {
    female: { min: 0.28, max: 0.37, center: 0.33 },
    male:   { min: 0.28, max: 0.37, center: 0.33 },
    unisex: { min: 0.28, max: 0.37, center: 0.33 },
    label: 'Средняя треть лица',
    unit: '',
    description: 'Доля средней трети (брови–основание носа) в общей высоте лица.',
    howToRead: 'Идеал ≈ 0.33. Выше нормы → длинная средняя зона, длинный нос. Ниже нормы → короткий нос или высокие брови.',
    whyImportant: 'Средняя треть — зона носа и скул — определяет центр визуального внимания. Её пропорция к остальным третям влияет на восприятие длины носа и положения глаз.',
    tolerance: 0.04,
  },
  faceThirdLower: {
    female: { min: 0.28, max: 0.37, center: 0.33 },
    male:   { min: 0.30, max: 0.38, center: 0.34 },
    unisex: { min: 0.28, max: 0.37, center: 0.33 },
    label: 'Нижняя треть лица',
    unit: '',
    description: 'Доля нижней трети (нос–подбородок) в общей высоте лица.',
    howToRead: 'Жен. норма 0.28–0.37, муж. 0.30–0.38. Выше нормы → длинная нижняя треть, удлинённый подбородок. Ниже нормы → короткая нижняя треть, недоразвитый подбородок.',
    whyImportant: 'Нижняя треть лица (нос–подбородок) включает губы и подбородок — зоны, которые сильнее всего меняются с возрастом. Оптимальная пропорция обеспечивает молодой, сбалансированный вид профиля.',
    tolerance: 0.04,
  },
  lowerFaceRatio: {
    female: { min: 0.40, max: 0.60, center: 0.50 },
    male:   { min: 0.42, max: 0.62, center: 0.50 },
    unisex: { min: 0.40, max: 0.62, center: 0.50 },
    label: 'Верх / низ нижней трети',
    unit: '',
    description: 'Расстояние нос–рот делённое на расстояние рот–подбородок.',
    howToRead: 'Идеал ≈ 0.50 (норма Фаркаса 1:2 — нос-рот : рот-подбородок). Выше нормы → длинная верхняя губа. Ниже нормы → рот расположен высоко.',
    whyImportant: 'Пропорция Фаркаса (1:2) внутри нижней трети лица — критерий баланса между зоной губ и подбородка. Нарушение этой пропорции влияет на профиль и воспринимается как дисгармония нижней части лица.',
    tolerance: 0.06,
  },
};

// ─── Cheeks Standards ────────────────────────────────────────────────────────

const CHEEKS_STANDARDS: StandardsMap = {
  faceHeightWidthRatio: {
    female: { min: 1.30, max: 1.50, center: 1.40 },
    male:   { min: 1.25, max: 1.45, center: 1.35 },
    unisex: { min: 1.28, max: 1.48, center: 1.38 },
    label: 'Высота / ширина лица',
    unit: '',
    description: 'Высота лица делённая на скуловую ширину — общая форма овала.',
    howToRead: 'Жен. норма 1.30–1.50, муж. 1.25–1.45. Выше нормы → вытянутое лицо. Ниже нормы → широкое лицо; высокие скулы визуально увеличивают этот коэффициент.',
    whyImportant: 'Форма овала лица — базовый параметр, определяющий тип лица (овальное, круглое, вытянутое). От него зависят рекомендации по причёске, макияжу, форме очков и стратегии контурирования.',
    tolerance: 0.08,
  },
  biocularToFaceWidth: {
    female: { min: 0.82, max: 0.92, center: 0.87 },
    male:   { min: 0.84, max: 0.94, center: 0.89 },
    unisex: { min: 0.83, max: 0.93, center: 0.88 },
    label: 'Биокулярная / ширина лица',
    unit: '',
    description: 'Биокулярная ширина (внешние углы глаз) делённая на ширину лица.',
    howToRead: 'Жен. норма 0.82–0.92, муж. 0.84–0.94. Выше нормы → глаза широко расставлены относительно скул. Ниже нормы → широкие скулы выходят далеко за пределы глаз.',
    whyImportant: 'Биокулярная ширина относительно скул показывает, насколько гармонично глаза «вписаны» в контур лица. Высокие, выступающие скулы — признак фотогеничности и чёткого контура лица.',
    tolerance: 0.04,
  },
};

// ─── Neck Standards ──────────────────────────────────────────────────────────

const NECK_STANDARDS: StandardsMap = {
  submentalContourProxyAngle: {
    female: { min: 118, max: 134, center: 126 },
    male:   { min: 113, max: 129, center: 121 },
    unisex: { min: 115, max: 132, center: 123 },
    label: 'Цервикоментальный угол',
    unit: '°',
    description: 'Угол между нижней поверхностью подбородка и передней линией шеи.',
    howToRead: 'Жен. норма 118–134°, муж. 113–129°. Ниже нормы → острый угол, шея смотрится длинной и чёткой. Выше нормы → тупой угол, подбородочно-шейный контур менее выражен.',
    whyImportant: 'Цервикоментальный угол — важнейший параметр профиля шеи и подбородка. Чёткий угол ассоциируется с молодостью и подтянутостью. С возрастом этот угол сглаживается, что является одним из главных показаний к подтяжке шеи.',
    tolerance: 8,
  },
};

// ─── Profile (Soft-tissue) Standards ─────────────────────────────────────────

const NOSE_PROFILE_STANDARDS: StandardsMap = {
  noseProjectionRatio: {
    female: { min: 0.06, max: 0.14, center: 0.10 },
    male:   { min: 0.07, max: 0.15, center: 0.11 },
    unisex: { min: 0.06, max: 0.15, center: 0.10 },
    label: 'Проекция носа (профиль)',
    unit: '',
    description: 'Насколько далеко кончик носа выступает вперёд относительно вертикальной линии лица.',
    howToRead: 'Жен. норма 0.06–0.14, муж. 0.07–0.15. Выше нормы → слишком выдающийся нос. Ниже нормы → нос недостаточно выступает, «плоская» проекция.',
    whyImportant: 'Проекция носа в профиле — ключевой параметр ринопластики. Гармоничный вынос носа создаёт сбалансированный профиль, не доминируя над другими чертами и обеспечивая плавный переход от лба к губам.',
    tolerance: 0.03,
  },
  nasofrontalAngle: {
    female: { min: 130, max: 145, center: 137 },
    male:   { min: 125, max: 140, center: 132 },
    unisex: { min: 125, max: 145, center: 135 },
    label: 'Угол переносицы',
    unit: '°',
    description: 'Угол между лбом и спинкой носа в точке переносицы — насколько плавно лоб переходит в нос.',
    howToRead: 'Жен. норма 130–145°, муж. 125–140°. Ниже нормы → резкий переход, горбинка. Выше нормы → плавный, сглаженный профиль без выраженной переносицы.',
    whyImportant: 'Этот угол определяет, насколько «чётким» выглядит переход от лба к носу. Слишком малый угол часто означает горбинку на носу.',
    tolerance: 6,
  },
  nasolabialAngle: {
    female: { min: 95, max: 115, center: 105 },
    male:   { min: 88, max: 105, center: 95 },
    unisex: { min: 90, max: 110, center: 100 },
    label: 'Угол кончика носа',
    unit: '°',
    description: 'Угол между основанием носа и верхней губой — насколько кончик носа смотрит вверх или вниз.',
    howToRead: 'Жен. норма 95–115°, муж. 88–105°. Ниже нормы → кончик носа опущен вниз. Выше нормы → нос вздёрнут, видны ноздри в профиль.',
    whyImportant: 'Этот угол определяет, выглядит ли нос «вздёрнутым» или «опущенным» в профиль. Один из ключевых параметров при коррекции носа.',
    tolerance: 6,
  },
  softTissue_nPrnRatio: {
    female: { min: 0.35, max: 0.55, center: 0.45 },
    male:   { min: 0.38, max: 0.58, center: 0.48 },
    unisex: { min: 0.36, max: 0.56, center: 0.46 },
    label: 'Носовая проекция (мягк. ткани)',
    unit: '',
    description: 'Длина носа относительно общей высоты профиля лица от переносицы до подбородка.',
    howToRead: 'Жен. норма 0.35–0.55, муж. 0.38–0.58. Выше нормы → нос занимает большую часть высоты лица в профиле. Ниже нормы → нос маленький или короткий.',
    whyImportant: 'Мягкотканевая проекция носа показывает, какую долю высоты профиля занимает нос. Этот параметр помогает оценить общую гармонию профиля без привязки к костным ориентирам.',
    tolerance: 0.06,
  },
  softTissue_cmSnRatio: {
    female: { min: 0.02, max: 0.08, center: 0.05 },
    male:   { min: 0.02, max: 0.08, center: 0.05 },
    unisex: { min: 0.02, max: 0.08, center: 0.05 },
    label: 'Видимая часть основания носа',
    unit: '',
    description: 'Длина видимой части между кончиком носа и верхней губой, относительно высоты профиля.',
    howToRead: 'Норма 0.02–0.08. Выше нормы → ноздри заметно видны снизу. Ниже нормы → основание носа короткое, кончик «тупой».',
    whyImportant: 'Влияет на то, насколько ноздри видны при взгляде в профиль. Определяет пропорции кончика носа.',
    tolerance: 0.02,
  },
};

const CHIN_PROFILE_STANDARDS: StandardsMap = {
  chinProjectionRatio: {
    female: { min: -0.10, max: 0.05, center: -0.02 },
    male:   { min: -0.06, max: 0.08, center: 0.01 },
    unisex: { min: -0.08, max: 0.06, center: -0.01 },
    label: 'Проекция подбородка (профиль)',
    unit: '',
    description: 'Насколько подбородок выступает вперёд или уходит назад относительно вертикальной линии профиля.',
    howToRead: 'Жен. норма –0.10…+0.05, муж. –0.06…+0.08. Положительные значения → подбородок выступает вперёд (прогения). Отрицательные → подбородок отступает назад (ретрогения).',
    whyImportant: 'Проекция подбородка — основа сбалансированного профиля. Недостаточный подбородок (ретрогения) визуально «укорачивает» лицо и может усилить проекцию носа. Коррекция подбородка — одна из самых эффективных процедур для улучшения профиля.',
    tolerance: 0.04,
  },
  softTissue_lsPgRatio: {
    female: { min: 0.40, max: 0.65, center: 0.52 },
    male:   { min: 0.42, max: 0.68, center: 0.55 },
    unisex: { min: 0.40, max: 0.66, center: 0.53 },
    label: 'Высота нижней части профиля',
    unit: '',
    description: 'Расстояние от верхней губы до подбородка, относительно общей высоты профиля.',
    howToRead: 'Жен. норма 0.40–0.65, муж. 0.42–0.68. Выше нормы → удлинённая нижняя треть лица в профиле. Ниже нормы → компактная нижняя часть.',
    whyImportant: 'Пропорция нижней части лица в профиле определяет визуальный вес и баланс. Удлинённая нижняя треть может указывать на скелетные особенности прикуса.',
    tolerance: 0.06,
  },
  softTissue_gNRatio: {
    female: { min: 0.06, max: 0.18, center: 0.12 },
    male:   { min: 0.06, max: 0.18, center: 0.12 },
    unisex: { min: 0.06, max: 0.18, center: 0.12 },
    label: 'Глубина надбровья (мягк. ткани)',
    unit: '',
    description: 'Насколько глубоко переносица «утоплена» относительно надбровных дуг.',
    howToRead: 'Норма 0.06–0.18. Выше нормы → выраженное надбровье, глубокая переносица. Ниже нормы → плоский профиль в зоне надбровных дуг.',
    whyImportant: 'Глубина надбровья создаёт «скульптурность» профиля. Выраженные надбровные дуги ассоциируются с маскулинностью, а плавный переход — с женственностью. Этот параметр определяет теневой рисунок в верхней трети лица.',
    tolerance: 0.04,
  },
};

const LIPS_PROFILE_STANDARDS: StandardsMap = {
  lipProjectionRatio: {
    female: { min: -0.02, max: 0.08, center: 0.03 },
    male:   { min: -0.04, max: 0.06, center: 0.01 },
    unisex: { min: -0.03, max: 0.07, center: 0.02 },
    label: 'Выступание губ в профиль',
    unit: '',
    description: 'Насколько губы выступают вперёд относительно воображаемой линии от кончика носа до подбородка.',
    howToRead: 'Жен. норма –0.02…+0.08, муж. –0.04…+0.06. Выше нормы → губы сильно выступают вперёд. Ниже нормы → губы уходят назад, профиль «плоский».',
    whyImportant: 'Линия от носа до подбородка — классический ориентир для оценки профиля губ. Губы, слегка касающиеся или чуть не доходящие до неё, создают гармоничный профиль.',
    tolerance: 0.03,
  },
  softTissue_snLsRatio: {
    female: { min: 0.08, max: 0.20, center: 0.14 },
    male:   { min: 0.08, max: 0.18, center: 0.13 },
    unisex: { min: 0.08, max: 0.19, center: 0.13 },
    label: 'Высота верхней губы (мягк. ткани)',
    unit: '',
    description: 'Высота верхней губы от основания носа до края губы, относительно высоты профиля.',
    howToRead: 'Жен. норма 0.08–0.20, муж. 0.08–0.18. Выше нормы → длинная верхняя губа в профиле. Ниже нормы → короткая верхняя губа, зубы могут быть видны в покое.',
    whyImportant: 'Высота верхней губы влияет на «показ» зубов в покое и при улыбке. Оптимальная длина обеспечивает гармоничную улыбку — 2-3 мм верхних зубов видны в расслабленном положении.',
    tolerance: 0.04,
  },
  softTissue_lipProtrusion: {
    female: { min: -0.05, max: 0.15, center: 0.05 },
    male:   { min: -0.08, max: 0.12, center: 0.02 },
    unisex: { min: -0.06, max: 0.14, center: 0.04 },
    label: 'Выступание губ (профиль)',
    unit: '',
    description: 'Насколько губы выдвинуты вперёд относительно линии подбородок–нос.',
    howToRead: 'Жен. норма –0.05…+0.15, муж. –0.08…+0.12. Выше нормы → губы сильно выступают вперёд. Ниже нормы → губы уходят назад.',
    whyImportant: 'Протрузия губ определяет объёмность и выразительность профиля в зоне рта. Умеренная протрузия создаёт привлекательный, «сочный» профиль, а ретрузия — более строгий, сдержанный.',
    tolerance: 0.04,
  },
};

// ─── East Asian Population Overrides ─────────────────────────────────────────
// Sources: Farkas et al. 2005, Sim et al. 2000, Gu et al. 2011
// Conservative (wide) ranges used due to high intra-population variance.

type PopulationOverrides = Partial<Record<string, Partial<Pick<IdealRange, 'female' | 'male' | 'unisex'>>>>;

const EAST_ASIAN_NOSE: PopulationOverrides = {
  alarWidthToIntercanthal: {
    female: { min: 0.95, max: 1.30, center: 1.12 },
    male:   { min: 1.00, max: 1.35, center: 1.18 },
    unisex: { min: 0.95, max: 1.32, center: 1.15 },
  },
  alarWidthToIPD: {
    female: { min: 0.62, max: 0.82, center: 0.72 },
    male:   { min: 0.65, max: 0.85, center: 0.75 },
    unisex: { min: 0.63, max: 0.83, center: 0.73 },
  },
  nasolabialAngle: {
    female: { min: 90, max: 110, center: 100 },
    male:   { min: 85, max: 102, center: 93 },
    unisex: { min: 88, max: 106, center: 97 },
  },
};

const EAST_ASIAN_EYES: PopulationOverrides = {
  intercanthalToEyeWidth: {
    female: { min: 0.95, max: 1.25, center: 1.10 },
    male:   { min: 0.95, max: 1.25, center: 1.10 },
    unisex: { min: 0.95, max: 1.25, center: 1.10 },
  },
};

const EAST_ASIAN_JAW: PopulationOverrides = {
  faceHeightWidthRatio: {
    female: { min: 1.22, max: 1.42, center: 1.32 },
    male:   { min: 1.18, max: 1.38, center: 1.28 },
    unisex: { min: 1.20, max: 1.40, center: 1.30 },
  },
};

const EAST_ASIAN_CHEEKS: PopulationOverrides = {
  faceHeightWidthRatio: EAST_ASIAN_JAW.faceHeightWidthRatio,
};

// Map: featureName → population → overrides
const POPULATION_OVERRIDES: Partial<Record<FeatureName, Partial<Record<PopulationGroup, PopulationOverrides>>>> = {
  Nose: { east_asian: EAST_ASIAN_NOSE },
  Eyes: { east_asian: EAST_ASIAN_EYES },
  Jaw: { east_asian: EAST_ASIAN_JAW },
  Cheeks: { east_asian: EAST_ASIAN_CHEEKS },
};

// ─── Golden Ratio Derived ────────────────────────────────────────────────────
// φ = 1.618 — applied to vertical facial proportions per neoclassical canons
// totalFace / lowerTwoThirds ≈ φ means upper third ≈ 38.2% (1 - 1/φ)
// This maps to faceThirdUpper being ~0.33 and lower two thirds ~0.67
// We express it as upper_third / lower_two_thirds which should ≈ 0.50 (1:2)
// More practically, we check the middle+lower ratio which should ≈ φ × upper

// ─── Feature → Standards Map ─────────────────────────────────────────────────

const FEATURE_STANDARDS: Partial<Record<FeatureName, StandardsMap>> = {
  Eyebrows: EYEBROW_STANDARDS,
  Eyes: EYES_STANDARDS,
  Nose: { ...NOSE_STANDARDS, ...NOSE_PROFILE_STANDARDS },
  Lips: { ...LIPS_STANDARDS, ...LIPS_PROFILE_STANDARDS },
  Jaw: JAW_STANDARDS,
  Chin: { ...CHIN_STANDARDS, ...CHIN_PROFILE_STANDARDS },
  Cheeks: CHEEKS_STANDARDS,
  Neck: NECK_STANDARDS,
};

// ─── Computation ─────────────────────────────────────────────────────────────

function evaluateStatus(
  value: number,
  min: number,
  max: number,
  tolerance: number,
): 'ideal' | 'close' | 'deviation' {
  if (value >= min && value <= max) return 'ideal';
  const distFromRange = value < min ? min - value : value - max;
  if (distFromRange <= tolerance) return 'close';
  return 'deviation';
}

const PROPORTION_CONTEXT_EN: Record<string, string> = {
  browToEyeDistance: 'brow-to-eye spacing',
  rightArchAngle: 'right eyebrow arch geometry',
  leftArchAngle: 'left eyebrow arch geometry',
  rightEAR: 'right eye aperture',
  leftEAR: 'left eye aperture',
  intercanthalToEyeWidth: 'intercanthal-to-eye-width proportion',
  facialWidthToEyeWidth: 'facial fifths balance',
  alarWidthToIntercanthal: 'nose width relative to the eye base',
  alarWidthToIPD: 'nose width relative to interpupillary distance',
  noseLengthRatio: 'nose length relative to face height',
  upperLowerRatio: 'upper-to-lower lip balance',
  mouthWidthToIPD: 'mouth width relative to interpupillary distance',
  mouthToNoseWidthRatio: 'mouth-to-nose width balance',
  cornerTilt: 'mouth corner line direction',
  jawWidthRatio: 'jawline width balance',
  vShapeProxy: 'V-shape tendency of the lower face',
  faceHeightWidthRatio: 'overall face shape ratio',
  chinHeightRatio: 'chin height balance',
  faceThirdUpper: 'upper facial third',
  faceThirdMiddle: 'middle facial third',
  faceThirdLower: 'lower facial third',
  lowerFaceRatio: 'upper-vs-lower segment of the lower third',
  biocularToFaceWidth: 'eye span relative to face width',
  submentalContourProxyAngle: 'neck-chin contour angle',
  noseProjectionRatio: 'nasal projection in profile',
  nasofrontalAngle: 'forehead-to-nose transition angle',
  nasolabialAngle: 'nose-to-upper-lip angle',
  softTissue_nPrnRatio: 'soft-tissue nasal projection',
  softTissue_cmSnRatio: 'visible nose base length',
  chinProjectionRatio: 'chin projection in profile',
  softTissue_lsPgRatio: 'soft-tissue lower-face height in profile',
  softTissue_gNRatio: 'soft-tissue brow ridge depth',
  lipProjectionRatio: 'lip projection in profile',
  softTissue_snLsRatio: 'soft-tissue upper lip height',
  softTissue_lipProtrusion: 'soft-tissue lip protrusion',
  _goldenRatioVertical: 'vertical golden-ratio reference',
};

const PROPORTION_DIRECTION_EN: Record<string, string> = {
  rightEAR: 'Higher values indicate a more open eye; lower values indicate a narrower aperture.',
  leftEAR: 'Higher values indicate a more open eye; lower values indicate a narrower aperture.',
  intercanthalToEyeWidth: 'Higher values suggest wider-set eyes; lower values suggest closer-set eyes.',
  facialWidthToEyeWidth: 'Higher values suggest relatively narrower eyes or broader face width; lower values suggest larger eye width relative to face.',
  alarWidthToIntercanthal: 'Higher values indicate a wider nose base relative to the eye base; lower values indicate a narrower nose base.',
  alarWidthToIPD: 'Higher values indicate a wider nose relative to pupil distance; lower values indicate a narrower nose.',
  noseLengthRatio: 'Higher values indicate a relatively longer nose; lower values indicate a shorter nose.',
  upperLowerRatio: 'Higher values indicate upper-lip dominance; lower values indicate lower-lip dominance.',
  mouthWidthToIPD: 'Higher values indicate a wider mouth relative to eye spacing; lower values indicate a narrower mouth.',
  mouthToNoseWidthRatio: 'Higher values indicate a mouth that is wider relative to the nose; lower values indicate a relatively wider nose or narrower mouth.',
  cornerTilt: 'Higher values indicate more upturned corners; lower values indicate flatter or downturned corners.',
  jawWidthRatio: 'Higher values indicate a broader jawline; lower values indicate a narrower jawline.',
  vShapeProxy: 'Lower values indicate a stronger V-line tendency; higher values indicate a squarer lower face.',
  faceHeightWidthRatio: 'Higher values indicate a longer face shape; lower values indicate a wider/rounder shape.',
  chinHeightRatio: 'Higher values indicate a taller chin segment; lower values indicate a shorter chin segment.',
  faceThirdUpper: 'Values near one-third indicate balanced facial thirds.',
  faceThirdMiddle: 'Values near one-third indicate balanced facial thirds.',
  faceThirdLower: 'Values near one-third indicate balanced facial thirds.',
  lowerFaceRatio: 'Higher values indicate a relatively longer upper segment of the lower third; lower values indicate a longer lower segment.',
  biocularToFaceWidth: 'Higher values indicate a larger eye span relative to face width; lower values indicate a broader midface relative to eye span.',
  submentalContourProxyAngle: 'Higher values indicate a blunter neck-chin contour; lower values indicate a sharper contour.',
  noseProjectionRatio: 'Higher values indicate stronger projection; lower values indicate flatter projection.',
  nasofrontalAngle: 'Higher values indicate a smoother forehead-nose transition; lower values indicate a sharper transition.',
  nasolabialAngle: 'Higher values indicate a more upturned tip/lip angle; lower values indicate a more acute angle.',
  softTissue_nPrnRatio: 'Higher values indicate greater soft-tissue nasal projection; lower values indicate lower projection.',
  softTissue_cmSnRatio: 'Higher values indicate a longer visible nose base section; lower values indicate a shorter one.',
  chinProjectionRatio: 'Higher values indicate a more projecting chin; lower values indicate a retrusive chin.',
  softTissue_lsPgRatio: 'Higher values indicate a longer lower-face profile segment; lower values indicate a shorter segment.',
  softTissue_gNRatio: 'Higher values indicate deeper brow-ridge profile depth; lower values indicate a flatter depth.',
  lipProjectionRatio: 'Higher values indicate more projected lips; lower values indicate more retrusive lips.',
  softTissue_snLsRatio: 'Higher values indicate a longer upper lip segment in profile; lower values indicate a shorter segment.',
  softTissue_lipProtrusion: 'Higher values indicate stronger lip protrusion; lower values indicate less protrusion.',
  _goldenRatioVertical: 'Values closer to the target band indicate better alignment with the historical golden-ratio reference.',
};

function formatRangeNumber(value: number, unit: string): string {
  if (unit === '°') {
    return Number(value.toFixed(1)).toString();
  }
  const abs = Math.abs(value);
  if (abs >= 100) return Math.round(value).toString();
  if (abs >= 10) return Number(value.toFixed(1)).toString();
  if (abs >= 1) return Number(value.toFixed(3)).toString();
  return Number(value.toFixed(3)).toString();
}

function formatRange(min: number, max: number, unit: string): string {
  const suffix = unit === '°' ? '°' : '';
  return `${formatRangeNumber(min, unit)}–${formatRangeNumber(max, unit)}${suffix}`;
}

function sameRange(a: { min: number; max: number }, b: { min: number; max: number }): boolean {
  return Math.abs(a.min - b.min) < 1e-9 && Math.abs(a.max - b.max) < 1e-9;
}

function buildHowToReadEn(key: string, standard: IdealRange): string {
  const femaleRange = formatRange(standard.female.min, standard.female.max, standard.unit);
  const maleRange = formatRange(standard.male.min, standard.male.max, standard.unit);
  const rangeText = sameRange(standard.female, standard.male)
    ? `Typical range: ${femaleRange}.`
    : `Typical range: female ${femaleRange}; male ${maleRange}.`;
  const direction =
    PROPORTION_DIRECTION_EN[key] ??
    'Higher values indicate a relatively larger proportion; lower values indicate a relatively smaller proportion.';
  return `${rangeText} ${direction}`;
}

function buildWhyImportantEn(key: string): string {
  const context = PROPORTION_CONTEXT_EN[key] ?? 'facial proportion';
  return `This metric helps assess ${context} and overall facial harmony. It is an aesthetic reference, not a diagnosis.`;
}

/**
 * Compute proportion analysis for a given feature.
 * Returns null if the feature has no proportion standards
 * or if there are no numeric measurements to evaluate.
 *
 * @param population  Population group for range adjustment (default: 'default')
 */
export function computeProportions(
  featureName: FeatureName,
  measurements: Record<string, number | string>,
  gender: Gender | null,
  population: PopulationGroup = 'default',
): FeatureProportions | null {
  const lang = getCurrentLang();
  const isEn = lang === 'en';
  const standards = FEATURE_STANDARDS[featureName];
  if (!standards) return null;

  const effectiveGender: 'female' | 'male' | 'unisex' =
    gender === 'female' || gender === 'male' ? gender : 'unisex';

  // Get population-specific overrides (if any)
  const popOverrides = population !== 'default'
    ? POPULATION_OVERRIDES[featureName]?.[population]
    : undefined;

  const items: ProportionItem[] = [];

  for (const [key, standard] of Object.entries(standards)) {
    const rawValue = measurements[key];
    if (rawValue === undefined || typeof rawValue === 'string') continue;

    // Apply population override if available for this key + gender
    const override = popOverrides?.[key]?.[effectiveGender];
    const range = override ?? standard[effectiveGender];
    const status = evaluateStatus(rawValue, range.min, range.max, standard.tolerance);
    const meta = measurementInfo(key);
    const localizedLabel = isEn && meta.label !== key ? meta.label : standard.label;
    const localizedDescription = isEn
      ? (meta.description || `Quantifies ${PROPORTION_CONTEXT_EN[key] ?? 'a facial proportion'}.`)
      : standard.description;
    const localizedHowToRead = isEn ? buildHowToReadEn(key, standard) : standard.howToRead;
    const localizedWhyImportant = isEn ? buildWhyImportantEn(key) : standard.whyImportant;

    items.push({
      key,
      label: localizedLabel,
      userValue: rawValue,
      idealMin: range.min,
      idealMax: range.max,
      idealCenter: range.center,
      unit: standard.unit,
      description: localizedDescription,
      howToRead: localizedHowToRead,
      whyImportant: localizedWhyImportant,
      status,
    });
  }

  // ─── Derived: Golden Ratio (Chin card) ─────────────────────────────────────
  // φ ≈ 1.618 — research shows that totalFace / lowerTwoThirds ≈ φ in
  // attractive faces. We compute it from faceThirdUpper: ratio = 1 / (1 - upper).
  if (featureName === 'Chin') {
    const upper = measurements.faceThirdUpper;
    const middle = measurements.faceThirdMiddle;
    const lower = measurements.faceThirdLower;
    if (typeof upper === 'number' && typeof middle === 'number' && typeof lower === 'number') {
      const lowerTwoThirds = middle + lower;
      if (lowerTwoThirds > 0) {
        const phiProxy = 1.0 / lowerTwoThirds; // totalFace (=1) / lowerTwoThirds
        const phiStatus = evaluateStatus(phiProxy, 1.45, 1.75, 0.12);
        items.push({
          key: '_goldenRatioVertical',
          label: isEn ? 'Golden Ratio (φ) — reference' : 'Золотое сечение (φ) — справка',
          userValue: Math.round(phiProxy * 1000) / 1000,
          idealMin: 1.45,
          idealMax: 1.75,
          idealCenter: 1.618,
          unit: '',
          description: isEn
            ? 'Total face height divided by the sum of the middle and lower thirds.'
            : 'Полная высота лица делённая на сумму средней и нижней третей.',
          howToRead: isEn
            ? 'Historical canon: φ ≈ 1.618. Modern studies did not confirm a direct link with attractiveness; this item is shown for reference.'
            : 'Исторический канон φ ≈ 1.618. Научные исследования (Kiekens 2008, AJODO) не подтвердили связь с привлекательностью. Показывается как справка.',
          whyImportant: isEn
            ? 'The golden ratio is a historical aesthetic reference from classical mathematics. It can be used as context but not as a diagnostic criterion.'
            : 'Золотое сечение (φ ≈ 1.618) — исторический канон красоты, восходящий к древнегреческой математике. Хотя современные исследования не подтвердили прямую связь с привлекательностью, это остаётся популярным ориентиром в эстетической медицине.',
          status: phiStatus,
          informational: true, // excluded from scoring per Kiekens et al. (2008)
        });
      }
    }
  }

  if (items.length === 0) return null;

  return {
    featureName,
    items,
    note: effectiveGender === 'unisex'
      ? (isEn
        ? 'Average ranges are shown. Select gender in the survey for personalized standards.'
        : 'Показаны усреднённые нормы. Укажите пол в анкете для персонализированных стандартов.')
      : undefined,
  };
}
