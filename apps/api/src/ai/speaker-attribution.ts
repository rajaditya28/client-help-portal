import type { Role, TranscriptSegmentDto } from '@help/shared';
import type { Utterance } from './transcription';

/** A voice-activity sample on the final recording timeline. */
export interface ActivitySample {
  t: number; // ms
  consultant: boolean;
  client: boolean;
}

export interface Participants {
  consultantName: string;
  clientName: string;
}

/**
 * Attributes each utterance to a participant.
 *
 * Primary signal, the browser's own measurements: the recorder sees the consultant's mic
 * and the client's remote audio as separate tracks, and samples whether each one is speaking.
 * An utterance goes to whoever was speaking (alone) during most of it. This is ground truth
 * when the two people are on different microphones, which is the real-world case.
 *
 * Fallback, provider diarization: when the activity is ambiguous (both or neither speaking,
 * e.g. both browser windows sharing one laptop mic during a demo), map each diarized
 * speaker to the role it most often co-occurred with; if that's unknown too, label
 * "Speaker N" with role null rather than guess.
 */
export function attributeSpeakers(
  utterances: Utterance[],
  activity: ActivitySample[],
  people: Participants,
): TranscriptSegmentDto[] {
  const sorted = [...activity].sort((a, b) => a.t - b.t);

  const voteFor = (u: Utterance): Role | null => {
    let consultant = 0;
    let client = 0;
    for (const s of samplesIn(sorted, u.startMs, u.endMs)) {
      if (s.consultant && !s.client) consultant++;
      else if (s.client && !s.consultant) client++;
    }
    if (consultant === client) return null;
    // Require a clear majority so cross-talk doesn't flip a line.
    const [hi, lo] = consultant > client ? [consultant, client] : [client, consultant];
    if (hi < 2 * lo) return null;
    return consultant > client ? 'CONSULTANT' : 'CLIENT';
  };

  const direct = utterances.map((u) => u.knownRole ?? voteFor(u));

  // Learn diarized-speaker -> role from the utterances the activity signal did decide.
  const tally = new Map<number, { CONSULTANT: number; CLIENT: number }>();
  utterances.forEach((u, i) => {
    const role = direct[i];
    if (u.speaker === null || !role) return;
    const t = tally.get(u.speaker) ?? { CONSULTANT: 0, CLIENT: 0 };
    t[role]++;
    tally.set(u.speaker, t);
  });
  const learned = new Map<number, Role>();
  for (const [speaker, t] of tally) {
    if (t.CONSULTANT !== t.CLIENT) learned.set(speaker, t.CONSULTANT > t.CLIENT ? 'CONSULTANT' : 'CLIENT');
  }
  // Calls are strictly 1:1. With exactly two diarized speakers and one of them identified,
  // the other one can only be the other participant.
  const speakerIds = new Set(utterances.map((u) => u.speaker).filter((s): s is number => s !== null));
  if (speakerIds.size === 2 && learned.size === 1) {
    const [[known, role]] = [...learned];
    const otherId = [...speakerIds].find((s) => s !== known)!;
    learned.set(otherId, role === 'CONSULTANT' ? 'CLIENT' : 'CONSULTANT');
  }
  const speakerRole = (speaker: number | null): Role | null => (speaker === null ? null : (learned.get(speaker) ?? null));

  return utterances.map((u, i) => {
    const role = direct[i] ?? speakerRole(u.speaker);
    const speaker =
      role === 'CONSULTANT'
        ? `${people.consultantName} (consultant)`
        : role === 'CLIENT'
          ? `${people.clientName} (client)`
          : u.speaker !== null
            ? `Speaker ${u.speaker + 1}`
            : 'Unknown speaker';
    return { speaker, role, startMs: u.startMs, endMs: u.endMs, text: u.text };
  });
}

function* samplesIn(sorted: ActivitySample[], from: number, to: number) {
  // Linear scan is fine: a 30-minute call has ~7k samples and ~300 utterances.
  for (const s of sorted) {
    if (s.t > to) return;
    if (s.t >= from) yield s;
  }
}
