import type { Lang } from './language';

const EXACT_RU_TO_EN: Record<string, string> = {
  'Брови демонстрируют хорошую двустороннюю симметрию': 'Eyebrows demonstrate good bilateral symmetry.',
  'Обнаружена легкая асимметрия бровей': 'Mild eyebrow asymmetry detected.',
  'Выраженная асимметрия между бровями': 'Pronounced asymmetry between eyebrows detected.',
  'Брови расположены близко к линии глаз': 'Eyebrows are positioned close to the eye line.',
  'Брови расположены высоко относительно линии глаз': 'Eyebrows are positioned relatively high above the eye line.',
  'Профильные снимки предоставлены — форма бровей оценена только по фронтальному ракурсу':
    'Profile photos provided — eyebrow shape is assessed from the frontal view only.',
  'Параметры глаз находятся в типичном диапазоне': 'Eye parameters are within a typical range.',
  'Нос выглядит относительно узким': 'The nose appears relatively narrow.',
  'Нос выглядит относительно широким': 'The nose appears relatively wide.',
  'Ширина носа в типичном пропорциональном диапазоне': 'Nose width is within a typical proportional range.',
  'Обнаружена небольшая асимметрия носа': 'Mild nasal asymmetry detected.',
  'Пропорции носа в типичном диапазоне для фронтальной оценки':
    'Nasal proportions are within a typical range for frontal assessment.',
  'Форма лица ближе к круглой/широкой — щеки могут выглядеть более объёмными':
    'Face shape is closer to round/wide — cheeks may appear fuller.',
  'Форма лица ближе к квадратной/средней — ниже типичного овального диапазона':
    'Face shape is closer to square/medium — below the typical oval range.',
  'Пропорции лица в типичном овальном диапазоне': 'Facial proportions are within a typical oval range.',
  'Форма лица ближе к вытянутой/удлинённой — щеки могут выглядеть более узкими':
    'Face shape is closer to elongated/long — cheeks may appear narrower.',
  'Оценка щек выполнена по фронтальному и профильному ракурсам':
    'Cheek assessment was performed using frontal and profile views.',
  'Оценка щек по одному фронтальному изображению ограничена':
    'Cheek assessment from a single frontal image is limited.',
  'Лицо заметно сужается к подбородку (тенденция к V-форме)':
    'The face narrows noticeably toward the chin (V-shape tendency).',
  'Челюсть выглядит шире лба (тенденция к квадратной/прямоугольной форме)':
    'The jaw appears wider than the forehead (square/rectangular tendency).',
  'Соотношение челюсти и лба в сбалансированном диапазоне':
    'Jaw-to-forehead ratio is in a balanced range.',
  'Обнаружена небольшая асимметрия челюсти': 'Mild jaw asymmetry detected.',
  'Верхняя губа выглядит тоньше относительно нижней':
    'The upper lip appears thinner relative to the lower lip.',
  'Верхняя губа выглядит более выраженной относительно нижней':
    'The upper lip appears more pronounced relative to the lower lip.',
  'Пропорции губ в распространенном диапазоне': 'Lip proportions are within a common range.',
  'Уголки рта слегка направлены вниз — это может зависеть от мимики':
    'Mouth corners are slightly downturned — this may depend on facial expression.',
  'Уголки рта слегка направлены вверх': 'Mouth corners are slightly upturned.',
  'Пропорции губ оценены в типичном диапазоне для фронтального кадра':
    'Lip proportions are within a typical range for a frontal frame.',
  'Трети лица хорошо сбалансированы': 'Facial thirds are well balanced.',
  'Есть дисбаланс в пропорциях третей лица': 'There is an imbalance in facial thirds proportions.',
  'Нижняя треть выглядит относительно длинной': 'The lower third appears relatively long.',
  'Нижняя треть выглядит относительно короткой': 'The lower third appears relatively short.',
  'Пиксельный анализ кожи не выполнен — данные изображения недоступны':
    'Pixel-level skin analysis was not performed — image data unavailable.',
  'Уровень покраснения в выбранных зонах низкий':
    'Redness level is low in the selected regions.',
  'Дисклеймер': 'Disclaimer',
  'Этот анализ предназначен только для образовательных и демонстрационных целей. Он не является медицинской, дерматологической или косметологической рекомендацией. Автоматический анализ лица по одному 2D-изображению имеет объективные ограничения точности и не должен использоваться для клинических решений. Для персональных рекомендаций обращайтесь к квалифицированным специалистам.':
    'This analysis is for educational and demonstration purposes only. It is not medical, dermatological, or cosmetic advice. Automated facial analysis from a single 2D image has objective accuracy limitations and must not be used for clinical decisions. For personalized recommendations, consult qualified specialists.',
};

const FEATURE_RU_TO_EN: Record<string, string> = {
  Брови: 'Eyebrows',
  Глаза: 'Eyes',
  Нос: 'Nose',
  Щёки: 'Cheeks',
  Челюсть: 'Jaw',
  Губы: 'Lips',
  Подбородок: 'Chin',
  Кожа: 'Skin',
  Шея: 'Neck',
  Уши: 'Ears',
  Волосы: 'Hair',
};

const STANDARD_LEVEL: Record<string, string> = {
  высокое: 'high',
  частичное: 'partial',
  низкое: 'low',
};

const REGEX_RULES: Array<[RegExp, (...args: string[]) => string]> = [
  [/^Угол арки: справа (.+), слева (.+)$/i, (a, b) => `Arch angle: right ${a}, left ${b}`],
  [/^Индекс симметрии: (.+)$/i, (a) => `Symmetry index: ${a}`],
  [/^Расстояние бровь-глаз \(нормализованное\): (.+)$/i, (a) => `Brow-eye distance (normalized): ${a}`],
  [/^Длина бровей \(прокси\): (.+)$/i, (a) => `Brow length (proxy): ${a}`],
  [/^Открытость глаз \(EAR\): справа (.+), слева (.+)$/i, (a, b) => `Eye openness (EAR): right ${a}, left ${b}`],
  [/^Симметрия глаз: (.+)$/i, (a) => `Eye symmetry: ${a}`],
  [/^Межзрачковое расстояние \(нормализованное\): (.+)$/i, (a) => `Interpupillary distance (normalized): ${a}`],
  [/^Соотношение межкантального расстояния к ширине глаза: (.+)$/i, (a) => `Intercanthal-to-eye-width ratio: ${a}`],
  [/^Кантальный наклон: справа (.+), слева (.+)$/i, (a, b) => `Canthal tilt: right ${a}, left ${b}`],
  [/^Соотношение ширины носа \(alar\/IPD\): (.+)$/i, (a) => `Nose width ratio (alar/IPD): ${a}`],
  [/^Соотношение ширины носа к межкантальному расстоянию: (.+)$/i, (a) => `Nose width to intercanthal ratio: ${a}`],
  [/^Соотношение длины носа \(к высоте лица\): (.+)$/i, (a) => `Nose length ratio (to face height): ${a}`],
  [/^Индекс симметрии носа: (.+)$/i, (a) => `Nose symmetry index: ${a}`],
  [/^Проекция носа \(профиль\): (.+)$/i, (a) => `Nose projection (profile): ${a}`],
  [/^Носолобный угол \(профиль\): (.+)$/i, (a) => `Nasofrontal angle (profile): ${a}`],
  [/^Носогубный угол \(профиль\): (.+)$/i, (a) => `Nasolabial angle (profile): ${a}`],
  [/^Соотношение высоты и ширины лица: (.+)$/i, (a) => `Face height-to-width ratio: ${a}`],
  [/^Бикулярная ширина к ширине лица: (.+)$/i, (a) => `Biocular-to-face-width ratio: ${a}`],
  [/^Однородность кожи щек: (.+)$/i, (a) => `Cheek skin uniformity: ${a}`],
  [/^Соотношение ширины челюсти \(к ширине лица\): (.+)$/i, (a) => `Jaw width ratio (to face width): ${a}`],
  [/^Прокси V-формы \(челюсть\/лоб\): (.+)$/i, (a) => `V-shape proxy (jaw/forehead): ${a}`],
  [/^Симметрия челюсти: (.+)$/i, (a) => `Jaw symmetry: ${a}`],
  [/^Гониальный угол \(профиль\): (.+)$/i, (a) => `Gonial angle (profile): ${a}`],
  [/^Соотношение верхней\/нижней губы: (.+)$/i, (a) => `Upper/lower lip ratio: ${a}`],
  [/^Ширина рта \(к IPD\): (.+)$/i, (a) => `Mouth width (to IPD): ${a}`],
  [/^Ширина рта к ширине носа: (.+)$/i, (a) => `Mouth-to-nose-width ratio: ${a}`],
  [/^Наклон линии рта: (.+)$/i, (a) => `Mouth line tilt: ${a}`],
  [/^Симметрия губ: (.+)$/i, (a) => `Lip symmetry: ${a}`],
  [/^Соотношение высоты подбородка \(к лицу\): (.+)$/i, (a) => `Chin height ratio (to face): ${a}`],
  [/^Соотношение subnasale→stomion к stomion→menton: (.+)$/i, (a) => `Subnasale→stomion to stomion→menton ratio: ${a}`],
  [/^Яркость кожи \(область щек\): (.+)$/i, (a) => `Skin brightness (cheek region): ${a}`],
  [/^Однородность цвета: (.+)$/i, (a) => `Color uniformity: ${a}`],
  [/^Соответствие стандарту:\s*(высокое|частичное|низкое)\.?$/i, (a) => `Standard alignment: ${STANDARD_LEVEL[a.toLowerCase()] ?? a}.`],
  [/^Соответствие выбранному стандарту (default|east_asian):\s*(высокое|частичное|низкое)\.?$/i, (standard, level) => `Standard alignment with selected ${standard} standard: ${STANDARD_LEVEL[level.toLowerCase()] ?? level}.`],
  [/^Статус:\s*(OK|Monitor|Attention)\.?$/i, (a) => `Status: ${a}.`],
  [/^Параметры:\s*(.+)$/i, (a) => `Parameters: ${a}`],
  [/^Интерпретация выполнена по доступным метрикам и наблюдениям\.?$/i, () => 'Interpretation is based on available metrics and observations.'],
  [/^Зоны улучшения корректируются поэтапно с контролем динамики по тем же индексам\.?$/i, () => 'Improvement areas should be adjusted step-by-step with trend checks using the same indices.'],
  [/^Приоритет:\s*(.+)$/i, (a) => `Priority: ${a}`],
  [/^Косметология:\s*(.+)$/i, (a) => `Cosmetology: ${a}`],
  [/^Инъекции:\s*(.+)$/i, (a) => `Injections: ${a}`],
  [/^Аппаратные:\s*(.+)$/i, (a) => `Device-based: ${a}`],
  [/^Хирургия:\s*(.+)$/i, (a) => `Surgery: ${a}`],
  [/^План контроля:\s*(.+)$/i, (a) => `Follow-up plan: ${a}`],
  [/^Сильная сторона зоны «?([^»"]+)»? — сохранена естественная гармония черт\.?$/i, (a) => {
    const f = FEATURE_RU_TO_EN[a] ?? a;
    return `Strong aspect of the ${f} area — natural harmony is preserved.`;
  }],
  [/^Брови имеют хорошую симметрию( и угол арки)?\.?$/i, () => 'Eyebrows have good symmetry and arch angle.'],
  [/^Угол арки: справа (.+), слева (.+) \(целевой диапазон (.+)\)\.?$/i, (a, b, c) => `Arch angle: right ${a}, left ${b} (target range ${c}).`],
  [/^Соответствие стандарту:\s*(высокое|частичное|низкое)\.?$/i, (a) => `Standard alignment: ${STANDARD_LEVEL[a.toLowerCase()] ?? a}.`],
];

function replaceFeatureNames(text: string): string {
  let out = text;
  for (const [ru, en] of Object.entries(FEATURE_RU_TO_EN)) {
    out = out.replace(new RegExp(ru, 'g'), en);
  }
  return out;
}

export function localizeNarrativeText(text: string, lang: Lang): string {
  if (lang !== 'en' || !text) return text;

  const exact = EXACT_RU_TO_EN[text.trim()];
  if (exact) return exact;

  for (const [rx, fn] of REGEX_RULES) {
    const m = text.match(rx);
    if (m) return fn(...m.slice(1));
  }

  return replaceFeatureNames(text);
}

export function localizeNarrativeList(items: string[], lang: Lang): string[] {
  if (lang !== 'en') return items;
  return items.map((item) => localizeNarrativeText(item, lang));
}
