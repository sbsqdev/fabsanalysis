/**
 * Server API handler: POST /api/summary
 *
 * Accepts facial feature metrics (NO images — privacy preserved) and asks
 * DeepSeek for a SHORT, warm, plain-language summary of the client's face.
 *
 * Request body:  { features: SummaryFeature[]; overallScore?: number;
 *                  gender?: string; population?: string; language?: 'ru' | 'en' }
 * Response:      { summary: string }   |   { error: string }
 *
 * DeepSeek is OpenAI-compatible, so we reuse the `openai` SDK with a custom
 * baseURL. Non-streaming — the summary is short, so one round-trip is fine.
 */

import OpenAI from 'openai';
import type { IncomingMessage, ServerResponse } from 'http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const maxDuration = 30;

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

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
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      const clean = value.trim();
      if (clean) return clean;
    }
  }
  return undefined;
}

function resolveDeepSeekKey(): string | undefined {
  const candidates = [
    process.env.DEEPSEEK_API_KEY,
    process.env.VITE_DEEPSEEK_API_KEY,
    readEnvValueFromFiles('DEEPSEEK_API_KEY'),
    readEnvValueFromFiles('VITE_DEEPSEEK_API_KEY'),
  ];
  for (const c of candidates) {
    const clean = c?.trim();
    if (clean) return clean;
  }
  return undefined;
}

function resolveDeepSeekModel(): string {
  return (
    process.env.DEEPSEEK_MODEL?.trim() ||
    readEnvValueFromFiles('DEEPSEEK_MODEL') ||
    'deepseek-chat'
  );
}

type UiLanguage = 'ru' | 'en';

interface SummaryProportion {
  label: string;
  status?: 'ideal' | 'close' | 'deviation';
  dir?: 'below' | 'above';
  userValue?: number;
  idealMin?: number;
  idealMax?: number;
  unit?: string;
}
interface SummaryFeature {
  name: string;
  status: string;
  proportions?: SummaryProportion[];
}
interface SummaryBody {
  features?: SummaryFeature[];
  overallScore?: number;
  gender?: string;
  population?: string;
  language?: UiLanguage;
}

const SYSTEM_RU = `Ты — опытный косметолог-эстетист клиники ProFace, специалист по красоте и эстетике ГУБ. На входе — только структурные метрики губ (БЕЗ фото).
Твоя задача: написать клиентке тёплое, бережное и при этом содержательное резюме именно о её ГУБАХ — мы работаем только с губами — и мягко, но уверенно подвести её к записи на консультацию по конкретным процедурам клиники.

Структура ответа — ДВА коротких абзаца, всего 6–8 предложений (~120–150 слов), без списков и заголовков:
1) Первый абзац — искренне и конкретно отметь, что в губах уже красиво и гармонично (форма, плавность линии, естественность, баланс верхней и нижней губы). Клиентка должна почувствовать, что её губы уже хороши.
2) Второй абзац — пройдись по каждой зоне внимания из данных и для КАЖДОЙ:
   - простым языком объясни, что именно можно деликатно подчеркнуть и какой нежный визуальный эффект это даст (больше объёма, симметрия, приподнятые уголки, более выразительная улыбка);
   - назови конкретную, но бережную процедуру клиники, которая это решает: лёгкие гиалуроновые филлеры, мягкое увеличение объёма, контуринг Купидова лука, коррекция (поднятие) уголков рта, техника «русские губы», выравнивание асимметрии филлером, увлажняющая биоревитализация губ.
   Заверши тёплым приглашением прийти на бесплатную консультацию ProFace, где специалист индивидуально подберёт технику, объём и план.

Справочник решений врача (подбирай процедуру СТРОГО по направлению отклонения из данных — «ниже нормы»/«выше нормы»):
- Верхняя/нижняя губа ниже нормы (преобладает нижняя) → восполнить объём ВЕРХНЕЙ губы.
- Верхняя/нижняя губа выше нормы (преобладает верхняя) → мягко добавить объём в НИЖНЮЮ губу.
- Ширина рта ниже нормы → добавить объём ближе к УГОЛКАМ, визуально расширить.
- Ширина рта выше нормы → филлер в ЦЕНТР губ, собрать форму.
- Уголки рта ниже нормы (опущены) → деликатно приподнять уголки филлером, убрать тени.
- Уголки рта выше нормы (слишком приподняты) → мягко смягчить контур, выровнять линию рта.
- Выступание/проекция губ ниже нормы → восполнить объём филлером, вывести губы вперёд.
- Выступание/проекция губ выше нормы → филлер НЕ нужен; работа с контуром/увлажнением.
- Высота верхней губы ниже нормы → без сильного объёма, аккуратно подчеркнуть контур.
- Высота верхней губы выше нормы → филлер в верхнюю губу, визуально сократить расстояние.
- Симметрия/асимметрия ниже нормы → выровнять стороны филлером.

Правила:
- Пиши ИСКЛЮЧИТЕЛЬНО про губы. Ни слова про лицо в целом, нос, глаза, скулы.
- Обращайся на «вы», с теплотой и заботой, без капли осуждения и давления.
- Никаких чисел, градусов и пугающего медицинского жаргона. Названия процедур — мягкие, понятные, привлекательные.
- Это не диагноз, а тёплое, уверенное приглашение позаботиться о себе.
- Если зон внимания нет — опиши лёгкую поддерживающую процедуру для сохранения формы и объёма (например, биоревитализация губ) и всё равно пригласи на консультацию.`;

const SYSTEM_EN = `You are an experienced aesthetic cosmetologist at the ProFace clinic, specialising in LIP beauty and aesthetics. The input is structural lip metrics only (NO photos).
Write the client a warm, caring yet substantive summary about her LIPS only — we work with lips exclusively — and gently but confidently guide her toward booking a consultation about specific clinic procedures.

Answer structure — TWO short paragraphs, 6–8 sentences total (~120–150 words), no lists, no headings:
1) First paragraph — sincerely and concretely note what is already beautiful and harmonious about the lips (shape, smoothness of the line, naturalness, the balance of upper and lower lip). She should feel her lips are already lovely.
2) Second paragraph — go through each area of attention from the data and for EACH:
   - explain in plain language what could be delicately enhanced and the soft visual effect it would give (more volume, symmetry, lifted corners, a more expressive smile);
   - name a specific but gentle clinic procedure that addresses it: light hyaluronic fillers, soft volume augmentation, Cupid's bow contouring, mouth-corner (lip) lift correction, the "Russian lips" technique, filler-based asymmetry balancing, hydrating lip biorevitalisation.
   Finish with a warm invitation to a free ProFace consultation, where a specialist will tailor the technique, volume and plan individually.

Doctor's decision reference (pick the procedure STRICTLY by the deviation direction from the data — "below norm"/"above norm"):
- Upper/lower lip below norm (lower dominates) → restore volume of the UPPER lip.
- Upper/lower lip above norm (upper dominates) → gently add volume to the LOWER lip.
- Mouth width below norm → add volume nearer the CORNERS to visually widen.
- Mouth width above norm → filler to the CENTRE of the lips to gather the shape.
- Mouth corners below norm (downturned) → gently lift the corners with filler, remove shadows.
- Mouth corners above norm (over-lifted) → softly even out the contour and lip line.
- Lip projection below norm → restore volume with filler, bring the lips forward.
- Lip projection above norm → filler NOT needed; work on contour/hydration.
- Upper lip height below norm → no strong volume, gently emphasise the contour.
- Upper lip height above norm → filler to the upper lip to visually shorten the distance.
- Symmetry/asymmetry below norm → balance the sides with filler.

Rules:
- Write STRICTLY about the lips. Never mention the face as a whole, the nose, eyes, cheeks.
- Address the reader as "you", with warmth and care, zero judgment or pressure.
- No numbers, degrees, or scary medical jargon. Procedure names should be soft, clear and appealing.
- Not a diagnosis — a warm, confident invitation to care for yourself.
- If there are no areas of attention, describe a light maintenance procedure to preserve shape and volume (e.g. lip biorevitalisation) and still invite her to a consultation.`;

function buildUserPayload(body: SummaryBody, language: UiLanguage): string {
  const lines: string[] = [];
  if (typeof body.overallScore === 'number') {
    lines.push(language === 'en' ? `Lip harmony score: ${body.overallScore}/100` : `Оценка гармонии губ: ${body.overallScore}/100`);
  }
  if (body.gender) lines.push(language === 'en' ? `Gender: ${body.gender}` : `Пол: ${body.gender}`);
  if (body.population && body.population !== 'default') {
    lines.push(language === 'en' ? `Beauty standard: ${body.population}` : `Эталон пропорций: ${body.population}`);
  }
  lines.push(language === 'en' ? 'Lip metrics:' : 'Показатели губ:');
  for (const f of body.features ?? []) {
    const dirLabel = (p: SummaryProportion): string => {
      if (!p.dir) return '';
      if (language === 'en') return p.dir === 'below' ? ' (below norm)' : ' (above norm)';
      return p.dir === 'below' ? ' (ниже нормы)' : ' (выше нормы)';
    };
    const notable = (f.proportions ?? [])
      .filter((p) => p.status && p.status !== 'ideal')
      .slice(0, 3)
      .map((p) => `${p.label}${dirLabel(p)}`)
      .join(', ');
    const tail = notable
      ? (language === 'en' ? ` — to review: ${notable}` : ` — обратить внимание: ${notable}`)
      : (language === 'en' ? ' — within norm' : ' — в норме');
    lines.push(`- ${f.name} [${f.status}]${tail}`);
  }
  return lines.join('\n');
}

export default async function summaryHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
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

  const apiKey = resolveDeepSeekKey();
  if (!apiKey) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'DEEPSEEK_API_KEY не настроен на сервере. Добавьте ключ в .env.local и перезапустите.' }));
    return;
  }

  let body: SummaryBody;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Некорректный JSON в теле запроса' }));
    return;
  }
  if (!body.features || !Array.isArray(body.features) || body.features.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Требуется массив features' }));
    return;
  }

  const language: UiLanguage = body.language === 'en' ? 'en' : 'ru';
  const client = new OpenAI({ apiKey, baseURL: DEEPSEEK_BASE_URL });

  try {
    const completion = await client.chat.completions.create({
      model: resolveDeepSeekModel(),
      temperature: 0.7,
      max_tokens: 600,
      messages: [
        { role: 'system', content: language === 'en' ? SYSTEM_EN : SYSTEM_RU },
        { role: 'user', content: buildUserPayload(body, language) },
      ],
    });
    const summary = completion.choices?.[0]?.message?.content?.trim() ?? '';
    if (!summary) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Пустой ответ от DeepSeek' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ summary }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'DeepSeek request failed';
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
