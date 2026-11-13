import { Global, Logger, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { GeminiSummarizer } from './gemini-summarizer';
import { AnthropicSummarizer, MockSummarizer, Summarizer } from './summarizer';
import { DeepgramTranscriptionProvider, MockTranscriptionProvider, TranscriptionProvider } from './transcription';

const logger = new Logger('AiModule');

/** Providers are chosen by env. With no keys the app still runs end to end on mocks. */
@Global()
@Module({
  providers: [
    {
      provide: TranscriptionProvider,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => {
        if (cfg.DEEPGRAM_API_KEY) return new DeepgramTranscriptionProvider(cfg.DEEPGRAM_API_KEY);
        logger.warn('DEEPGRAM_API_KEY not set: using mock transcription');
        return new MockTranscriptionProvider();
      },
    },
    {
      provide: Summarizer,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => {
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
      },
    },
  ],
  exports: [TranscriptionProvider, Summarizer],
})
export class AiModule {}
