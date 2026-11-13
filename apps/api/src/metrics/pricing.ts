/**
 * List prices used for cost estimates on the ops page. Estimates only; the providers' bills are
 * the source of truth. Keep in one place so a price change is a one-line diff.
 */

/** Deepgram nova-3 pre-recorded ($0.0043/min) + diarization add-on ($0.0020/min). */
export const DEEPGRAM_USD_PER_MIN = 0.0063;

/** USD per million tokens [input, output]. Gemini runs on the free tier here, so $0. */
const LLM_USD_PER_MTOK: { match: RegExp; price: [number, number] }[] = [
  { match: /^claude-opus-5-5/, price: [4, 20] },
  { match: /^claude-sonnet-5-5/, price: [2, 10] },
  { match: /^claude-haiku-5-5/, price: [0.1, 0.5] },
  { match: /^gemini/, price: [0, 0] },
];

export const PRICING_NOTE =
  'Estimates at list price: Deepgram nova-3 + diarization $0.0063/min; Gemini on the free tier ($0); Claude at per-token list price.';

export function sttUsd(provider: string | null, recordingMs: number | null): number {
  if (!provider?.startsWith('deepgram') || !recordingMs) return 0;
  return (recordingMs / 60_000) * DEEPGRAM_USD_PER_MIN;
}

export function llmUsd(model: string | null, inputTokens: number | null, outputTokens: number | null): number {
  if (!model) return 0;
  const p = LLM_USD_PER_MTOK.find((x) => x.match.test(model))?.price;
  if (!p) return 0;
  return ((inputTokens ?? 0) * p[0] + (outputTokens ?? 0) * p[1]) / 1_000_000;
}
