import { Logger } from '@nestjs/common';
import type { AppConfig } from '../config/app-config';
import { GeminiSummarizer } from './gemini-summarizer';
import { AnthropicSummarizer, MockSummarizer, Summarizer } from './summarizer';

const logger = new Logger('AiModule');

/** Shared by the app and the eval harness, so the eval always tests what production runs. */
export function createSummarizer(cfg: AppConfig): Summarizer {
  const p = cfg.SUMMARY_PROVIDER;
  if ((p === 'auto' || p === 'anthropic') && cfg.ANTHROPIC_API_KEY) {
    logger.log(`Summaries: Anthropic (${cfg.SUMMARY_MODEL})`);
    return new AnthropicSummarizer(cfg.ANTHROPIC_API_KEY, cfg.SUMMARY_MODEL);
  }
  if ((p === 'auto' || p === 'gemini') && cfg.GEMINI_API_KEY) {
    logger.log(`Summaries: Gemini (${cfg.GEMINI_MODELS.join(' -> ')})`);
    return new GeminiSummarizer(cfg.GEMINI_API_KEY, cfg.GEMINI_MODELS);
  }
  if (p !== 'mock' && p !== 'auto') throw new Error(`SUMMARY_PROVIDER=${p} but its API key is not set`);
  logger.warn('No LLM API key set: using mock summarizer');
  return new MockSummarizer();
}
