/**
 * Shared contract between the API and the web app.
 * Types only describe what crosses the wire; persistence models live in the API.
 */

export type Role = 'CONSULTANT' | 'CLIENT';

export type RequestStatus = 'OPEN' | 'IN_CALL' | 'RESOLVED';

export type CallStatus = 'RINGING' | 'ACTIVE' | 'ENDED';

export type ConsentStatus = 'PENDING' | 'GRANTED' | 'DECLINED';

/** Lifecycle of the call's recording and the post-call AI pipeline. */
export type ProcessingStatus =
  | 'NOT_RECORDED' // client declined, or the call ended before consent
  | 'RECORDING' // chunks are being uploaded while the call runs
  | 'QUEUED' // call ended, pipeline jobs enqueued
  | 'PROCESSING' // finalizing / transcribing / summarizing
  | 'READY'
  | 'FAILED';

export interface UserDto {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface LoginResponse {
  accessToken: string;
  user: UserDto;
}

export interface HelpRequestDto {
  id: string;
  title: string;
  description: string;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
  client: Pick<UserDto, 'id' | 'name'>;
  consultant: Pick<UserDto, 'id' | 'name'>;
  /** The call currently in progress for this request, if any. */
  activeCallId: string | null;
}

export interface CallDto {
  id: string;
  requestId: string;
  requestTitle: string;
  status: CallStatus;
  consent: ConsentStatus;
  processingStatus: ProcessingStatus;
  processingError: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  client: Pick<UserDto, 'id' | 'name'>;
  consultant: Pick<UserDto, 'id' | 'name'>;
  hasRecording: boolean;
  recordingDurationMs: number | null;
}

export interface TranscriptSegmentDto {
  speaker: string; // display name, e.g. "Asha (client)"
  role: Role | null; // null when the speaker could not be attributed
  startMs: number;
  endMs: number;
  text: string;
}

export interface SummaryDto {
  overview: string;
  problem: string;
  stepsTaken: string[];
  resolution: string;
  followUps: string[];
}

export interface CallDetailDto extends CallDto {
  transcript: TranscriptSegmentDto[] | null;
  summary: SummaryDto | null;
  summaryModel: string | null;
}

/* ---------------------------- Realtime (socket.io) ---------------------------- */

export const SocketEvents = {
  // server -> client
  RequestCreated: 'request:created',
  RequestUpdated: 'request:updated',
  CallUpdated: 'call:updated',
  PeerJoined: 'call:peer-joined',
  PeerLeft: 'call:peer-left',
  Signal: 'rtc:signal',
  // client -> server
  JoinCall: 'call:join',
  LeaveCall: 'call:leave',
} as const;

export interface JoinCallAck {
  ok: boolean;
  error?: string;
  /** Roles of participants already connected to the call room (excluding the caller). */
  peers: Role[];
}

/**
 * `nid` (negotiation id) identifies one offer/answer exchange. The consultant bumps it for every
 * new peer connection; answers and ICE candidates carry the nid they belong to, so stale
 * messages from a superseded negotiation (e.g. a quick refresh) are dropped instead of applied.
 */
export type SignalPayload =
  | { kind: 'offer'; nid: number; sdp: string }
  | { kind: 'answer'; nid: number; sdp: string }
  | { kind: 'candidate'; nid: number; candidate: RTCIceCandidateLike }
  /**
   * Client -> consultant: screen share started/stopped. Explicit, because a stopped share just
   * stops sending frames and the receiving <video> would otherwise keep showing the last one.
   */
  | { kind: 'screen'; sharing: boolean };

/** Structural copy of RTCIceCandidateInit so the API does not need DOM typings. */
export interface RTCIceCandidateLike {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface SignalMessage {
  callId: string;
  from?: Role;
  payload: SignalPayload;
}

/** Recording chunks are uploaded every few seconds while the call runs. */
export const RECORDING_TIMESLICE_MS = 4000;
/** Hard cap so a forgotten call cannot run (and bill STT/LLM) forever. */
export const MAX_CALL_DURATION_MS = 30 * 60 * 1000;
