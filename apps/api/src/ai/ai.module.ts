import { Global, Logger, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { Summarizer } from './summarizer';
import { createSummarizer } from './summarizer-factory';
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
    { provide: Summarizer, inject: [APP_CONFIG], useFactory: createSummarizer },
  ],
  exports: [TranscriptionProvider, Summarizer],
})
export class AiModule {}
