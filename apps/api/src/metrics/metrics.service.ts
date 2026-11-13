import { Injectable } from '@nestjs/common';
import type { CallCostDto, MetricsDto, PipelineStep, StepMetricsDto } from '@help/shared';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { llmUsd, PRICING_NOTE, sttUsd } from './pricing';

const STEPS: PipelineStep[] = ['FINALIZE_RECORDING', 'TRANSCRIBE', 'SUMMARIZE'];

interface StepRow {
  type: PipelineStep;
  done: bigint;
  failed: bigint;
  pending: bigint;
  retries: bigint | null;
  p50: number | null;
  p95: number | null;
}

/**
 * Pipeline telemetry for the consultant's own calls, computed from data the system already
 * records (job durations/attempts/errors, recording length, token usage). No separate metrics
 * store: at this scale Postgres aggregates are instant, and the numbers can't drift from reality.
 */
@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async forConsultant(user: AuthUser): Promise<MetricsDto> {
    const consultantId = user.id; // scoped like every other query: only this consultant's calls

    const [stepRows, e2e, counts, recent, failures] = await Promise.all([
      this.prisma.$queryRaw<StepRow[]>`
        SELECT j.type,
               count(*) FILTER (WHERE j.status = 'DONE')                       AS done,
               count(*) FILTER (WHERE j.status = 'FAILED')                     AS failed,
               count(*) FILTER (WHERE j.status IN ('QUEUED', 'RUNNING'))       AS pending,
               sum(j.attempts - 1) FILTER (WHERE j.status = 'DONE')            AS retries,
               percentile_cont(0.5)  WITHIN GROUP (ORDER BY j."durationMs") FILTER (WHERE j.status = 'DONE') AS p50,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY j."durationMs") FILTER (WHERE j.status = 'DONE') AS p95
          FROM "Job" j JOIN "Call" c ON c.id = j."callId"
         WHERE c."consultantId" = ${consultantId}
         GROUP BY j.type`,
      this.prisma.$queryRaw<{ p50: number | null; p95: number | null }[]>`
        SELECT percentile_cont(0.5)  WITHIN GROUP (ORDER BY ms) AS p50,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) AS p95
          FROM (SELECT EXTRACT(EPOCH FROM (s."createdAt" - c."endedAt")) * 1000 AS ms
                  FROM "Summary" s JOIN "Call" c ON c.id = s."callId"
                 WHERE c."consultantId" = ${consultantId} AND c."endedAt" IS NOT NULL) t`,
      this.prisma.call.groupBy({ by: ['processingStatus'], where: { consultantId }, _count: true }),
      this.prisma.call.findMany({
        where: { consultantId, summary: { isNot: null } },
        orderBy: { endedAt: 'desc' },
        take: 15,
        include: {
          request: { select: { title: true } },
          client: { select: { name: true } },
          recording: { select: { durationMs: true } },
          transcript: { select: { provider: true } },
          summary: { select: { model: true, inputTokens: true, outputTokens: true, createdAt: true } },
        },
      }),
      this.prisma.job.findMany({
        where: { status: 'FAILED', call: { consultantId } },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        include: { call: { select: { request: { select: { title: true } } } } },
      }),
    ]);

    const byStep = new Map(stepRows.map((r) => [r.type, r]));
    const steps: StepMetricsDto[] = STEPS.map((step) => {
      const r = byStep.get(step);
      return {
        step,
        done: Number(r?.done ?? 0),
        failed: Number(r?.failed ?? 0),
        pending: Number(r?.pending ?? 0),
        retries: Number(r?.retries ?? 0),
        p50Ms: r?.p50 == null ? null : Math.round(r.p50),
        p95Ms: r?.p95 == null ? null : Math.round(r.p95),
      };
    });

    const count = (s: string) => counts.find((c) => c.processingStatus === s)?._count ?? 0;
    const callsTotal = counts.reduce((n, c) => n + c._count, 0);

    const recentCalls: CallCostDto[] = recent.map((c) => {
      const recordingMs = c.recording?.durationMs ?? null;
      const s = c.summary!;
      return {
        callId: c.id,
        requestTitle: c.request.title,
        clientName: c.client.name,
        endedAt: c.endedAt?.toISOString() ?? null,
        recordingMs,
        timeToSummaryMs: c.endedAt ? s.createdAt.getTime() - c.endedAt.getTime() : null,
        sttProvider: c.transcript?.provider ?? null,
        llmModel: s.model,
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        sttUsd: sttUsd(c.transcript?.provider ?? null, recordingMs),
        llmUsd: llmUsd(s.model, s.inputTokens, s.outputTokens),
      };
    });
    const totalUsd = recentCalls.reduce((n, c) => n + c.sttUsd + c.llmUsd, 0);

    return {
      generatedAt: new Date().toISOString(),
      callsTotal,
      callsRecorded: callsTotal - count('NOT_RECORDED'),
      callsReady: count('READY'),
      callsFailed: count('FAILED'),
      timeToSummaryP50Ms: e2e[0]?.p50 == null ? null : Math.round(e2e[0].p50),
      timeToSummaryP95Ms: e2e[0]?.p95 == null ? null : Math.round(e2e[0].p95),
      steps,
      totalUsd,
      avgUsdPerReadyCall: recentCalls.length ? totalUsd / recentCalls.length : null,
      pricingNote: PRICING_NOTE,
      recentCalls,
      recentFailures: failures.map((j) => ({
        callId: j.callId,
        requestTitle: j.call.request.title,
        step: j.type,
        attempts: j.attempts,
        error: j.lastError ?? 'unknown error',
        at: j.updatedAt.toISOString(),
      })),
    };
  }
}
