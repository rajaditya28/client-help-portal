import { Injectable, Logger } from '@nestjs/common';
import type { Job, RecordingChunk } from '@prisma/client';
import { ActivitySample, attributeSpeakers } from '../ai/speaker-attribution';
import { Summarizer } from '../ai/summarizer';
import { TranscriptionProvider } from '../ai/transcription';
import { JobsService } from '../jobs/jobs.service';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService, storageKeys } from '../storage/storage.service';
import { CallsService } from './calls.service';

/** Compact sample format sent by the browser recorder: { t, c: consultant, k: client }. */
interface RawSample {
  t: number;
  c: 0 | 1 | boolean;
  k: 0 | 1 | boolean;
}

/**
 * Post-call pipeline, one job per step so each step retries independently:
 *   FINALIZE_RECORDING -> TRANSCRIBE -> SUMMARIZE
 * Every step is idempotent (upserts keyed by callId), so a retry after a crash is safe.
 */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly media: MediaService,
    private readonly jobs: JobsService,
    private readonly calls: CallsService,
    private readonly stt: TranscriptionProvider,
    private readonly summarizer: Summarizer,
  ) {}

  async handle(job: Job): Promise<void> {
    switch (job.type) {
      case 'FINALIZE_RECORDING':
        return this.finalize(job.callId);
      case 'TRANSCRIBE':
        return this.transcribe(job.callId);
      case 'SUMMARIZE':
        return this.summarize(job.callId);
    }
  }

  async onPermanentFailure(job: Job, message: string): Promise<void> {
    const step = { FINALIZE_RECORDING: 'processing the recording', TRANSCRIBE: 'transcribing', SUMMARIZE: 'summarizing' }[
      job.type
    ];
    await this.prisma.call.update({
      where: { id: job.callId },
      data: { processingStatus: 'FAILED', processingError: `Failed while ${step}: ${message}`.slice(0, 500) },
    });
    await this.calls.publishById(job.callId);
  }

  private async setProcessing(callId: string) {
    await this.prisma.call.update({ where: { id: callId }, data: { processingStatus: 'PROCESSING', processingError: null } });
    await this.calls.publishById(callId);
  }

  /* ---------------------------------------------------------------- steps */

  private async finalize(callId: string) {
    await this.setProcessing(callId);

    const chunks = await this.prisma.recordingChunk.findMany({
      where: { callId },
      orderBy: [{ segment: 'asc' }, { seq: 'asc' }],
    });
    if (!chunks.length) {
      this.logger.warn(`call=${callId} ended with consent but no chunks arrived`);
      await this.prisma.call.update({ where: { id: callId }, data: { processingStatus: 'NOT_RECORDED' } });
      await this.calls.publishById(callId);
      return;
    }

    const bySegment = groupBySegment(chunks);
    const buffers: Buffer[][] = [];
    for (const segChunks of bySegment) {
      buffers.push(await Promise.all(segChunks.map((c) => this.storage.get(c.storageKey))));
    }

    const result = await this.media.finalize(buffers);
    const key = storageKeys.recording(callId);
    await this.storage.put(key, result.file, 'video/webm');
    await this.prisma.recording.upsert({
      where: { callId },
      create: {
        callId,
        storageKey: key,
        mimeType: 'video/webm',
        sizeBytes: result.file.length,
        durationMs: result.durationMs,
        segmentStartsMs: result.segmentStartsMs,
      },
      update: {
        sizeBytes: result.file.length,
        durationMs: result.durationMs,
        segmentStartsMs: result.segmentStartsMs,
      },
    });
    this.logger.log(
      `call=${callId} recording finalized: ${bySegment.length} segment(s), ${chunks.length} chunks, ${result.durationMs}ms`,
    );
    await this.jobs.enqueue('TRANSCRIBE', callId);
    // Publish so the history page can show the player before the transcript is ready.
    await this.calls.publishById(callId);
  }

  private async transcribe(callId: string) {
    await this.setProcessing(callId);
    const call = await this.prisma.call.findUniqueOrThrow({
      where: { id: callId },
      include: { recording: true, client: true, consultant: true },
    });
    if (!call.recording) throw new Error('Recording missing');

    const video = await this.storage.get(call.recording.storageKey);
    const audio = await this.media.extractAudio(video);
    const utterances = await this.stt.transcribe(audio, 'audio/webm', call.recording.durationMs);

    const activity = await this.activityTimeline(callId, call.recording.segmentStartsMs as number[]);
    const segments = attributeSpeakers(utterances, activity, {
      consultantName: call.consultant.name,
      clientName: call.client.name,
    });

    await this.prisma.transcript.upsert({
      where: { callId },
      create: { callId, segments: segments as never, provider: this.stt.name },
      update: { segments: segments as never, provider: this.stt.name },
    });
    this.logger.log(`call=${callId} transcript: ${segments.length} segments via ${this.stt.name}`);
    await this.jobs.enqueue('SUMMARIZE', callId);
  }

  private async summarize(callId: string) {
    await this.setProcessing(callId);
    const call = await this.prisma.call.findUniqueOrThrow({
      where: { id: callId },
      include: { transcript: true, request: true },
    });
    if (!call.transcript) throw new Error('Transcript missing');

    const result = await this.summarizer.summarize({
      requestTitle: call.request.title,
      requestDescription: call.request.description,
      transcript: call.transcript.segments as never,
    });
    await this.prisma.$transaction([
      this.prisma.summary.upsert({
        where: { callId },
        create: {
          callId,
          content: result.summary as never,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        },
        update: {
          content: result.summary as never,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        },
      }),
      this.prisma.call.update({ where: { id: callId }, data: { processingStatus: 'READY', processingError: null } }),
    ]);
    await this.calls.publishById(callId);
  }

  /** Maps each chunk's segment-relative voice-activity samples onto the final recording timeline. */
  private async activityTimeline(callId: string, segmentStartsMs: number[]): Promise<ActivitySample[]> {
    const chunks = await this.prisma.recordingChunk.findMany({
      where: { callId },
      select: { segment: true, activity: true },
      orderBy: [{ segment: 'asc' }, { seq: 'asc' }],
    });
    const segmentIndex = new Map<number, number>();
    for (const c of chunks) if (!segmentIndex.has(c.segment)) segmentIndex.set(c.segment, segmentIndex.size);

    const out: ActivitySample[] = [];
    for (const c of chunks) {
      if (!Array.isArray(c.activity)) continue;
      const offset = segmentStartsMs[segmentIndex.get(c.segment)!] ?? 0;
      for (const s of c.activity as unknown as RawSample[]) {
        if (typeof s?.t !== 'number') continue;
        out.push({ t: offset + s.t, consultant: !!s.c, client: !!s.k });
      }
    }
    return out;
  }
}

function groupBySegment(chunks: RecordingChunk[]): RecordingChunk[][] {
  const groups = new Map<number, RecordingChunk[]>();
  for (const c of chunks) {
    const g = groups.get(c.segment) ?? [];
    g.push(c);
    groups.set(c.segment, g);
  }
  return [...groups.values()];
}
