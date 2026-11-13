import { Logger } from '@nestjs/common';

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  modelVersion?: string;
  promptFeedback?: { blockReason?: string };
}

export interface GeminiJsonResult {
  text: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** Statuses where trying the next model makes sense (overloaded, rate-limited, model gone). */
const TRY_NEXT_MODEL = new Set([404, 429, 500, 503]);

const logger = new Logger('Gemini');

/**
 * One schema-constrained JSON call to Gemini's REST API.
 *
 * Free-tier capacity varies minute to minute per model ("high demand" 503s), so this walks an
 * ordered list of models and uses the first that answers. If every model fails it throws, and
 * the caller (the job queue) retries later with backoff.
 */
export async function geminiGenerateJson(opts: {
  apiKey: string;
  models: string[];
  system: string;
  user: string;
  schema: object;
  temperature?: number;
}): Promise<GeminiJsonResult> {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts: [{ text: opts.user }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: opts.schema,
      temperature: opts.temperature ?? 0.2,
    },
  });

  const failures: string[] = [];
  for (const model of opts.models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body,
      signal: AbortSignal.timeout(90_000),
    }).catch((e: Error) => e);

    if (res instanceof Error) {
      failures.push(`${model}: ${res.message}`);
      continue;
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      failures.push(`${model}: HTTP ${res.status}`);
      logger.warn(`${model} -> ${res.status} ${detail}`);
      if (TRY_NEXT_MODEL.has(res.status)) continue;
      throw new Error(`Gemini ${model} HTTP ${res.status}: ${detail}`); // e.g. 400/401: not model-specific
    }

    const json = (await res.json()) as GeminiResponse;
    if (json.promptFeedback?.blockReason) throw new Error(`Gemini blocked the prompt (${json.promptFeedback.blockReason})`);
    const candidate = json.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('Gemini output was truncated (MAX_TOKENS)');
    return {
      text: candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '',
      model: json.modelVersion ?? model,
      inputTokens: json.usageMetadata?.promptTokenCount ?? null,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? null,
    };
  }
  throw new Error(`All Gemini models unavailable (${failures.join('; ')})`);
}
