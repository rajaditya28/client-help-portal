import { Injectable, Logger } from '@nestjs/common';
import { geminiGenerateJson } from './gemini-client';
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

/** Gemini summaries: same prompt, schema and validation as the Claude summarizer. */
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
    const r = await geminiGenerateJson({
      apiKey: this.apiKey,
      models: this.models,
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(input),
      schema: SUMMARY_JSON_SCHEMA,
    });
    const summary = parseSummary(r.text, this.logger);
    this.logger.log(`Summary by ${r.model}: in=${r.inputTokens} out=${r.outputTokens} tokens`);
    return { summary, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens };
  }
}
