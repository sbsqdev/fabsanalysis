import OpenAI from 'openai';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function readEnvValueFromFiles(key) {
  const files = [path.resolve(process.cwd(), '.env.local'), path.resolve(process.cwd(), '.env')];
  for (const filePath of files) {
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, 'utf8');
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      if (line.slice(0, eq).trim() !== key) continue;
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      const clean = value.trim();
      if (clean) return clean;
    }
  }
  return undefined;
}

function resolveOpenAIKey() {
  const candidates = [
    process.env.OPENAI_API_KEY,
    process.env.VITE_OPENAI_API_KEY,
    process.env.OPENAI_KEY,
    readEnvValueFromFiles('OPENAI_API_KEY'),
    readEnvValueFromFiles('VITE_OPENAI_API_KEY'),
  ];
  for (const candidate of candidates) {
    const clean = candidate?.trim();
    if (clean) return clean;
  }
  return undefined;
}

function resolveOpenAIModel() {
  return (
    process.env.OPENAI_MODEL?.trim() ||
    process.env.VITE_OPENAI_MODEL?.trim() ||
    readEnvValueFromFiles('OPENAI_MODEL') ||
    readEnvValueFromFiles('VITE_OPENAI_MODEL') ||
    'gpt-4o-mini'
  );
}

function languageLabel(language) {
  return language === 'en' ? 'en' : 'ru';
}

const SYSTEM_PROMPT_RU = `Ты — пластический хирург и эксперт по эстетической медицине. Ты получаешь только структурные метрики лица (НЕ фото) и формируешь клинически-полезные рекомендации на русском языке для клиента косметологической клиники.

Главная цель:
- Не давать общие советы "про бальзамы", если есть выраженные отклонения по пропорциям.
- Давать практичные варианты коррекции: консервативно, косметология/инъекции/аппаратные методики, при показаниях — хирургические опции.
- Каждая рекомендация должна быть привязана к конкретным метрикам и статусу карточки.
- Прямо указывать числовые ориентиры: текущее значение и целевой диапазон/направление улучшения.
- Если в карточке есть proportions, используй их как приоритетный источник для выбора зон улучшения.

Как интерпретировать данные:
1) Для каждой карточки используй status + observations + measurements + confidence.
   Если переданы proportions, сначала разберись с пунктами status="deviation", затем status="close".
2) В aiInsight обязательно укажи:
   - Сначала 1 короткую позитивную фразу о сильной стороне внешности в этой зоне.
   - 2-4 ключевые метрики с числами (что выше/ниже целевого диапазона).
   - При наличии proportions используй формат: "label: userValue при идеале idealMin–idealMax".
   - Во 2-м предложении строго: "Статус: OK|Monitor|Attention".
   - Обязательно отдельной фразой укажи соответствие выбранному стандарту (default/east_asian): "высокое/частичное/низкое".
   - Краткую клиническую интерпретацию (что это означает визуально/пропорционально).
3) Если confidence < 0.35, добавь в aiInsight отдельную фразу о низкой надежности и приоритете пересъёмки.
4) Не повторяй observations дословно — добавляй интерпретацию и тактику.

Профильные soft-tissue метрики (ключи с префиксом softTissue_):
- Учитывай их в карточках nose/lips/chin/jaw/neck при наличии.
- softTissue_confidence < 0.35: профильные выводы помечай как низконадежные.
- softTissue_nPrnRatio: отражает проекцию носа.
- softTissue_nasolabialAngle: <90° чаще связан с ротацией кончика вниз, >120° — с избыточной ротацией.
- softTissue_nasofrontalAngle: тупой угол — более плоский radix/переносица.
- softTissue_lipProtrusion: положительные = протрузия губ, отрицательные = ретрузия.
- softTissue_lsPgRatio: ориентир вертикальной гармонии нижней трети лица.

Популяционные нормы:
- Если population = "east_asian", применяй соответствующие нормы и не помечай типичные для этой популяции значения как отклонения.
- В таком случае формулируй интерпретацию и рекомендации относительно east_asian-стандартов, а не default.

Требования к рекомендациям:
- Структурируй каждый пункт с префиксом из списка:
  * Приоритет:
  * Косметология:
  * Инъекции:
  * Аппаратные:
  * Хирургия:
  * План контроля:
- Для статуса Attention: ровно 5 пунктов, обязательно хотя бы 1 пункт "Хирургия:" и 1 пункт "План контроля:".
- Для статуса Monitor: ровно 4 пункта, обязательно хотя бы 1 пункт из "Косметология|Инъекции|Аппаратные" и 1 пункт "План контроля:".
- Для статуса OK: ровно 3 пункта с поддерживающей тактикой и мониторингом.
- Каждый пункт: 12-24 слова, обязательно связь с конкретной метрикой/пропорцией.
- Указывай реалистичную цель коррекции (например, "сместить nasolabialAngle ближе к диапазону ...", "улучшить upper/lower lip ratio").
- Формат каждого пункта: "<Префикс>: конкретное действие/процедура (метрика — что это значит визуально: currentValue → цель targetValue)". Пример: "Хирургия: Рассмотреть челюстную остеотомию (соотношение высоты/ширины лица: 1.139 → цель 1.4, лицо визуально короче нормы)".
- Если статус Monitor/Attention: минимум 2 пункта должны содержать конкретные названия процедур (например: контурная пластика ГК, ботулинотерапия, SMAS/RF-лифтинг, липофилинг, риносептопластика — только когда уместно по метрикам зоны).
- Жёсткий лимит краткости:
  * aiInsight: 2-3 предложения, максимум 60 слов.
  * Не добавляй вводные и повторения.

Тон и ограничения:
- Тон: профессиональный, спокойный, без оценки привлекательности.
- Подача позитивная и поддерживающая: подчёркивай естественную гармонию и потенциал улучшения, без критичных формулировок.
- Без медицинских диагнозов и категоричных обещаний результата.
- Не использовать расплывчатые фразы без тактики ("попробуйте уход") — всегда указывать метод, цель и что контролировать в динамике.

ВАЖНО: ответ строго JSON-объект без markdown и пояснений вне JSON.

Формат:
{
  "features": [
    {
      "name": "ExactFeatureName",
      "aiInsight": "Интерпретация метрик с числами, статусом и клиническим смыслом.",
      "aiRecommendations": [
        "Приоритет: ...",
        "Косметология: ...",
        "Инъекции: ...",
        "План контроля: ..."
      ]
    }
  ]
}

В массиве features должно быть ровно столько объектов, сколько передано в батче, в порядке входных данных.`;

const SYSTEM_PROMPT_EN = `You are a plastic surgery and aesthetic medicine expert. You receive only structured facial metrics (NO photos) and produce clinically useful recommendations in English.

Core goal:
- Avoid vague generic beauty tips when there are measurable proportional deviations.
- Provide practical correction options: conservative care, cosmetology/injections/device-based options, and surgery when truly indicated.
- Every recommendation must tie directly to specific metrics and feature status.
- Include numeric anchors: current value and target range/direction.
- If proportions are present, use them as the top priority for improvement strategy.

How to interpret:
1) For each card use status + observations + measurements + confidence.
   If proportions are provided, process status="deviation" first, then status="close".
2) aiInsight must include:
   - one short positive opening line about this area;
   - 2-4 key metrics with numbers (what is above/below target range);
   - when proportions are present use: "label: userValue with ideal idealMin-idealMax";
   - in sentence #2 strictly write: "Status: OK|Monitor|Attention";
   - a separate sentence for selected standard match (default/east_asian): "high/partial/low";
   - brief clinical interpretation (visual/proportional meaning).
3) If confidence < 0.35, add a separate sentence stating low reliability and re-capture priority.
4) Do not repeat observations verbatim — add interpretation and tactics.

Soft-tissue profile metrics (keys with softTissue_):
- Use them in nose/lips/chin/jaw/neck cards when available.
- If softTissue_confidence < 0.35, explicitly mark profile conclusions as low-reliability.
- softTissue_nPrnRatio: nose projection.
- softTissue_nasolabialAngle: <90° often means under-rotated tip, >120° over-rotation.
- softTissue_nasofrontalAngle: obtuse angle suggests flatter radix/bridge.
- softTissue_lipProtrusion: positive = lip protrusion, negative = retrusion.
- softTissue_lsPgRatio: lower-face vertical harmony marker.

Population norms:
- If population = "east_asian", apply those norms and do not flag values typical for that population as deviations.
- In that case interpret and recommend relative to east_asian standards, not default.

Recommendation rules:
- Each item must start with one prefix:
  * Priority:
  * Cosmetology:
  * Injections:
  * Device-based:
  * Surgery:
  * Follow-up plan:
- Attention: exactly 5 items, including at least one "Surgery:" and one "Follow-up plan:".
- Monitor: exactly 4 items, including at least one of "Cosmetology|Injections|Device-based" and one "Follow-up plan:".
- OK: exactly 3 items for maintenance + monitoring.
- Each item: 12-24 words, explicitly tied to a concrete metric/proportion.
- Use realistic correction targets.
- Format each item as "<Prefix>: action/procedure (metric — visual meaning: currentValue -> targetValue)".
- For Monitor/Attention include at least 2 concrete procedure names.
- Brevity limits:
  * aiInsight: 2-3 sentences, max 60 words.
  * avoid intros and repetition.

Tone and constraints:
- Professional, calm, no attractiveness judgment.
- Positive/supportive wording that respects natural harmony.
- No medical diagnoses, no guaranteed outcomes.
- No vague generic advice without actionable tactics.

IMPORTANT:
- Return strict JSON object only, no markdown and no text outside JSON.
- If UI language is English, every aiInsight and aiRecommendations item must be in English only.

Format:
{
  "features": [
    {
      "name": "ExactFeatureName",
      "aiInsight": "Interpretation with metrics, status, and clinical meaning.",
      "aiRecommendations": [
        "Priority: ...",
        "Cosmetology: ...",
        "Injections: ...",
        "Follow-up plan: ..."
      ]
    }
  ]
}

The features array must have exactly the same number of objects as the input batch, preserving order.`;

function mapInputStatusToGuidelineStatus(status) {
  if (status === 'attention') return 'Attention';
  if (status === 'within_norm' || status === 'strength') return 'OK';
  return 'Monitor';
}

function parseGuidelineStatus(aiInsight, fallback) {
  if (typeof aiInsight !== 'string') return fallback;
  const match = aiInsight.match(/(?:Статус|Status):\s*(OK|Monitor|Attention)/i);
  if (!match) return fallback;
  const raw = match[1];
  if (raw === 'OK' || raw === 'Monitor' || raw === 'Attention') return raw;
  return fallback;
}

function hasCyrillic(text) {
  return typeof text === 'string' && /[А-Яа-яЁё]/.test(text);
}

function minRecommendationsForStatus(status) {
  if (status === 'Attention') return 5;
  if (status === 'Monitor') return 4;
  return 3;
}

function maxRecommendationsForStatus(status) {
  if (status === 'Attention') return 5;
  if (status === 'Monitor') return 4;
  return 3;
}

function fallbackRecommendationPool(status, language = 'ru') {
  const isEn = language === 'en';
  if (status === 'Attention') {
    if (isEn) {
      return [
        'Priority: start with the metric showing the largest deviation and align a realistic target range with an in-person specialist.',
        'Cosmetology: consider a staged protocol focused on this zone, with before/after photo tracking for each step.',
        'Injections: for persistent volume deficit or imbalance, discuss gradual injectable correction with symmetry checks at each visit.',
        'Device-based: when indicated, add device-based methods to improve tissue quality and support contour definition in the affected area.',
        'Surgery: for significant anatomical mismatch and stable goals, discuss surgical options after in-person morphometric assessment.',
        'Follow-up plan: repeat capture and metric calculation in 4-8 weeks under matching conditions to evaluate trend by the same indices.',
      ];
    }
    return [
      'Приоритет: начните с коррекции метрики с наибольшим отклонением и согласуйте целевой диапазон на очной консультации эстетического специалиста.',
      'Косметология: рассмотрите курс процедур, направленных на улучшение пропорций данной зоны, с фотофиксацией до и после каждого этапа.',
      'Инъекции: при устойчивом дефиците объёма или выраженном дисбалансе обсудите инъекционную коррекцию малыми шагами с контролем симметрии.',
      'Аппаратные: при показаниях добавьте аппаратные методики для улучшения качества тканей и поддержки контуров в зоне отклонения.',
      'Хирургия: при значимом анатомическом несоответствии и стабильном запросе обсудите хирургические варианты после очной морфометрической оценки.',
      'План контроля: повторите съёмку и расчёт метрик через 4-8 недель в одинаковых условиях, чтобы оценить динамику по тем же индексам.',
    ];
  }

  if (status === 'Monitor') {
    if (isEn) {
      return [
        'Priority: focus on 1-2 metrics outside target corridor and avoid changing multiple strategies at once.',
        'Cosmetology: if desired, use gentle staged correction aligned with the current measurable deviations of this card.',
        'Injections: for moderate imbalance, consider micro-correction with repeat proportion checks after treatment.',
        'Follow-up plan: recalculate metrics in 4-6 weeks with the same angle and lighting to confirm stable improvement.',
      ];
    }
    return [
      'Приоритет: сконцентрируйтесь на 1-2 метриках, которые вышли за целевой коридор, и не меняйте сразу несколько тактик одновременно.',
      'Косметология: при желании выполните щадящую этапную коррекцию в клинике, ориентируясь на конкретные отклонения по текущей карточке.',
      'Инъекции: при умеренном дисбалансе можно рассмотреть микро-коррекцию с последующим контролем пропорций через повторный анализ.',
      'План контроля: пересчитайте показатели через 4-6 недель при том же ракурсе и освещении, чтобы проверить стабильность улучшения.',
    ];
  }

  if (isEn) {
    return [
      'Priority: current proportions are close to targets, so keep the current strategy and avoid aggressive correction without indication.',
      'Cosmetology: use maintenance-only procedures when indicated to preserve stable results without overloading tissues.',
      'Follow-up plan: repeat the same photo protocol and analysis every 2-3 months for objective trend monitoring.',
    ];
  }
  return [
    'Приоритет: текущие пропорции близки к целевым, поэтому сохраняйте выбранную тактику и избегайте агрессивной коррекции без показаний.',
    'Косметология: выполняйте только поддерживающие процедуры по показаниям, чтобы удерживать стабильный результат без перегрузки тканей.',
    'План контроля: повторяйте фотопротокол и анализ по тем же условиям каждые 2-3 месяца для объективного мониторинга динамики.',
  ];
}

function expandShortRecommendation(text, language = 'ru') {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (trimmed.length >= 70) return trimmed;
  if (language === 'en') {
    return `${trimmed} Make changes step-by-step and verify trend against the same metrics in 2-6 weeks.`;
  }
  return `${trimmed} Вносите изменения поэтапно и сверяйте динамику по тем же метрикам через 2-6 недель.`;
}

function metricKeyScore(key) {
  const k = String(key || '').toLowerCase();
  let score = 0;
  if (k.includes('softtissue')) score += 4;
  if (k.includes('angle') || k.includes('projection') || k.includes('protrusion')) score += 3;
  if (k.includes('ratio') || k.includes('width') || k.includes('height') || k.includes('tilt')) score += 2;
  if (k.includes('symmetry')) score += 1;
  if (k.includes('confidence')) score -= 10;
  return score;
}

function formatMetricValue(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  const precision = abs >= 100 ? 1 : abs >= 10 ? 2 : 3;
  return value.toFixed(precision).replace(/\.?0+$/, '');
}

function pickMetricHighlights(measurements, limit = 3) {
  const entries = Object.entries(measurements ?? {}).filter(
    ([key, value]) => typeof value === 'number' && Number.isFinite(value) && !String(key).toLowerCase().includes('confidence'),
  );
  if (entries.length === 0) return [];
  return entries
    .sort(([a], [b]) => metricKeyScore(b) - metricKeyScore(a))
    .slice(0, limit)
    .map(([key, value]) => `${key}=${formatMetricValue(value)}`);
}

function pickProportionHighlights(proportions, limit = 2, language = 'ru') {
  if (!Array.isArray(proportions)) return [];
  const idealWord = language === 'en' ? 'ideal' : 'идеал';
  return proportions
    .filter((item) => item && typeof item === 'object' && typeof item.userValue === 'number')
    .sort((a, b) => {
      const rank = { deviation: 2, close: 1, ideal: 0 };
      return (rank[b.status] ?? 0) - (rank[a.status] ?? 0);
    })
    .slice(0, limit)
    .map((item) => {
      const unit = item.unit || '';
      return `${item.label}=${formatMetricValue(item.userValue)}${unit} (${idealWord} ${formatMetricValue(item.idealMin)}-${formatMetricValue(item.idealMax)}${unit})`;
    });
}

function hasMetricAnchor(text) {
  if (typeof text !== 'string') return false;
  return /[A-Za-z_][A-Za-z0-9_]*\s*[:=]\s*-?\d+(?:[.,]\d+)?/.test(text) || /-?\d+(?:[.,]\d+)?\s*°/.test(text);
}

function anchorRecommendationToMetrics(text, metricHint, language = 'ru') {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (!metricHint || hasMetricAnchor(trimmed)) return trimmed;
  if (language === 'en') {
    return `${trimmed} [metric: ${metricHint}; goal: move closer to the target range for this card].`;
  }
  return `${trimmed} [метрика: ${metricHint}; цель: приблизить к целевому диапазону карточки].`;
}

function ensurePositiveInsightTone(text, featureName, language = 'ru') {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  const opener = trimmed.split(/[.!?]/)[0] ?? '';
  if (language === 'en') {
    if (/(strong|harmon|balanced|refined|natural|expressive)/i.test(opener)) return trimmed;
    return `Strong aspect of the "${featureName}" area — natural harmony is preserved. ${trimmed}`;
  }
  if (/(сильн|гармон|сбаланс|эстетич|выразительн|аккурат)/i.test(opener)) return trimmed;
  return `Сильная сторона зоны "${featureName}" — сохранена естественная гармония черт. ${trimmed}`;
}

function truncateWords(text, maxWords) {
  if (typeof text !== 'string') return '';
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(' ').replace(/[,:;.\-–—\s]+$/, '')}.`;
}

function populationLabel(population) {
  return population === 'east_asian' ? 'east_asian' : 'default';
}

function standardMatchFromProportions(proportions, language = 'ru') {
  if (!Array.isArray(proportions) || proportions.length === 0) return language === 'en' ? 'partial' : 'частичное';
  const deviation = proportions.filter((p) => p?.status === 'deviation').length;
  const close = proportions.filter((p) => p?.status === 'close').length;
  if (deviation === 0 && close <= 1) return language === 'en' ? 'high' : 'высокое';
  if (deviation >= 2) return language === 'en' ? 'low' : 'низкое';
  return language === 'en' ? 'partial' : 'частичное';
}

function ensureStandardAlignmentInsight(text, population, proportions, language = 'ru') {
  const standard = populationLabel(population);
  const match = standardMatchFromProportions(proportions, language);
  const clause = language === 'en'
    ? `Standard alignment with selected ${standard} standard: ${match}.`
    : `Соответствие выбранному стандарту ${standard}: ${match}.`;
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return clause;
  if (language === 'en') {
    if (/alignment|standard/i.test(trimmed)) return trimmed;
  } else if (/соответств|стандарт/i.test(trimmed)) {
    return trimmed;
  }
  // Prefix so the clause survives word truncation.
  return `${clause} ${trimmed}`;
}

function isValidAnalyzeResponse(value) {
  return Boolean(value && typeof value === 'object' && Array.isArray(value.features));
}

function stripJsonFences(text) {
  return String(text || '').replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
}

function extractBalancedJsonObject(text) {
  const source = stripJsonFences(text);
  const start = source.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

function extractBalancedArrayAfterFeaturesKey(text) {
  const source = stripJsonFences(text);
  const keyIdx = source.search(/"features"\s*:/);
  if (keyIdx < 0) return null;
  const arrStart = source.indexOf('[', keyIdx);
  if (arrStart < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = arrStart; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '[') depth += 1;
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(arrStart, i + 1);
    }
  }
  return null;
}

function parseAnalyzeResponseLoose(text) {
  const candidates = [];
  const stripped = stripJsonFences(text);
  if (stripped) candidates.push(stripped);
  const balancedObj = extractBalancedJsonObject(stripped);
  if (balancedObj) candidates.push(balancedObj);
  const featureArray = extractBalancedArrayAfterFeaturesKey(stripped);
  if (featureArray) candidates.push(`{"features":${featureArray}}`);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (isValidAnalyzeResponse(parsed)) return parsed;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function normalizeAiResult(parsed, inputFeatures, population = 'default', language = 'ru') {
  const rawFeatures = Array.isArray(parsed?.features) ? parsed.features : [];

  const normalizedFeatures = inputFeatures.map((inputFeature, index) => {
    const byName = rawFeatures.find((f) => f?.name === inputFeature.name);
    const rawFeature = byName ?? rawFeatures[index] ?? {};

    const fallbackStatus = mapInputStatusToGuidelineStatus(inputFeature.status);
    const inferredStatus = parseGuidelineStatus(rawFeature.aiInsight, fallbackStatus);
    const minRecs = minRecommendationsForStatus(inferredStatus);
    const maxRecs = maxRecommendationsForStatus(inferredStatus);
    const proportionHint = pickProportionHighlights(inputFeature.proportions, 2, language).join('; ');
    const metricHint = proportionHint || pickMetricHighlights(inputFeature.measurements, 3).join(', ');
    const fallbackParamText =
      metricHint ||
      Object.entries(inputFeature.measurements ?? {})
        .slice(0, 4)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');

    const rawInsight = typeof rawFeature.aiInsight === 'string' ? rawFeature.aiInsight.trim() : '';
    const canUseRawInsight = rawInsight.length >= 90 && !(language === 'en' && hasCyrillic(rawInsight));
    const baseInsight =
      canUseRawInsight
        ? ensurePositiveInsightTone(rawInsight, inputFeature.name, language)
        : language === 'en'
          ? `Strong aspect of the "${inputFeature.name}" area — natural harmony is preserved. Parameters: ${fallbackParamText || 'insufficient measurements for detailed interpretation'}. Status: ${inferredStatus}. Interpretation is based on available metrics and observations. Improvement areas should be adjusted step-by-step with trend checks using the same indices.`
          : `Сильная сторона зоны "${inputFeature.name}" — сохранена естественная гармония черт. Параметры: ${fallbackParamText || 'измерений недостаточно для детальной интерпретации'}. Статус: ${inferredStatus}. Интерпретация выполнена по доступным метрикам и наблюдениям. Зоны улучшения корректируются поэтапно с контролем динамики по тем же индексам.`;
    const aiInsight = truncateWords(
      ensureStandardAlignmentInsight(baseInsight, population, inputFeature.proportions, language),
      60,
    );

    const rawRecommendations = Array.isArray(rawFeature.aiRecommendations)
      ? rawFeature.aiRecommendations
          .filter((v) => typeof v === 'string' && v.trim().length > 0)
          .filter((v) => !(language === 'en' && hasCyrillic(v)))
          .map((v) => anchorRecommendationToMetrics(expandShortRecommendation(v, language), metricHint, language))
      : [];

    const fallbackPool = fallbackRecommendationPool(inferredStatus, language);
    const aiRecommendations = [...rawRecommendations];
    for (let i = 0; aiRecommendations.length < minRecs && i < fallbackPool.length; i += 1) {
      aiRecommendations.push(anchorRecommendationToMetrics(fallbackPool[i], metricHint, language));
    }
    const compactRecommendations = aiRecommendations
      .slice(0, maxRecs)
      .map((rec) => truncateWords(rec, 24));

    return {
      name: inputFeature.name,
      aiInsight,
      aiRecommendations: compactRecommendations,
    };
  });

  return { features: normalizedFeatures };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk.toString();
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export async function handleAnalyze(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Метод не поддерживается' }));
    return;
  }

  const apiKey = resolveOpenAIKey();
  const model = resolveOpenAIModel();
  if (!apiKey) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error:
          'OPENAI_API_KEY не настроен на сервере. Добавьте ключ в переменные окружения и перезапустите сервис.',
      }),
    );
    return;
  }

  let body;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Некорректный JSON в теле запроса' }));
    return;
  }

  const { features } = body;
  if (!features || !Array.isArray(features) || features.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Требуется массив features' }));
    return;
  }
  const language = languageLabel(body.language);
  const systemPrompt = language === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_RU;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // Force headers to the client immediately — required for SSE to work;
  // without this the browser fetch may hang waiting for the first bytes.
  res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    res.socket?.write(''); // nudge the socket to flush the chunk
  };

  try {
    const client = new OpenAI({ apiKey, timeout: 30_000 });

    const featurePayload = features.map((feature) => {
      const payload = {
        name: feature.name,
        status: feature.status,
        observations: feature.observations,
        measurements: feature.measurements,
        confidence: Math.round(feature.confidence * 100) / 100,
      };
      if (Array.isArray(feature.proportions)) {
        payload.proportions = feature.proportions
          .filter((item) => item && typeof item === 'object')
          .map((item) => ({
            key: item.key,
            label: item.label,
            userValue: item.userValue,
            idealMin: item.idealMin,
            idealMax: item.idealMax,
            status: item.status,
            unit: item.unit,
          }));
      }
      return payload;
    });

    const population = body.population || 'default';
    const populationNote = language === 'en'
      ? population !== 'default'
        ? `\nPopulation: ${population}. Use corresponding population norms.\n`
        : '\nPopulation: default. Use default population norms.\n'
      : population !== 'default'
        ? `\nПопуляция: ${population}. Используй соответствующие популяционные нормы.\n`
        : '\nПопуляция: default. Используй стандартные нормы.\n';

    // Split features into 2 parallel batches for ~2× speedup.
    const mid = Math.ceil(featurePayload.length / 2);
    const batches = [featurePayload.slice(0, mid), featurePayload.slice(mid)];

    const requestBatchStream = async (batch) => {
      const batchStream = await client.chat.completions.create({
        model,
        temperature: 0,
        max_tokens: 3500,
        stream: true,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: language === 'en'
              ? `UI language: English. Output language must be English.${populationNote}\nGenerate concise and accurate recommendations for this facial analysis.\nUse only this data:\n\n${JSON.stringify(batch)}`
              : `Сформируй краткие и точные рекомендации по инструкции анализа лица.${populationNote}\nИспользуй только эти данные:\n\n${JSON.stringify(batch)}`,
          },
        ],
      });

      let batchText = '';
      for await (const chunk of batchStream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          batchText += delta;
          sendEvent({ partial: delta });
        }
      }
      return batchText;
    };

    const requestBatchRetry = async (batch) => {
      const retryResponse = await client.chat.completions.create({
        model,
        temperature: 0,
        max_tokens: 3500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: language === 'en'
              ? `UI language: English. Output language must be English.\nReturn strict JSON only. No prose and no markdown fences.${populationNote}\nUse only this data:\n\n${JSON.stringify(batch)}`
              : `Верни строго JSON без пояснений и без markdown-блоков.${populationNote}\nИспользуй только эти данные:\n\n${JSON.stringify(batch)}`,
          },
        ],
      });
      return retryResponse.choices?.[0]?.message?.content ?? '';
    };

    let parsed;
    try {
      const batchOutputs = await Promise.all(
        batches.map(async (batch) => {
          const text = await requestBatchStream(batch);
          return { batch, text };
        }),
      );

      // Merge parsed features from all batches preserving original order
      const allFeatures = [];
      for (const output of batchOutputs) {
        let batchParsed = parseAnalyzeResponseLoose(output.text);
        if (!batchParsed) {
          const retryText = await requestBatchRetry(output.batch);
          batchParsed = parseAnalyzeResponseLoose(retryText);
        }
        if (!batchParsed) {
          throw new Error('В ответе отсутствует валидный JSON с массивом features');
        }
        allFeatures.push(...batchParsed.features);
      }
      parsed = { features: allFeatures };
    } catch (parseError) {
      console.warn('[/api/analyze] JSON parse fallback activated:', parseError);
      // Fail-safe: keep UX stable by returning deterministic normalized fallback
      // instead of surfacing a hard AI error banner.
      parsed = { features: [] };
    }

    const normalized = normalizeAiResult(parsed, featurePayload, population, language);
    sendEvent({ done: true, result: normalized });
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    console.error('[/api/analyze] Error:', message);

    if (!res.writableEnded) {
      sendEvent({ done: true, error: message });
      res.end();
    }
  }
}
