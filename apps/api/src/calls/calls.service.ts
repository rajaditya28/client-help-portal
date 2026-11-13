import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Call } from '@prisma/client';
import { CallDetailDto, CallDto, MAX_CALL_DURATION_MS, SocketEvents } from '@help/shared';
import type { AuthUser } from '../auth/auth.types';
import { ownedBy } from '../common/access';
import { CALL_INCLUDE, toCallDetailDto, toCallDto } from '../common/mappers';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RequestsService } from '../requests/requests.service';
import { StorageService, storageKeys } from '../storage/storage.service';

/**
 * After a call ends we wait this long before finalising the recording, so the
 * recorder's last in-flight chunk can land. The recorder normally shortcuts this
 * by calling `completeRecording` once its final upload succeeds.
 */
const FINALIZE_GRACE_MS = 20_000;

export interface ChunkInput {
  segment: number;
  seq: number;
  segmentOffsetMs: number;
  body: Buffer;
  activity: unknown;
}

@Injectable()
export class CallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly requests: RequestsService,
    private readonly jobs: JobsService,
    private readonly storage: StorageService,
  ) {}

  /* ------------------------------------------------------------------ reads */

  async history(user: AuthUser): Promise<CallDto[]> {
    const rows = await this.prisma.call.findMany({
      where: ownedBy(user),
      include: CALL_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toCallDto);
  }

  async detail(user: AuthUser, callId: string): Promise<CallDetailDto> {
    const row = await this.prisma.call.findFirst({
      where: { id: callId, ...ownedBy(user) },
      include: { ...CALL_INCLUDE, transcript: { select: { segments: true } }, summary: { select: { content: true, model: true } } },
    });
    if (!row) throw new NotFoundException('Call not found');
    return toCallDetailDto(row);
  }

  /** The one ownership check every call mutation goes through. */
  private async findOwned(user: AuthUser, callId: string): Promise<Call> {
    const call = await this.prisma.call.findFirst({ where: { id: callId, ...ownedBy(user) } });
    if (!call) throw new NotFoundException('Call not found');
    return call;
  }

  /* -------------------------------------------------------------- lifecycle */

  /** Consultant starts a call from a request. Idempotent: returns the existing live call if there is one. */
  async start(consultant: AuthUser, requestId: string): Promise<CallDto> {
    const request = await this.prisma.helpRequest.findFirst({ where: { id: requestId, ...ownedBy(consultant) } });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status === 'RESOLVED') throw new BadRequestException('Request is already resolved');

    const existing = await this.prisma.call.findFirst({
      where: { requestId, status: { not: 'ENDED' } },
      include: CALL_INCLUDE,
    });
    if (existing) return toCallDto(existing);

    const call = await this.prisma.$transaction(async (tx) => {
      await tx.helpRequest.update({ where: { id: requestId }, data: { status: 'IN_CALL' } });
      return tx.call.create({
        data: { requestId, clientId: request.clientId, consultantId: request.consultantId },
        include: CALL_INCLUDE,
      });
    });
    await this.requests.refreshAndPublish(requestId);
    return this.publish(toCallDto(call));
  }

  /**
   * Called by the socket gateway when a participant joins the call room.
   * Returns null when the user may not join (not a participant, or the call ended).
   */
  async markJoined(user: AuthUser, callId: string): Promise<Call | null> {
    const call = await this.prisma.call.findFirst({ where: { id: callId, ...ownedBy(user), status: { not: 'ENDED' } } });
    if (!call) return null;
    if (user.role === 'CLIENT' && call.status === 'RINGING') {
      const updated = await this.prisma.call.update({
        where: { id: callId },
        data: { status: 'ACTIVE', startedAt: new Date() },
        include: CALL_INCLUDE,
      });
      this.publish(toCallDto(updated));
      return updated;
    }
    return call;
  }

  /** Only the client can consent. Recording cannot start (and chunks are rejected) until they do. */
  async setConsent(client: AuthUser, callId: string, granted: boolean): Promise<CallDto> {
    const call = await this.findOwned(client, callId);
    if (call.status === 'ENDED') throw new BadRequestException('Call has ended');
    if (call.consent === 'GRANTED') {
      if (granted) return this.callDto(callId);
      throw new ConflictException('Recording has already started');
    }
    const updated = await this.prisma.call.update({
      where: { id: callId },
      data: granted
        ? { consent: 'GRANTED', consentAt: new Date(), processingStatus: 'RECORDING' }
        : { consent: 'DECLINED', consentAt: new Date() },
      include: CALL_INCLUDE,
    });
    return this.publish(toCallDto(updated));
  }

  /** Either participant may end the call. */
  async end(user: AuthUser, callId: string): Promise<CallDto> {
    const call = await this.findOwned(user, callId);
    if (call.status === 'ENDED') return this.callDto(callId);
    return this.endInternal(call);
  }

  private async endInternal(call: Call): Promise<CallDto> {
    const recorded = call.consent === 'GRANTED';

    const updated = await this.prisma.$transaction(async (tx) => {
      // Guarded update: if two "end" requests race, only one performs the transition.
      const { count } = await tx.call.updateMany({
        where: { id: call.id, status: { not: 'ENDED' } },
        data: { status: 'ENDED', endedAt: new Date(), processingStatus: recorded ? 'QUEUED' : 'NOT_RECORDED' },
      });
      if (count && recorded) {
        // Enqueue even if no chunk has landed yet: the last chunk may still be in flight.
        // If none ever arrives, the finaliser marks the call NOT_RECORDED.
        await this.jobs.enqueue('FINALIZE_RECORDING', call.id, { runAt: new Date(Date.now() + FINALIZE_GRACE_MS), tx });
      }
      await tx.helpRequest.updateMany({ where: { id: call.requestId, status: 'IN_CALL' }, data: { status: 'OPEN' } });
      return tx.call.findUniqueOrThrow({ where: { id: call.id }, include: CALL_INCLUDE });
    });

    await this.requests.refreshAndPublish(call.requestId);
    return this.publish(toCallDto(updated));
  }

  /* -------------------------------------------------------------- recording */

  /**
   * Stores one recorder chunk. Enforced server-side:
   *  - only the consultant (the recorder) of this call can upload,
   *  - only after the client consented,
   *  - only until post-processing has started.
   * Re-uploading the same (segment, seq) is a no-op, so client retries are safe.
   */
  async uploadChunk(consultant: AuthUser, callId: string, input: ChunkInput): Promise<{ stored: boolean }> {
    const call = await this.findOwned(consultant, callId);
    if (call.consent !== 'GRANTED') throw new ConflictException('The client has not consented to recording');
    if (call.processingStatus !== 'RECORDING' && call.processingStatus !== 'QUEUED') {
      throw new ConflictException('Recording is closed for this call');
    }
    if (call.startedAt && Date.now() - call.startedAt.getTime() > MAX_CALL_DURATION_MS + 60_000) {
      throw new ConflictException('Maximum call duration exceeded');
    }

    const key = storageKeys.chunk(callId, input.segment, input.seq);
    const exists = await this.prisma.recordingChunk.findUnique({
      where: { callId_segment_seq: { callId, segment: input.segment, seq: input.seq } },
    });
    if (exists) return { stored: false };

    await this.storage.put(key, input.body, 'video/webm');
    await this.prisma.recordingChunk.upsert({
      where: { callId_segment_seq: { callId, segment: input.segment, seq: input.seq } },
      create: {
        callId,
        segment: input.segment,
        seq: input.seq,
        segmentOffsetMs: input.segmentOffsetMs,
        sizeBytes: input.body.length,
        storageKey: key,
        activity: (input.activity ?? undefined) as never,
      },
      update: {},
    });
    return { stored: true };
  }

  /** The recorder confirms its final chunk is uploaded, so finalisation can start right away. */
  async completeRecording(consultant: AuthUser, callId: string): Promise<void> {
    const call = await this.findOwned(consultant, callId);
    if (call.status !== 'ENDED') return; // only meaningful once the call is over
    await this.jobs.runNow('FINALIZE_RECORDING', callId);
  }

  /** Key of the finished recording, after an ownership check. */
  async recordingKeyFor(user: AuthUser, callId: string): Promise<string> {
    const call = await this.prisma.call.findFirst({
      where: { id: callId, ...ownedBy(user) },
      include: { recording: { select: { storageKey: true } } },
    });
    if (!call?.recording) throw new NotFoundException('Recording not found');
    return call.recording.storageKey;
  }

  /* ---------------------------------------------------------------- helpers */

  async callDto(callId: string): Promise<CallDto> {
    const row = await this.prisma.call.findUniqueOrThrow({ where: { id: callId }, include: CALL_INCLUDE });
    return toCallDto(row);
  }

  /** Push the latest call state to both participants. */
  publish(dto: CallDto): CallDto {
    this.realtime.toUsers([dto.client.id, dto.consultant.id], SocketEvents.CallUpdated, dto);
    return dto;
  }

  async publishById(callId: string): Promise<void> {
    this.publish(await this.callDto(callId));
  }
}
