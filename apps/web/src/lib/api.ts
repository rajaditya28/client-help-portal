import type {
  CallDetailDto,
  CallDto,
  HelpRequestDto,
  LoginResponse,
  UserDto,
} from '@help/shared';

/**
 * The session lives in sessionStorage, not localStorage or a cookie: it is per tab, so two
 * windows can be logged in as two different users (the demo setup), and it survives a refresh.
 */
const SESSION_KEY = 'hp.session';

export interface Session {
  token: string;
  user: UserDto;
}

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else sessionStorage.removeItem(SESSION_KEY);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = loadSession();
  const headers = new Headers(init.headers);
  if (session) headers.set('Authorization', `Bearer ${session.token}`);
  if (init.body && typeof init.body === 'string') headers.set('Content-Type', 'application/json');

  const res = await fetch(`/api${path}`, { ...init, headers });
  if (res.status === 401 && session) onUnauthorized();
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? message);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  login: (email: string, password: string) => post<LoginResponse>('/auth/login', { email, password }),

  listRequests: () => request<HelpRequestDto[]>('/requests'),
  createRequest: (title: string, description: string) => post<HelpRequestDto>('/requests', { title, description }),
  resolveRequest: (id: string) => post<HelpRequestDto>(`/requests/${id}/resolve`),

  rtcConfig: () => request<{ iceServers: RTCIceServer[] }>('/rtc-config'),
  startCall: (requestId: string) => post<CallDto>('/calls', { requestId }),
  getCall: (id: string) => request<CallDetailDto>(`/calls/${id}`),
  listCalls: () => request<CallDto[]>('/calls'),
  consent: (id: string, granted: boolean) => post<CallDto>(`/calls/${id}/consent`, { granted }),
  endCall: (id: string) => post<CallDto>(`/calls/${id}/end`),
  completeRecording: (id: string) => post<void>(`/calls/${id}/recording/complete`),
  recordingUrl: (id: string) => request<{ url: string }>(`/calls/${id}/recording/url`),

  /** Raw binary upload of one recorder chunk. Throws ApiError so the caller can decide to retry. */
  async uploadChunk(callId: string, segment: number, seq: number, offsetMs: number, blob: Blob, activity: unknown) {
    const session = loadSession();
    const params = new URLSearchParams({ segment: String(segment), seq: String(seq), offsetMs: String(offsetMs) });
    const res = await fetch(`/api/calls/${callId}/recording/chunks?${params}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        Authorization: `Bearer ${session?.token ?? ''}`,
        'X-Activity': JSON.stringify(activity),
      },
      body: blob,
    });
    if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
    return (await res.json()) as { stored: boolean };
  },
};
