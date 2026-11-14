import type { Call, HelpRequest, Recording, Summary, Transcript, User } from '@prisma/client';
import type { CallDetailDto, CallDto, HelpRequestDto, SummaryDto, TranscriptSegmentDto } from '@help/shared';

type Person = Pick<User, 'id' | 'name'>;
const person = (u: Person) => ({ id: u.id, name: u.name });

export const PERSON_SELECT = { select: { id: true, name: true } } as const;

export type RequestRow = HelpRequest & {
  client: Person;
  consultant: Person;
  /** All calls for the request, newest first. */
  calls: Pick<Call, 'id' | 'status'>[];
};

export function toRequestDto(r: RequestRow): HelpRequestDto {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    client: person(r.client),
    consultant: person(r.consultant),
    activeCallId: r.calls.find((c) => c.status !== 'ENDED')?.id ?? null,
    lastCallId: r.calls.find((c) => c.status === 'ENDED')?.id ?? null,
  };
}

export type CallRow = Call & {
  request: Pick<HelpRequest, 'title'>;
  client: Person;
  consultant: Person;
  recording: Pick<Recording, 'durationMs'> | null;
};

export function toCallDto(c: CallRow): CallDto {
  return {
    id: c.id,
    requestId: c.requestId,
    requestTitle: c.request.title,
    status: c.status,
    consent: c.consent,
    processingStatus: c.processingStatus,
    processingError: c.processingError,
    createdAt: c.createdAt.toISOString(),
    startedAt: c.startedAt?.toISOString() ?? null,
    endedAt: c.endedAt?.toISOString() ?? null,
    client: person(c.client),
    consultant: person(c.consultant),
    hasRecording: !!c.recording,
    recordingDurationMs: c.recording?.durationMs ?? null,
  };
}

export type CallDetailRow = CallRow & {
  transcript: Pick<Transcript, 'segments'> | null;
  summary: Pick<Summary, 'content' | 'model'> | null;
};

export function toCallDetailDto(c: CallDetailRow): CallDetailDto {
  return {
    ...toCallDto(c),
    transcript: (c.transcript?.segments as unknown as TranscriptSegmentDto[] | undefined) ?? null,
    summary: (c.summary?.content as unknown as SummaryDto | undefined) ?? null,
    summaryModel: c.summary?.model ?? null,
  };
}

/** Prisma `include` that produces a CallRow. */
export const CALL_INCLUDE = {
  request: { select: { title: true } },
  client: PERSON_SELECT,
  consultant: PERSON_SELECT,
  recording: { select: { durationMs: true } },
} as const;
