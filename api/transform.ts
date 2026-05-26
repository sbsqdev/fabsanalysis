import { fal } from '@fal-ai/client';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'http';

export const maxDuration = 120;

type TransformPresetId =
  | 'eyebrows_natural_boost'
  | 'lips_soft_volume'
  | 'eyes_bright_open'
  | 'nose_refine'
  | 'cheeks_glow'
  | 'chin_define'
  | 'skin_smooth';

interface ProportionDeviation {
  key: string;
  label: string;
  userValue: number;
  idealCenter: number;
  idealMin: number;
  idealMax: number;
  unit: string;
  direction: 'too_low' | 'too_high' | 'ideal';
  deviationAmount: number;
  status: 'ideal' | 'close' | 'deviation';
}

interface TransformRequest {
  preset?: TransformPresetId;
  imageDataUrl?: string;
  maskDataUrl?: string;
  intensity?: 'normal' | 'strong';
  profileLeftDataUrl?: string;
  profileRightDataUrl?: string;
  proportionDeviations?: ProportionDeviation[];
}

/** Base config per preset — used when no proportion deviations are provided */
const PRESET_BASE: Record<
  TransformPresetId,
  { fallbackPrompt: string; strength: number; guidanceScale: number; numInferenceSteps: number }
> = {
  eyebrows_natural_boost: {
    fallbackPrompt:
      "Subtly enhance the eyebrows: slightly darken existing hairs and gently fill sparse gaps while fully preserving the original skin texture, pores, and natural hair grain. The result must look like the person's own eyebrows on a good grooming day — not drawn, painted, or tinted. Photorealistic, no makeup look.",
    strength: 0.88,
    guidanceScale: 4.0,
    numInferenceSteps: 35,
  },
  lips_soft_volume: {
    fallbackPrompt:
      "Gently plump the lips: slightly expand the lip border outward and add soft natural volume while fully preserving every detail of the original lip texture, fine surface lines, skin grain, and natural color. The shape should look naturally fuller — not painted, tinted, glossed, or surgically augmented. Photorealistic, no makeup look.",
    strength: 0.88,
    guidanceScale: 4.0,
    numInferenceSteps: 35,
  },
  eyes_bright_open: {
    fallbackPrompt:
      "Refine only the eye area in a very natural way: slightly brighten and clarify the sclera, softly reduce dullness under the eyes, and keep the gaze fresher without changing eye shape. Preserve iris and pupil shape, iris color, eyelid geometry, and all surrounding skin texture. No eyeliner, no lashes, no makeup, no beauty filter. Photorealistic.",
    strength: 0.88,
    guidanceScale: 4.2,
    numInferenceSteps: 36,
  },
  nose_refine: {
    fallbackPrompt:
      "Refine the nose shape and proportions to match ideal facial ratios: adjust bridge width, tip projection, and nostril proportions. Photorealistic natural result as after rhinoplasty.",
    strength: 0.88,
    guidanceScale: 4.0,
    numInferenceSteps: 35,
  },
  cheeks_glow: {
    fallbackPrompt:
      "Add a very subtle healthy vitality to the cheek skin: slightly improve tone uniformity and natural warmth while preserving pores, fine lines, and true skin texture. Avoid visible blush patches, color paint, and makeup effects. Keep it realistic and understated.",
    strength: 0.86,
    guidanceScale: 3.8,
    numInferenceSteps: 34,
  },
  chin_define: {
    fallbackPrompt:
      "Refine chin and jawline proportions to match ideal facial ratios: adjust chin projection, jawline definition, and lower-face contour. Photorealistic natural result as after genioplasty.",
    strength: 0.88,
    guidanceScale: 4.0,
    numInferenceSteps: 35,
  },
  skin_smooth: {
    fallbackPrompt:
      "Gently balance overall facial skin tone: reduce minor blotchiness, slight redness, and uneven illumination while preserving pores, fine lines, microtexture, and identity. Keep natural detail visible; avoid plastic smoothing, over-retouching, and filter look. Photorealistic.",
    strength: 0.82,
    guidanceScale: 3.5,
    numInferenceSteps: 33,
  },
};

/** Preset-specific surgical instructions — always applied, even when proportions are ideal */
const SURGICAL_CONTEXT: Record<TransformPresetId, string> = {
  eyebrows_natural_boost:
    'Edit this photo to show the result of expert cosmetic eyebrow correction: reshape the brow arch to a more defined, lifted shape. Make the eyebrows slightly thicker, more symmetrical, and with a clean defined tail. The result should look like after professional microblading and brow lift — clearly different from the original.',
  lips_soft_volume:
    'Edit this photo to show the result of expert lip augmentation: noticeably plump both lips with fuller volume, enhance the cupid\'s bow definition, and create a more balanced upper-to-lower lip ratio. The result should look like after professional lip filler injections — clearly different from the original.',
  eyes_bright_open:
    'Edit this photo to show the result of expert eye area cosmetic surgery: make the eyes appear slightly larger and more open, brighten the sclera, reduce any puffiness or dark circles under the eyes, and create a more alert and youthful eye shape. The result should look like after blepharoplasty — clearly different from the original.',
  nose_refine:
    'Edit this photo to show the result of expert rhinoplasty: refine the nose bridge to be straighter and slightly narrower, define the nose tip to be more refined and slightly upturned, reduce nostril width. The result should look like after a professional nose job — clearly different from the original.',
  cheeks_glow:
    'Edit this photo to show the result of expert cheek augmentation: add visible cheekbone definition and prominence, create more sculpted mid-face contours, add a healthy glow to the cheek area. The result should look like after cheek filler or implants — clearly different from the original.',
  chin_define:
    'Edit this photo to show the result of expert chin and jawline surgery: create a more defined and projected chin, sharpen the jawline contour, improve the lower face proportions. The result should look like after genioplasty — clearly different from the original.',
  skin_smooth:
    'Edit this photo to show the result of professional skin treatment: even out skin tone significantly, reduce all blemishes, pores, and texture irregularities, add a healthy luminous quality. The result should look like after professional skin resurfacing — clearly different from the original.',
};

function buildDeviationPrompt(
  preset: TransformPresetId,
  deviations: ProportionDeviation[],
): string {
  const parts: string[] = [SURGICAL_CONTEXT[preset]];

  // Add proportion-specific guidance
  const corrections: string[] = [];
  const enhancements: string[] = [];

  for (const d of deviations) {
    if (d.direction === 'ideal') {
      // Even for ideal — push toward perfection
      enhancements.push(
        `"${d.label}": currently ${d.userValue.toFixed(2)}${d.unit} (ideal center: ${d.idealCenter.toFixed(2)}) — enhance toward perfect ${d.idealCenter.toFixed(2)}`
      );
      continue;
    }

    const pct = d.idealCenter > 0 ? Math.round((d.deviationAmount / d.idealCenter) * 100) : 0;
    const verb = d.direction === 'too_high' ? 'reduce' : 'increase';
    const rel = d.direction === 'too_high' ? 'above' : 'below';

    corrections.push(
      `"${d.label}": ${d.userValue.toFixed(2)} is ${rel} ideal (${d.idealMin.toFixed(2)}–${d.idealMax.toFixed(2)}${d.unit}) — ${verb} by ~${pct}% toward ${d.idealCenter.toFixed(2)}`
    );
  }

  if (corrections.length > 0) {
    parts.push('', 'Proportion corrections (these MUST be visually noticeable):');
    parts.push(...corrections.map((c) => `- ${c}`));
  }

  if (enhancements.length > 0) {
    parts.push('', 'Additional enhancements toward perfection:');
    parts.push(...enhancements.map((e) => `- ${e}`));
  }

  parts.push(
    '',
    'IMPORTANT: The edit MUST produce a clearly visible difference from the original photo. The viewer should immediately see the improvement when comparing before and after. Keep the person recognizable but make the cosmetic changes obvious and beautiful.',
  );

  return parts.join('\n');
}

const UPLOAD_CACHE_TTL_MS = 15 * 60 * 1000;
const UPLOAD_CACHE_MAX = 128;
const uploadCache = new Map<string, { url: string; expiresAt: number }>();

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString();
      if (data.length > 25 * 1024 * 1024) {
        reject(new Error('Payload слишком большой'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function hashDataUrl(dataUrl: string): string {
  return createHash('sha1').update(dataUrl).digest('base64url');
}

function pruneUploadCache() {
  const now = Date.now();
  for (const [key, value] of uploadCache.entries()) {
    if (value.expiresAt <= now) uploadCache.delete(key);
  }
  while (uploadCache.size > UPLOAD_CACHE_MAX) {
    const oldest = uploadCache.keys().next().value as string | undefined;
    if (!oldest) break;
    uploadCache.delete(oldest);
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('Некорректный dataURL');
  const mime = match[1];
  const b64 = match[2];
  const buffer = Buffer.from(b64, 'base64');
  return new Blob([buffer], { type: mime });
}

async function uploadDataUrl(dataUrl: string, cacheKey?: string): Promise<string> {
  pruneUploadCache();
  if (cacheKey) {
    const cached = uploadCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.url;
  }

  const blob = dataUrlToBlob(dataUrl);
  const url = await fal.storage.upload(blob);

  if (cacheKey) {
    uploadCache.set(cacheKey, { url, expiresAt: Date.now() + UPLOAD_CACHE_TTL_MS });
  }
  return url;
}

function validateDataUrl(value: unknown) {
  return typeof value === 'string' && value.startsWith('data:image/');
}

function buildPrompt(preset: TransformPresetId, deviations?: ProportionDeviation[]) {
  const corePrompt = deviations && deviations.length > 0
    ? buildDeviationPrompt(preset, deviations)
    : SURGICAL_CONTEXT[preset];

  return [
    corePrompt,
    'Keep the same person recognizable — same identity, same camera angle, same expression, same background and clothing.',
    'The result must look like a real photograph — photorealistic quality, no painting or illustration artifacts.',
    'Make the cosmetic changes clearly visible and beautiful.',
  ].join('\n');
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
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

  const apiKey = process.env.FAL_KEY;
  const model = process.env.FAL_MODEL || 'fal-ai/flux-kontext-lora/inpaint';
  if (!apiKey) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'FAL_KEY не настроен на сервере. Добавьте ключ в переменные окружения.',
      }),
    );
    return;
  }

  let body: TransformRequest;
  try {
    body = JSON.parse(await readBody(req)) as TransformRequest;
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Некорректный JSON в теле запроса' }));
    return;
  }

  const preset = body.preset;
  if (!preset || !(preset in PRESET_BASE)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Неизвестный preset' }));
    return;
  }
  if (!validateDataUrl(body.imageDataUrl)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'imageDataUrl должен быть data:image/*' }));
    return;
  }

  try {
    fal.config({ credentials: apiKey });

    const frontImageUrl = await uploadDataUrl(
      body.imageDataUrl ?? '',
      `img:${hashDataUrl(body.imageDataUrl ?? '')}`,
    );

    const deviationCount = body.proportionDeviations?.filter((d) => d.status !== 'ideal').length ?? 0;
    const prompt = buildPrompt(preset, body.proportionDeviations);
    console.log(`[/api/transform] model=${model} preset=${preset} deviations=${deviationCount} prompt_len=${prompt.length}`);

    const SERVER_TIMEOUT_MS = 60_000;
    const isNanoBanana = model.includes('nano-banana');
    const isGptImage = model.includes('gpt-image');

    let result: any;

    if (isNanoBanana || isGptImage) {
      // Nano Banana 2 / GPT Image 1.5 — text-driven editing, no mask needed
      const input: Record<string, unknown> = {
        prompt,
        image_urls: [frontImageUrl],
        num_images: 1,
        output_format: 'png',
      };
      if (isGptImage) {
        input.quality = 'high';
        input.input_fidelity = 'high';
      }

      result = await Promise.race([
        fal.subscribe(model, { input, logs: true }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('fal.subscribe server timeout')), SERVER_TIMEOUT_MS),
        ),
      ]);
    } else {
      // Legacy flux-kontext-lora/inpaint — requires mask
      if (!validateDataUrl(body.maskDataUrl)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'maskDataUrl должен быть data:image/* для flux модели' }));
        return;
      }
      const maskImageUrl = await uploadDataUrl(body.maskDataUrl ?? '');
      const presetConfig = PRESET_BASE[preset];
      const intensity = body.intensity === 'strong' ? 'strong' : 'normal';
      const strengthBoost = intensity === 'strong' ? 0.06 : 0;
      const guidanceBoost = intensity === 'strong' ? 0.25 : 0;
      const stepsBoost = intensity === 'strong' ? 4 : 0;

      result = await Promise.race([
        fal.subscribe(model, {
          input: {
            image_url: frontImageUrl,
            mask_url: maskImageUrl,
            reference_image_url: frontImageUrl,
            prompt,
            num_images: 1,
            strength: clamp(presetConfig.strength + strengthBoost, 0.45, 0.95),
            guidance_scale: clamp(presetConfig.guidanceScale + guidanceBoost, 2.5, 5.0),
            num_inference_steps: Math.round(clamp(presetConfig.numInferenceSteps + stepsBoost, 20, 40)),
            output_format: 'png',
          },
          logs: false,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('fal.subscribe server timeout')), SERVER_TIMEOUT_MS),
        ),
      ]);
    }

    const imageUrl = result.data?.images?.[0]?.url;
    if (!imageUrl) {
      throw new Error('fal.ai не вернул итоговое изображение');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        imageUrl,
        preset,
        model,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ошибка трансформации';
    const detail = (err as any)?.body || (err as any)?.status || '';
    console.error('[/api/transform] Error:', message, detail ? `| detail: ${JSON.stringify(detail)}` : '');
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }
}
