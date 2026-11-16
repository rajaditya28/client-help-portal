import type { HelpRequestDto } from '@help/shared';

export type StageState = 'done' | 'current' | 'pending' | 'skipped' | 'failed';

export interface Stage {
  key: 'raised' | 'call' | 'recorded' | 'summary' | 'resolved';
  label: string;
  state: StageState;
}

const STATE_TEXT: Record<StageState, string> = {
  done: 'done',
  current: 'in progress',
  pending: 'not yet',
  skipped: 'skipped',
  failed: 'failed',
};
export const stateText = (s: StageState) => STATE_TEXT[s];

/**
 * A request's lifecycle, derived only from real state: the request's own status and its newest call's
 * status and processing status. Nothing here is guessed or animated for show.
 */
export function trackOf(r: HelpRequestDto): Stage[] {
  const c = r.latestCall;
  const p = c?.processingStatus;
  const ended = c?.status === 'ENDED';

  const call: StageState = !c ? 'pending' : ended ? 'done' : 'current';

  let recorded: StageState = 'pending';
  if (p === 'RECORDING') recorded = 'current';
  else if (p === 'QUEUED' || p === 'PROCESSING' || p === 'READY' || p === 'FAILED') recorded = 'done';
  else if (ended && p === 'NOT_RECORDED') recorded = 'skipped';

  let summary: StageState = 'pending';
  if (p === 'READY') summary = 'done';
  else if (p === 'FAILED') summary = 'failed';
  else if (p === 'QUEUED' || p === 'PROCESSING') summary = 'current';
  else if (recorded === 'skipped') summary = 'skipped';

  return [
    { key: 'raised', label: 'Raised', state: 'done' },
    { key: 'call', label: 'On a call', state: call },
    { key: 'recorded', label: recorded === 'skipped' ? 'Not recorded' : 'Recorded', state: recorded },
    { key: 'summary', label: summary === 'failed' ? 'Summary failed' : 'Summary', state: summary },
    { key: 'resolved', label: 'Resolved', state: r.status === 'RESOLVED' ? 'done' : 'pending' },
  ];
}

/** Short, stable reference for a request, shown like a ticket number. */
export const ticketRef = (id: string) => `#${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
