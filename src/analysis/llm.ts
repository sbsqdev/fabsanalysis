/**
 * Frontend service for AI-enhanced recommendations.
 * Calls the backend endpoint (/api/analyze), never OpenAI directly.
 * IMPORTANT: Only measurements are sent — NO images, NO pixel data.
 */

import { getCurrentLang } from '../lib/language';

export interface AIFeatureResult {
  name: string;
  aiInsight: string;
  aiRecommendations: string[];
}

export interface LLMAnalysisResult {
  features: AIFeatureResult[];
}

export type LLMStatus = 'idle' | 'streaming' | 'done' | 'error' | 'unavailable';

export interface LLMState {
  status: LLMStatus;
  result: LLMAnalysisResult | null;
  error: string | null;
  streamedChars: number;
}

export interface FeatureForLLM {
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

interface SSEEvent {
  partial?: string;
  done?: boolean;
  result?: LLMAnalysisResult;
  error?: string;
}

/**
 * Calls backend SSE endpoint (/api/analyze).
 * Returns an AbortController so callers can cancel the request.
 */
export function enhanceWithAI(
  features: FeatureForLLM[],
  onProgress: (chars: number) => void,
  onDone: (result: LLMAnalysisResult) => void,
  onError: (err: string) => void,
  population?: string,
): AbortController {
  const abortController = new AbortController();
  const lang = getCurrentLang();
  const isEn = lang === 'en';

  (async () => {
    try {
      const featurePayload = features.map((f) => ({
        name: f.name,
        status: f.status,
        observations: (f.observations ?? []).slice(0, 3),
        measurements: f.measurements,
        proportions: (() => {
          const items = Array.isArray(f.proportions) ? f.proportions : [];
          const focused = items
            .filter((p) => p.status !== 'ideal')
            .slice(0, 4);
          return focused.length > 0 ? focused : items.slice(0, 2);
        })(),
        confidence: Math.round(f.confidence * 100) / 100,
      }));

      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          features: featurePayload,
          ...(population && population !== 'default' ? { population } : {}),
          language: lang,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        let errMsg = isEn
          ? `AI endpoint error: HTTP ${response.status}`
          : `Ошибка AI-эндпоинта: HTTP ${response.status}`;
        try {
          const body = await response.json();
          errMsg = (body as { error?: string }).error || errMsg;
        } catch {
          // ignore
        }
        const normalized = errMsg.toLowerCase();
        if (
          response.status === 404 ||
          response.status === 503 ||
          (response.status === 500 && normalized.includes('openai_api_key'))
        ) {
          onError('unavailable');
        } else {
          onError(errMsg);
        }
        return;
      }

      if (!response.body) {
        onError(isEn ? 'Empty response from server' : 'Пустой ответ от сервера');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let totalChars = 0;
      let accumulatedText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          let event: SSEEvent;
          try {
            event = JSON.parse(raw) as SSEEvent;
          } catch {
            continue;
          }

          if (event.partial) {
            accumulatedText += event.partial;
            totalChars += event.partial.length;
            onProgress(totalChars);
          }

          if (event.done && event.result?.features && Array.isArray(event.result.features)) {
            onDone(event.result);
            return;
          }

          if (event.done && event.error) {
            onError(event.error);
            return;
          }
        }
      }

      // Stream ended without explicit final event.
      if (accumulatedText.length === 0) {
        onError('unavailable');
      } else {
        onError(isEn
          ? 'AI stream ended unexpectedly. Please try again.'
          : 'AI-поток неожиданно завершился. Попробуйте еще раз.');
      }
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return;
      const message = (err as Error).message || (isEn ? 'Network error' : 'Сетевая ошибка');
      const normalized = message.toLowerCase();
      if (normalized.includes('failed to fetch') || normalized.includes('networkerror')) {
        onError('unavailable');
      } else {
        onError(message);
      }
    }
  })();

  return abortController;
}
