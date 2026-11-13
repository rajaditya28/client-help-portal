import { Injectable, Logger } from '@nestjs/common';
import {
  buildUserPrompt,
  emptyCallSummary,
  parseSummary,
  Summarizer,
  SUMMARY_JSON_SCHEMA,
  SummaryInput,
  SummaryResult,
  SYSTEM_PROMPT,
} from './summarizer';

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  modelVersion?: string;
  promptFeedback?: { blockReason?: string };
}

/** Statuses where trying the next model makes sense (overloaded, rate-limited, model gone). */
const TRY_NEXT_MODEL = new Set([404, 429, 500, 503]);

/**
 * Gemini via its REST API (one endpoint, no SDK surface to track).
 *
 * Free-tier capacity varies minute to minute per model ("high demand" 503s), so this walks an
 * ordered list of models and uses the first that answers. If every model fails, it throws and
 * the job queue retries later with backoff.
 */
@Injectable()
export class GeminiSummarizer extends Summarizer {
  private readonly logger = new Logger(GeminiSummarizer.name);

  constructor(
    private readonly apiKey: string,
    private readonly models: string[],
  ) {
    super();
  }

  async summarize(input: SummaryInput): Promise<SummaryResult> {
    if (!input.transcript.length) {
      return { summary: emptyCallSummary(), model: 'none (empty transcript)', inputTokens: 0, outputTokens: 0 };
    }

    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: buildUserPrompt(input) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: SUMMARY_JSON_SCHEMA,
        temperature: 0.2,
      },
    });

    const failures: string[] = [];
    for (const model of this.models) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
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
        this.logger.warn(`Gemini ${model} -> ${res.status} ${detail}`);
        if (TRY_NEXT_MODEL.has(res.status)) continue;
        throw new Error(`Gemini ${model} HTTP ${res.status}: ${detail}`); // e.g. 400/401: not model-specific
      }

      const json = (await res.json()) as GeminiResponse;
      if (json.promptFeedback?.blockReason) throw new Error(`Gemini blocked the prompt (${json.promptFeedback.blockReason})`);
      const candidate = json.candidates?.[0];
      if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('Summary was truncated (MAX_TOKENS)');
      const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

      const summary = parseSummary(text, this.logger);
      const inputTokens = json.usageMetadata?.promptTokenCount ?? null;
      const outputTokens = json.usageMetadata?.candidatesTokenCount ?? null;
      const served = json.modelVersion ?? model;
      this.logger.log(`Summary by ${served}: in=${inputTokens} out=${outputTokens} tokens`);
      return { summary, model: served, inputTokens, outputTokens };
    }
    throw new Error(`All Gemini models unavailable (${failures.join('; ')})`);
  }
}
