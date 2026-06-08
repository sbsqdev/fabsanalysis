import { fal } from '@fal-ai/client';
import type { IncomingMessage, ServerResponse } from 'http';

export const maxDuration = 60;

interface Metric {
  key: string;
  label: string;
  userValue: number;
  idealMin: number;
  idealMax: number;
  idealCenter: number;
  unit: string;
  status: 'ideal' | 'close' | 'deviation';
  informational?: boolean;
}

interface LipVisRequest {
  metrics?: Metric[];
  imageDataUrl?: string;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString();
      if (data.length > 20 * 1024 * 1024) reject(new Error('Payload too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('Invalid dataURL');
  return new Blob([Buffer.from(match[2], 'base64')], { type: match[1] });
}

// Stage 1: GPT generates a precise image-editing prompt from raw measurements
async function generateEditingPrompt(metrics: Metric[]): Promise<string> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error('OPENAI_API_KEY not set');

  const deviations = metrics
    .filter((m) => !m.informational && m.status !== 'ideal')
    .map((m) => {
      const deviation = m.userValue - m.idealCenter;
      const pct = m.idealCenter !== 0
        ? Math.round((deviation / m.idealCenter) * 100)
        : 0;
      const direction = pct > 0 ? `+${pct}%` : `${pct}%`;
      return `• ${m.label}: ${m.userValue}${m.unit} (ideal ${m.idealMin}–${m.idealMax}${m.unit}, deviation ${direction})`;
    });

  const ideals = metrics
    .filter((m) => !m.informational && m.status === 'ideal')
    .map((m) => `• ${m.label}: ${m.userValue}${m.unit} — already ideal, do NOT change`);

  const measurementBlock = [
    deviations.length > 0 ? `Deviations to correct:\n${deviations.join('\n')}` : 'All metrics are within ideal range.',
    ideals.length > 0 ? `\nAlready ideal (preserve exactly):\n${ideals.join('\n')}` : '',
  ].join('');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      max_tokens: 220,
      temperature: 0.25,
      messages: [
        {
          role: 'system',
          content: [
            'You are an aesthetic medicine specialist writing precise image-editing instructions for an AI image editor.',
            'Given lip facial measurements, write ONE editing prompt (3–5 sentences) describing exactly what to change.',
            '',
            'Rules:',
            '- Translate deviations into visual terms ("add subtle volume", "lift slightly", "widen gently") — never mention raw numbers',
            '- Be specific about which lip zone (cupid\'s bow, upper lip body, lower lip, mouth corners, philtrum border)',
            '- Prioritise the largest deviations; ignore metrics already at ideal',
            '- Hyaluronic acid filler aesthetic: natural, hydrated, youthful — not overdone or artificial',
            '- End every prompt with exactly this sentence: "Keep everything else identical — same face, same skin, same eyes, same background, same lighting. Only the lips change. Result must look photorealistic like a real clinical before/after photo."',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `Lip measurements:\n${measurementBlock}\n\nWrite the image editing prompt:`,
        },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const prompt = data.choices?.[0]?.message?.content?.trim();
  if (!prompt) throw new Error('OpenAI returned empty prompt');
  return prompt;
}

// Fallback prompt used when no metrics available or GPT fails
function fallbackPrompt(): string {
  return [
    'Enhance the lips to achieve ideal natural proportions:',
    'subtle filler-based augmentation with hyaluronic acid technique.',
    'Result is naturally beautiful, clearly improved but not overdone.',
    'Lips look hydrated, smooth, youthful, with a subtle natural sheen.',
    'Keep everything else identical — same face, same skin, same eyes, same background, same lighting.',
    'Only the lips change. Result must look photorealistic like a real clinical before/after photo.',
  ].join(' ');
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const falKey = process.env.FAL_NANO_BANANA_KEY || process.env.FAL_KEY;
  if (!falKey) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'FAL_NANO_BANANA_KEY not configured' }));
    return;
  }

  let body: LipVisRequest;
  try {
    body = JSON.parse(await readBody(req)) as LipVisRequest;
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  const hasImage = typeof body.imageDataUrl === 'string' && body.imageDataUrl.startsWith('data:image/');
  const hasMetrics = Array.isArray(body.metrics) && body.metrics.length > 0;

  try {
    fal.config({ credentials: falKey });

    // ── Stage 1: Generate editing prompt via GPT ──────────────────────────────
    let prompt: string;
    if (hasMetrics) {
      try {
        prompt = await generateEditingPrompt(body.metrics!);
        console.log(`[lip-visualize] GPT prompt: "${prompt.slice(0, 120)}..."`);
      } catch (err) {
        console.warn('[lip-visualize] GPT prompt generation failed, using fallback:', err);
        prompt = fallbackPrompt();
      }
    } else {
      prompt = fallbackPrompt();
    }

    let imageUrl: string | undefined;

    if (hasImage) {
      // ── Stage 2: Upload face photo to fal storage ─────────────────────────
      const blob = dataUrlToBlob(body.imageDataUrl!);
      const uploaded = await fal.storage.upload(blob);
      console.log(`[lip-visualize] uploaded → ${uploaded}`);

      // ── Stage 3: Edit image with GPT-crafted prompt ───────────────────────
      const result = await fetch('https://fal.run/fal-ai/nano-banana-pro/edit', {
        method: 'POST',
        headers: {
          Authorization: `Key ${falKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          image_urls: [uploaded],
          num_images: 1,
          output_format: 'jpeg',
          resolution: '1K',
          sync_mode: true,
          limit_generations: true,
        }),
        signal: AbortSignal.timeout(45_000),
      });

      if (!result.ok) {
        const text = await result.text();
        throw new Error(`fal.ai ${result.status}: ${text.slice(0, 200)}`);
      }

      const data = await result.json() as { images?: Array<{ url: string }> };
      imageUrl = data.images?.[0]?.url;
    } else {
      // Fallback: text-to-image reference when no photo provided
      const result = await fetch('https://fal.run/fal-ai/nano-banana-2', {
        method: 'POST',
        headers: {
          Authorization: `Key ${falKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: 'Professional beauty close-up of perfect lips after expert lip filler. Naturally fuller, well-defined cupid\'s bow, hydrated and youthful. Studio lighting, photorealistic, 4K.',
          num_images: 1,
          output_format: 'jpeg',
          resolution: '1K',
          aspect_ratio: '4:5',
          sync_mode: true,
        }),
        signal: AbortSignal.timeout(45_000),
      });

      if (!result.ok) {
        const text = await result.text();
        throw new Error(`fal.ai ${result.status}: ${text.slice(0, 200)}`);
      }

      const data = await result.json() as { images?: Array<{ url: string }> };
      imageUrl = data.images?.[0]?.url;
    }

    if (!imageUrl) throw new Error('No image returned from fal.ai');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ imageUrl }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed';
    console.error('[lip-visualize] Error:', message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }
}
