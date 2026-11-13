import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import type { Job } from '@prisma/client';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { PipelineService } from '../calls/pipeline.service';
import { JobsService } from './jobs.service';

/**
 * In-process worker loop. Runs inside the API so the whole app is one deployable;
 * because claiming uses SKIP LOCKED it can be split into a separate process later
 * without code changes (set JOBS_ENABLED=false on the web instances).
 */
@Injectable()
export class JobWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobWorker.name);
  private running = false;
  private loop: Promise<void> | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly jobs: JobsService,
    private readonly pipeline: PipelineService,
  ) {}

  onApplicationBootstrap() {
    if (!this.cfg.JOBS_ENABLED) return;
    this.running = true;
    this.loop = this.run();
    this.logger.log('Background worker started');
  }

  async onApplicationShutdown() {
    this.running = false;
    await this.loop;
  }

  private async run() {
    await this.jobs.recoverStale().catch((e) => this.logger.error(e));
    while (this.running) {
      let job: Job | null = null;
      try {
        job = await this.jobs.claimNext();
      } catch (e) {
        this.logger.error(`Failed to claim job: ${(e as Error).message}`);
      }
      if (!job) {
        await new Promise((r) => setTimeout(r, this.cfg.JOB_POLL_INTERVAL_MS));
        continue;
      }
      await this.execute(job);
    }
  }

  async execute(job: Job) {
    const started = Date.now();
    this.logger.log(`▶ ${job.type} call=${job.callId} attempt=${job.attempts}`);
    try {
      await this.pipeline.handle(job);
      const ms = Date.now() - started;
      await this.jobs.markDone(job, ms);
      this.logger.log(`✔ ${job.type} call=${job.callId} in ${ms}ms`);
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      const willRetry = await this.jobs.markFailed(job, message);
      this.logger.error(`✖ ${job.type} call=${job.callId}: ${message} (${willRetry ? 'will retry' : 'giving up'})`);
      if (!willRetry) await this.pipeline.onPermanentFailure(job, message);
    }
  }
}
