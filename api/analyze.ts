/**
 * Server API handler: POST /api/analyze
 *
 * Accepts facial landmark measurements (NO images — privacy preserved),
 * calls OpenAI GPT-4o and streams back AI-generated personalized
 * recommendations for each of the 10 features.
 *
 * Response format: Server-Sent Events (SSE)
 *   data: {"partial": "...text chunk..."}   ← streaming text
 *   data: {"done": true, "result": {...}}   ← final parsed JSON
 *   data: {"done": true, "error": "..."}    ← error case
 */

import OpenAI from 'openai';
import type { IncomingMessage, ServerResponse } from 'http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Streaming budget used by serverless hosts that support this hint.
export const maxDuration = 60;

function readEnvValueFromFiles(key: string): string | undefined {
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

function resolveOpenAIKey(): string | undefined {
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

function resolveOpenAIModel(): string {
  return (
    process.env.OPENAI_MODEL?.trim() ||
    process.env.VITE_OPENAI_MODEL?.trim() ||
    readEnvValueFromFiles('OPENAI_MODEL') ||
    readEnvValueFromFiles('VITE_OPENAI_MODEL') ||
    'gpt-4o-mini'
  );
}

type UiLanguage = 'ru' | 'en';

function languageLabel(language?: string): UiLanguage {
  return language === 'en' ? 'en' : 'ru';
}

const SYSTEM_PROMPT_RU = `Ты — косметолог-эксперт по контурной пластике и коррекции губ. На входе — только структурные метрики (НЕ фото). Твоя задача: дать клиенту ясное понимание реального потенциала его губ и мотивировать к записи на профессиональную консультацию.

Контекст: инструмент анализа губ для косметологической клиники ProFace. Клиент хочет понять, можно ли сделать губы красивее, и что именно нужно изменить.

Правила для aiInsight (4–6 предложений, ~110–140 слов — подробно, НЕ одно предложение):
Пиши той же структурой и тем же языком, что и врач ProFace в карточках параметров:
1) Назови ТЕКУЩЕЕ состояние простым языком ("нижняя губа заметно преобладает в объёме", "уголки рта слегка опущены", "ширина рта меньше нормы относительно носа").
2) Объясни, как это читается на лице — визуальный эффект отклонения ("верхняя губа теряется при улыбке", "появляются тени в нижней трети лица", "лицо кажется уставшим или строже", "центр лица выглядит тяжелее").
3) Скажи, ЧТО именно сделает врач — назови процедуру СТРОГО по справочнику ниже.
4) Опиши результат ПОСЛЕ — живо и конкретно ("баланс восстановится, форма рта станет чётче", "уйдут тени, лицо станет свежее и отдохнувшее").
Если показатель В НОРМЕ — искренне это подтверди и предложи только поддерживающую процедуру (лёгкое увлажнение или биоревитализация без добавления объёма). Не используй "Статус:". Пиши тепло, как врач в живом разговоре, без сухого отчёта.

Справочник решений врача (используй СТРОГО эти процедуры под каждое отклонение):
- Верхняя/нижняя губа, преобладает нижняя → восполнить объём ВЕРХНЕЙ губы.
- Верхняя/нижняя губа, преобладает верхняя → аккуратно добавить объём в НИЖНЮЮ губу.
- Ширина рта меньше нормы → добавить объём ближе к УГОЛКАМ, чтобы визуально расширить.
- Ширина рта больше нормы → филлер строго в ЦЕНТР губ, чтобы собрать форму.
- Уголки рта опущены → аккуратно приподнять уголки филлером, убрать тени.
- Уголки рта слишком приподняты → деликатно смягчить контур, выровнять линию рта.
- Выступание/проекция губ меньше нормы → восполнить объём филлером, вывести губы вперёд.
- Выступание/проекция губ больше нормы → филлер НЕ рекомендуется; работа с контуром или увлажнением без объёма.
- Высота верхней губы меньше нормы → сильное увеличение ПРОТИВОПОКАЗАНО; аккуратно подчеркнуть контур.
- Высота верхней губы больше нормы → добавить филлер в верхнюю губу, визуально сократить расстояние.
- Асимметрия губ → выровнять стороны филлером, добавить объём там, где его не хватает.
- Любой показатель В НОРМЕ → только увлажнение/биоревитализация БЕЗ добавления объёма.

Популяционные нормы:
- Если указана популяция east_asian, интерпретируй относительно east_asian-диапазонов.
- Если confidence < 0.35, упомяни, что точность ниже из-за качества фото, и рекомендуй пересъёмку.

Правила для aiRecommendations:
- Статус "attention": 4 пункта — минимум 2 процедуры + 1 "Консультация:" + 1 обоснование.
- Статус "within_norm" или "strength": 3 пункта — поддерживающий уход + 1 "Консультация:".
- Каждый пункт:
  - начинается с префикса: "Процедура:", "Инъекции:", "Контур:", "Консультация:", "Уход:" или "Поддержание:";
  - конкретный (10-22 слова), ссылается на параметр и визуальный результат;
  - содержит название реальной процедуры: "гиалуроновые филлеры", "контуринг Купидова лука", "техника русских губ", "коррекция опущенных углов", "увеличение верхней губы".
- Пункт "Консультация:" всегда: "Консультация: персональный план коррекции губ у специалиста — оценка объёма, техники и ожидаемого результата."
- Не меньше 2 пунктов с конкретными процедурами при любом статусе.

Тон: живой, поддерживающий, мотивирующий — как косметолог, который искренне хочет помочь клиенту стать лучше. Никаких диагнозов, никаких обещаний гарантированного результата.

CRITICAL: Respond ONLY with a valid JSON object. No markdown, no explanation outside JSON.

Output schema:
{
  "features": [
    {
      "name": "ExactFeatureName",
      "aiInsight": "Конкретное описание губ с числами и потенциалом улучшения.",
      "aiRecommendations": [
        "Процедура: ...",
        "Инъекции: ...",
        "Консультация: ..."
      ]
    }
  ]
}

The "features" array must contain exactly as many objects as the input batch, preserving input order.`;

const SYSTEM_PROMPT_EN = `You are an expert cosmetic specialist in lip contouring and augmentation. Input contains only structural metrics (NO photos). Your goal: give the client a clear understanding of their lips' real potential and motivate them to book a professional consultation.

Context: lip analysis tool for the ProFace cosmetic clinic. The client wants to know if their lips can look better and what specifically needs changing.

Rules for aiInsight (4–6 sentences, ~110–140 words — detailed, NOT a single sentence):
Use the same structure and language as the ProFace doctor in the parameter cards:
1) Name the CURRENT state in plain language ("the lower lip noticeably dominates in volume", "the mouth corners are slightly downturned", "the mouth is narrower than the norm relative to the nose").
2) Explain how it reads on the face — the visual effect of the deviation ("the upper lip gets lost when smiling", "shadows appear in the lower third of the face", "the face looks tired or stern", "the centre of the face looks heavier").
3) State WHAT the doctor will do — name the procedure STRICTLY per the reference below.
4) Describe the AFTER result — vividly and concretely ("balance is restored, the mouth shape becomes crisper", "shadows disappear, the face looks fresher and rested").
If the parameter is WITHIN NORM — sincerely confirm it and offer only a maintenance procedure (light hydration or biorevitalisation without adding volume). Do NOT use "Status:". Write warmly, like a doctor in a live conversation, not a dry report.

Doctor's decision reference (use STRICTLY these procedures per deviation):
- Upper/lower lip, lower dominates → restore volume of the UPPER lip.
- Upper/lower lip, upper dominates → gently add volume to the LOWER lip.
- Mouth width below norm → add volume nearer the CORNERS to visually widen.
- Mouth width above norm → filler strictly to the CENTRE of the lips to gather the shape.
- Mouth corners downturned → gently lift the corners with filler, remove shadows.
- Mouth corners over-lifted → delicately soften the contour, even out the lip line.
- Lip projection below norm → restore volume with filler, bring the lips forward.
- Lip projection above norm → filler NOT recommended; work on contour or hydration without volume.
- Upper lip height below norm → strong augmentation CONTRAINDICATED; gently emphasise the contour.
- Upper lip height above norm → add filler to the upper lip to visually shorten the distance.
- Lip asymmetry → balance the sides with filler, adding volume where it is lacking.
- Any parameter WITHIN NORM → hydration/biorevitalisation only, WITHOUT adding volume.

Population rules:
- If population is east_asian, interpret against east_asian ranges.
- If confidence < 0.35, mention lower accuracy due to photo quality and recommend re-capture.

Rules for aiRecommendations:
- Status "attention": 4 items — at least 2 procedures + 1 "Consultation:" + 1 rationale item.
- Status "within_norm" or "strength": 3 items — maintenance care + 1 "Consultation:".
- Each item:
  - starts with a prefix: "Procedure:", "Injections:", "Contouring:", "Consultation:", "Care:" or "Maintenance:";
  - is specific (10-22 words), references a parameter and visual result;
  - contains a real procedure name: "hyaluronic fillers", "Cupid's bow contouring", "Russian lips technique", "downturned corner correction", "upper lip augmentation".
- "Consultation:" item always: "Consultation: personalized lip correction plan with a specialist — assessment of volume, technique and expected result."
- At least 2 items with specific procedures regardless of status.

Tone: warm, supportive, motivating — like a cosmetologist who genuinely wants to help the client look their best. No diagnoses, no guaranteed outcome promises.

CRITICAL:
- Respond ONLY with valid JSON. No markdown and no extra text outside JSON.
- Every aiInsight and aiRecommendations item must be in English only.

Output schema:
{
  "features": [
    {
      "name": "ExactFeatureName",
      "aiInsight": "Concrete description of lips with numbers and improvement potential.",
      "aiRecommendations": [
        "Procedure: ...",
        "Injections: ...",
        "Consultation: ..."
      ]
    }
  ]
}

The "features" array must contain exactly as many objects as the input batch, preserving input order.`;

export interface FeatureInput {
  name: string;
  status: string;
  observations: string[];
  measurements: Record<string, number | string>;
  proportions?: Array<{
    key: string;
    label: string;
    userValue: number;
    idealMin: number;
    idealMax: number;
    status: 'ideal' | 'close' | 'deviation';
    unit: string;
  }>;
  confidence: number;
}

export interface AIFeatureResult {
  name: string;
  aiInsight: string;
  aiRecommendations: string[];
}

export interface AnalyzeResponse {
  features: AIFeatureResult[];
}

function isValidAnalyzeResponse(value: unknown): value is AnalyzeResponse {
  return Boolean(
    value &&
      typeof value === 'object' &&
      Array.isArray((value as { features?: unknown }).features),
  );
}

function stripJsonFences(text: string): string {
  return text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
}

function extractBalancedJsonObject(text: string): string | null {
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

function extractBalancedArrayAfterFeaturesKey(text: string): string | null {
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

function parseAnalyzeResponseLoose(text: string): AnalyzeResponse | null {
  const candidates: string[] = [];
  const stripped = stripJsonFences(text);
  if (stripped) candidates.push(stripped);

  const balancedObj = extractBalancedJsonObject(stripped);
  if (balancedObj) candidates.push(balancedObj);

  const featureArray = extractBalancedArrayAfterFeaturesKey(stripped);
  if (featureArray) candidates.push(`{"features":${featureArray}}`);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isValidAnalyzeResponse(parsed)) return parsed;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function hasCyrillic(text: string): boolean {
  return /[А-Яа-яЁё]/.test(text);
}

function mapInputStatusToGuidelineStatus(
  status: string,
): 'OK' | 'Monitor' | 'Attention' {
  if (status === 'attention') return 'Attention';
  if (status === 'within_norm' || status === 'strength') return 'OK';
  return 'Monitor';
}

function recommendationsForStatus(
  status: 'OK' | 'Monitor' | 'Attention',
): number {
  if (status === 'Attention') return 5;
  if (status === 'Monitor') return 4;
  return 3;
}

function populationLabel(population?: string): 'default' | 'east_asian' {
  return population === 'east_asian' ? 'east_asian' : 'default';
}



function normalizeAiResult(
  parsed: AnalyzeResponse,
  inputFeatures: FeatureInput[],
  _population: 'default' | 'east_asian',
  language: UiLanguage = 'ru',
): AnalyzeResponse {
  const rawFeatures = Array.isArray(parsed?.features) ? parsed.features : [];

  const features: AIFeatureResult[] = inputFeatures.map((input, index) => {
    const byName = rawFeatures.find((f) => f?.name === input.name);
    const raw = byName ?? rawFeatures[index] ?? ({ name: input.name } as AIFeatureResult);
    const guidelineStatus = mapInputStatusToGuidelineStatus(input.status);
    const targetCount = recommendationsForStatus(guidelineStatus);

    const rawRecs = Array.isArray(raw.aiRecommendations)
      ? raw.aiRecommendations.filter((r) => typeof r === 'string' && r.trim().length > 0)
          .filter((r) => !(language === 'en' && hasCyrillic(r)))
      : [];
    const rawInsight = typeof raw.aiInsight === 'string' && raw.aiInsight.trim().length > 0
      ? raw.aiInsight
      : '';
    const insightAllowed = rawInsight.length > 0 && !(language === 'en' && hasCyrillic(rawInsight));

    return {
      name: input.name,
      aiInsight: insightAllowed ? rawInsight : '',
      aiRecommendations: rawRecs.slice(0, targetCount),
    };
  });

  return { features };
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // CORS headers
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
          'OPENAI_API_KEY не настроен на сервере. Для локального запуска добавьте ключ в .env.local и перезапустите `npm run dev`.',
      }),
    );
    return;
  }

  // Parse request body
  let body: { features?: FeatureInput[]; population?: string; language?: UiLanguage };
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
  const population = populationLabel(body.population);
  const language = languageLabel(body.language);
  const systemPrompt = language === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_RU;
  const populationNote =
    language === 'en'
      ? population !== 'default'
        ? `\nPopulation: ${population}. Apply this selected beauty standard for interpretation.\n`
        : '\nPopulation: default. Apply default selected beauty standard for interpretation.\n'
      : population !== 'default'
        ? `\nПопуляция: ${population}. Используй соответствующие популяционные нормы.\n`
        : '\nПопуляция: default. Используй стандартные нормы.\n';

  // Set up SSE streaming — flushHeaders() is required so the browser sees
  // the 200+SSE content-type immediately and doesn't wait for the first chunk;
  // without it the client fetch hangs until the server writes something.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const sendEvent = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // Force flush after every SSE event so the browser receives it immediately
    (res as unknown as { flush?: () => void }).flush?.();
  };

  try {
    // 30-second hard timeout prevents the OpenAI call from hanging forever
    const client = new OpenAI({ apiKey, timeout: 30_000 });

    // Prepare minimal feature payload (no images, only measurements)
    const featurePayload = features.map((f) => ({
      name: f.name,
      status: f.status,
      observations: f.observations,
      measurements: f.measurements,
      proportions: f.proportions,
      confidence: Math.round(f.confidence * 100) / 100,
    }));

    // Split features into 2 parallel batches for ~2× speedup.
    // Each batch runs a separate OpenAI call simultaneously; results are merged in order.
    const mid = Math.ceil(featurePayload.length / 2);
    const batches = [featurePayload.slice(0, mid), featurePayload.slice(mid)];

    const requestBatchStream = async (batch: FeatureInput[]): Promise<string> => {
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
              ? `UI language: English. Output language must be English.${populationNote}\nGenerate personalized AI recommendations for this facial analysis report.\nData:\n\n${JSON.stringify(batch)}`
              : `Сформируй персональные AI-рекомендации для этого отчёта анализа лица.${populationNote}\nДанные:\n\n${JSON.stringify(batch)}`,
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

    const requestBatchRetry = async (batch: FeatureInput[]): Promise<string> => {
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
              ? `UI language: English. Output language must be English.\nReturn strict JSON only. No prose, no markdown fences.${populationNote}\nData:\n\n${JSON.stringify(batch)}`
              : `Верни строго JSON без пояснений и без markdown-блоков.${populationNote}\nДанные:\n\n${JSON.stringify(batch)}`,
          },
        ],
      });
      return retryResponse.choices?.[0]?.message?.content ?? '';
    };

    let parsed: AnalyzeResponse;
    const batchOutputs = await Promise.all(
      batches.map(async (batch) => {
        const text = await requestBatchStream(batch);
        return { batch, text };
      }),
    );

    // Merge parsed features from all batches preserving original order
    const allFeatures: AIFeatureResult[] = [];
    for (const output of batchOutputs) {
      let batchParsed = parseAnalyzeResponseLoose(output.text);
      if (!batchParsed) {
        // One retry without streaming improves reliability when streaming text gets malformed.
        const retryText = await requestBatchRetry(output.batch);
        batchParsed = parseAnalyzeResponseLoose(retryText);
      }
      if (!batchParsed) {
        throw new Error('GPT вернул некорректный JSON. Попробуйте ещё раз.');
      }
      allFeatures.push(...batchParsed.features);
    }
    parsed = { features: allFeatures };

    const normalized = normalizeAiResult(parsed, featurePayload, population, language);
    sendEvent({ done: true, result: normalized });
    res.end();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Неизвестная ошибка';
    console.error('[/api/analyze] Error:', message);

    if (!res.writableEnded) {
      sendEvent({ done: true, error: message });
      res.end();
    }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
