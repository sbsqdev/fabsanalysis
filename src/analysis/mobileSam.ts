/**
 * MobileSAM inference via onnxruntime-web.
 *
 * Pipeline:
 *  1. Resize image to fit within 1024×1024 (keep aspect ratio) → run encoder → embedding
 *  2. Supply prompt points + embedding → run decoder → binary mask
 *
 * Model files (placed in public/models/):
 *   sam_encoder.onnx  (Acly/MobileSAM mobile_sam_image_encoder.onnx)
 *   sam_decoder.onnx  (Acly/MobileSAM sam_mask_decoder_single.onnx)
 *
 * Encoder input:  input_image [H, W, 3] float32 HWC, values 0-255
 *                 (model normalises + pads to 1024×1024 internally)
 * Encoder output: image_embeddings [1, 256, 64, 64]
 * Decoder inputs: image_embeddings, point_coords [1,N,2], point_labels [1,N],
 *                 mask_input [1,1,256,256], has_mask_input [1], orig_im_size [2]
 * Decoder output: masks (float logits, threshold at 0)
 */

import * as ort from 'onnxruntime-web';

const ENCODER_URL = '/models/sam_encoder.onnx';
const DECODER_URL = '/models/sam_decoder.onnx';
const MODEL_FETCH_TIMEOUT_MS = 120_000;
const SESSION_CREATE_TIMEOUT_MS = 120_000;
const MAX_LOAD_ATTEMPTS = 2;

// SAM max image dimension
const SAM_SIZE = 1024;

// ─── session cache ────────────────────────────────────────────────────────────

let encoderSession: ort.InferenceSession | null = null;
let decoderSession: ort.InferenceSession | null = null;
let loadPromise: Promise<void> | null = null;
let ortConfigured = false;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`[SAM] ${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function configureOrtWasm(): void {
  if (ortConfigured) return;
  // Tell onnxruntime-web where WASM files are (served from root in Vite builds)
  ort.env.wasm.wasmPaths = '/';
  ort.env.wasm.simd = true;
  ort.env.wasm.numThreads = 1;
  ortConfigured = true;
}

async function fetchModelArrayBuffer(url: string): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      // Allow browser-level caching: repeated scans should not re-download 43MB.
      cache: 'default',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}`);
    }
    const ct = (response.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('text/html')) {
      throw new Error(`${url} returned HTML instead of ONNX binary`);
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength < 1_000_000) {
      throw new Error(`${url} looks too small (${bytes.byteLength} bytes)`);
    }
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}

async function initSessionsOnce(opts: ort.InferenceSession.SessionOptions): Promise<void> {
  // Load sequentially to reduce iOS Safari memory pressure.
  let encoderBytes: ArrayBuffer | null = await fetchModelArrayBuffer(ENCODER_URL);
  const enc = await withTimeout(
    ort.InferenceSession.create(encoderBytes, opts),
    SESSION_CREATE_TIMEOUT_MS,
    'encoder session init',
  );
  encoderBytes = null;
  encoderSession = enc;

  let decoderBytes: ArrayBuffer | null = await fetchModelArrayBuffer(DECODER_URL);
  const dec = await withTimeout(
    ort.InferenceSession.create(decoderBytes, opts),
    SESSION_CREATE_TIMEOUT_MS,
    'decoder session init',
  );
  decoderBytes = null;
  decoderSession = dec;
}

export async function loadSamModels(): Promise<boolean> {
  if (encoderSession && decoderSession) return true;

  if (loadPromise) {
    await loadPromise;
    return !!(encoderSession && decoderSession);
  }

  loadPromise = (async () => {
    try {
      configureOrtWasm();

      const opts: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'] };

      console.log('[SAM] Loading models...');
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS; attempt++) {
        try {
          await initSessionsOnce(opts);
          break;
        } catch (err) {
          lastError = err;
          console.warn(`[SAM] Load attempt ${attempt}/${MAX_LOAD_ATTEMPTS} failed:`, err);
          try {
            await (encoderSession as { release?: () => Promise<void> } | null)?.release?.();
          } catch {
            // no-op: release is best effort
          }
          try {
            await (decoderSession as { release?: () => Promise<void> } | null)?.release?.();
          } catch {
            // no-op: release is best effort
          }
          encoderSession = null;
          decoderSession = null;
          if (attempt < MAX_LOAD_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, 600));
          }
        }
      }

      if (!encoderSession || !decoderSession) {
        throw lastError instanceof Error ? lastError : new Error('[SAM] unknown load error');
      }

      console.log('[SAM] Models loaded. Encoder inputs:', encoderSession.inputNames, 'Decoder inputs:', decoderSession.inputNames);
    } catch (e) {
      console.error('[SAM] Failed to load models:', e);
      try {
        await (encoderSession as { release?: () => Promise<void> } | null)?.release?.();
      } catch {
        // no-op: release is best effort
      }
      try {
        await (decoderSession as { release?: () => Promise<void> } | null)?.release?.();
      } catch {
        // no-op: release is best effort
      }
      encoderSession = null;
      decoderSession = null;
    } finally {
      loadPromise = null;
    }
  })();

  await loadPromise;
  return !!(encoderSession && decoderSession);
}

/** Quick availability check via HEAD request (does not load the models). */
export async function areSamModelsAvailable(): Promise<boolean> {
  const looksLikeModelResponse = (r: Response): boolean => {
    if (!r.ok) return false;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('text/html')) return false; // SPA fallback should not count as model availability
    const len = Number(r.headers.get('content-length') || '0');
    // ONNX files are ~16MB and ~27MB; tiny responses are likely not model binaries.
    if (Number.isFinite(len) && len > 0 && len < 1_000_000) return false;
    return true;
  };

  try {
    const [r1, r2] = await Promise.all([
      fetch(ENCODER_URL, { method: 'HEAD' }),
      fetch(DECODER_URL, { method: 'HEAD' }),
    ]);
    return looksLikeModelResponse(r1) && looksLikeModelResponse(r2);
  } catch {
    return false;
  }
}

// ─── preprocessing ────────────────────────────────────────────────────────────

/**
 * Resize canvas to fit within SAM_SIZE×SAM_SIZE (maintain aspect ratio),
 * return pixel data as HWC Float32Array (values 0-255) ready for encoder.
 * Also returns scale factor for coordinate mapping.
 */
function preprocessCanvas(canvas: HTMLCanvasElement): {
  data: Float32Array;
  resizedW: number;
  resizedH: number;
  scale: number;
} {
  const origW = canvas.width;
  const origH = canvas.height;

  // Scale so max(H, W) = SAM_SIZE — encoder pads right/bottom internally
  const scale = Math.min(SAM_SIZE / origW, SAM_SIZE / origH);
  const resizedW = Math.round(origW * scale);
  const resizedH = Math.round(origH * scale);

  const offscreen = document.createElement('canvas');
  offscreen.width = resizedW;
  offscreen.height = resizedH;
  const ctx = offscreen.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0, resizedW, resizedH);

  const pixels = ctx.getImageData(0, 0, resizedW, resizedH).data;

  // HWC layout: [H, W, 3] — R, G, B in 0-255
  const data = new Float32Array(resizedH * resizedW * 3);
  for (let y = 0; y < resizedH; y++) {
    for (let x = 0; x < resizedW; x++) {
      const pi = (y * resizedW + x) * 4;
      const di = (y * resizedW + x) * 3;
      data[di]     = pixels[pi];       // R
      data[di + 1] = pixels[pi + 1];   // G
      data[di + 2] = pixels[pi + 2];   // B
    }
  }

  return { data, resizedW, resizedH, scale };
}

// ─── encoder ─────────────────────────────────────────────────────────────────

export interface ImageEmbedding {
  data: Float32Array;
  dims: readonly number[];
  origW: number;
  origH: number;
  /** Factor from original → resized (SAM 1024-space) */
  scale: number;
}

export async function getImageEmbedding(canvas: HTMLCanvasElement): Promise<ImageEmbedding | null> {
  if (!encoderSession) return null;

  const { data, resizedW, resizedH, scale } = preprocessCanvas(canvas);

  try {
    const inputTensor = new ort.Tensor('float32', data, [resizedH, resizedW, 3]);
    const feeds: Record<string, ort.Tensor> = { [encoderSession.inputNames[0]]: inputTensor };
    const results = await encoderSession.run(feeds);
    const embedding = results[encoderSession.outputNames[0]];

    return {
      data: embedding.data as Float32Array,
      dims: embedding.dims,
      origW: canvas.width,
      origH: canvas.height,
      scale,
    };
  } catch (e) {
    console.error('[SAM] Encoder failed:', e);
    return null;
  }
}

// ─── decoder ─────────────────────────────────────────────────────────────────

export interface PromptPoint {
  /** 0–1 normalised coordinates relative to the original image */
  x: number;
  y: number;
  /** 1=foreground, 0=background */
  label: 0 | 1;
}

export async function getMask(
  embedding: ImageEmbedding,
  prompts: PromptPoint[],
): Promise<{ mask: Uint8Array; width: number; height: number } | null> {
  if (!decoderSession) return null;

  const { data, dims, origW, origH, scale } = embedding;
  const N = prompts.length;

  // Convert normalised [0,1] → resized image pixel space (SAM_SIZE domain)
  const pointCoords = new Float32Array(N * 2);
  const pointLabels = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pointCoords[i * 2]     = prompts[i].x * origW * scale;
    pointCoords[i * 2 + 1] = prompts[i].y * origH * scale;
    pointLabels[i] = prompts[i].label;
  }

  const feeds: Record<string, ort.Tensor> = {
    image_embeddings: new ort.Tensor('float32', data, dims as number[]),
    point_coords:     new ort.Tensor('float32', pointCoords, [1, N, 2]),
    point_labels:     new ort.Tensor('float32', pointLabels, [1, N]),
    mask_input:       new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]),
    has_mask_input:   new ort.Tensor('float32', new Float32Array([0]), [1]),
    orig_im_size:     new ort.Tensor('float32', new Float32Array([origH, origW]), [2]),
  };

  try {
    const results = await decoderSession.run(feeds);
    const maskTensor = results['masks'];
    const rawMask    = maskTensor.data as Float32Array;
    const mH         = maskTensor.dims[maskTensor.dims.length - 2] as number;
    const mW         = maskTensor.dims[maskTensor.dims.length - 1] as number;

    // Threshold at 0 (logit space)
    const binary = new Uint8Array(mH * mW);
    for (let i = 0; i < rawMask.length; i++) {
      binary[i] = rawMask[i] > 0 ? 1 : 0;
    }

    return { mask: binary, width: mW, height: mH };
  } catch (e) {
    console.error('[SAM] Decoder failed:', e);
    return null;
  }
}

// ─── high-level segmentation ──────────────────────────────────────────────────

/**
 * Auto-segment the face in a profile photo.
 * `side`: which direction the subject is facing.
 * Returns a binary mask at the original image resolution.
 */
export async function segmentFaceProfile(
  canvas: HTMLCanvasElement,
  side: 'left' | 'right',
): Promise<{ mask: Uint8Array; width: number; height: number } | null> {
  const loaded = await loadSamModels();
  if (!loaded) {
    console.warn('[SAM] Models not available');
    return null;
  }

  const embedding = await getImageEmbedding(canvas);
  if (!embedding) return null;

  // Auto-prompt heuristic for profile photos:
  // Positive: face center + forehead + nose region + lower face
  // Negative: image corners (background)
  const noseX = side === 'left' ? 0.55 : 0.45;
  const prompts: PromptPoint[] = [
    { x: 0.50, y: 0.45, label: 1 },   // mid-face center
    { x: noseX, y: 0.44, label: 1 },  // nose tip region
    { x: 0.50, y: 0.30, label: 1 },   // forehead
    { x: 0.50, y: 0.65, label: 1 },   // lower face / jaw
    { x: 0.05, y: 0.05, label: 0 },   // top-left background
    { x: 0.95, y: 0.05, label: 0 },   // top-right background
    { x: 0.05, y: 0.95, label: 0 },   // bottom-left background
    { x: 0.95, y: 0.95, label: 0 },   // bottom-right background
  ];

  const result = await getMask(embedding, prompts);
  if (!result) return null;

  // Upsample if decoder output is smaller than original
  if (result.width !== canvas.width || result.height !== canvas.height) {
    return upsampleMask(result, canvas.width, canvas.height);
  }

  return result;
}

/** Nearest-neighbour upsampling to match target dimensions. */
function upsampleMask(
  src: { mask: Uint8Array; width: number; height: number },
  targetW: number,
  targetH: number,
): { mask: Uint8Array; width: number; height: number } {
  const out = new Uint8Array(targetW * targetH);
  const xScale = src.width  / targetW;
  const yScale = src.height / targetH;
  for (let y = 0; y < targetH; y++) {
    const srcY = Math.min(Math.floor(y * yScale), src.height - 1);
    for (let x = 0; x < targetW; x++) {
      const srcX = Math.min(Math.floor(x * xScale), src.width - 1);
      out[y * targetW + x] = src.mask[srcY * src.width + srcX];
    }
  }
  return { mask: out, width: targetW, height: targetH };
}
