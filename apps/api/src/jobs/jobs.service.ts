import { Injectable, Logger } from '@nestjs/common';
import { Job, JobType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/** A job left RUNNING this long is assumed to belong to a crashed worker and is re-queued. */
const STALE_LOCK_MS = 10 * 60 * 1000;

/**
 * Durable job queue on Postgres.
 *
 * Why not Redis/BullMQ: one fewer service to run and deploy, jobs commit in the same
 * transaction as the state change that creates them, and `FOR UPDATE SKIP LOCKED`
 * lets several API instances share the queue without double-processing.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Idempotent: a call has at most one job per type (unique [callId, type]). */
  async enqueue(type: JobType, callId: string, opts: { runAt?: Date; tx?: Tx } = {}): Promise<void> {
    const db = opts.tx ?? this.prisma;
    await db.job.upsert({
      where: { callId_type: { callId, type } },
      create: { type, callId, runAt: opts.runAt ?? new Date() },
      update: {},
    });
  }

  /** Pull a queued job forward (e.g. the recorder confirmed its last chunk is uploaded). */
  async runNow(type: JobType, callId: string): Promise<void> {
    await this.prisma.job.updateMany({ where: { callId, type, status: 'QUEUED' }, data: { runAt: new Date() } });
  }

  async claimNext(): Promise<Job | null> {
    const rows = await this.prisma.$queryRaw<Job[]>`
      UPDATE "Job"
         SET status = 'RUNNING', "lockedAt" = now(), attempts = attempts + 1, "updatedAt" = now()
       WHERE id = (
         SELECT id FROM "Job"
          WHERE status = 'QUEUED' AND "runAt" <= now()
          ORDER BY "runAt"
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
      RETURNING *`;
    return rows[0] ?? null;
  }

  async markDone(job: Job, durationMs: number): Promise<void> {
    await this.prisma.job.update({
      where: { id: job.id },
      data: { status: 'DONE', lockedAt: null, lastError: null, durationMs },
    });
  }

  /** Returns true when the job will be retried, false when it has permanently failed. */
  async markFailed(job: Job, error: string): Promise<boolean> {
    const retry = job.attempts < job.maxAttempts;
    const backoffMs = 5_000 * 2 ** (job.attempts - 1); // 5s, 10s, 20s...
    await this.prisma.job.update({
      where: { id: job.id },
      data: {
        status: retry ? 'QUEUED' : 'FAILED',
        lockedAt: null,
        lastError: error.slice(0, 2000),
        runAt: retry ? new Date(Date.now() + backoffMs) : undefined,
      },
    });
    return retry;
  }

  async recoverStale(): Promise<void> {
    const { count } = await this.prisma.job.updateMany({
      where: { status: 'RUNNING', lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
      data: { status: 'QUEUED', lockedAt: null },
    });
    if (count) this.logger.warn(`Re-queued ${count} stale job(s)`);
  }
}
