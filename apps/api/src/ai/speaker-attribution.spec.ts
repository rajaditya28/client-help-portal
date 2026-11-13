import { attributeSpeakers, ActivitySample } from './speaker-attribution';
import type { Utterance } from './transcription';

const people = { consultantName: 'Priya', clientName: 'Asha' };

function samples(from: number, to: number, who: 'consultant' | 'client' | 'both' | 'none'): ActivitySample[] {
  const out: ActivitySample[] = [];
  for (let t = from; t <= to; t += 250) {
    out.push({ t, consultant: who === 'consultant' || who === 'both', client: who === 'client' || who === 'both' });
  }
  return out;
}

describe('attributeSpeakers', () => {
  it('uses browser voice activity when it is unambiguous', () => {
    const utterances: Utterance[] = [
      { startMs: 0, endMs: 2000, text: 'Hi, I need help', speaker: null },
      { startMs: 2500, endMs: 4000, text: 'Sure, share your screen', speaker: null },
    ];
    const activity = [...samples(0, 2000, 'client'), ...samples(2500, 4000, 'consultant')];
    const out = attributeSpeakers(utterances, activity, people);
    expect(out.map((s) => s.speaker)).toEqual(['Asha (client)', 'Priya (consultant)']);
    expect(out.map((s) => s.role)).toEqual(['CLIENT', 'CONSULTANT']);
  });

  it('falls back to diarization labels learned from unambiguous lines', () => {
    const utterances: Utterance[] = [
      { startMs: 0, endMs: 2000, text: 'clear client line', speaker: 0 },
      { startMs: 2500, endMs: 4000, text: 'clear consultant line', speaker: 1 },
      // Both "speaking" (e.g. one shared laptop mic): activity can't decide, diarization can.
      { startMs: 5000, endMs: 6000, text: 'ambiguous line by speaker 0', speaker: 0 },
    ];
    const activity = [...samples(0, 2000, 'client'), ...samples(2500, 4000, 'consultant'), ...samples(5000, 6000, 'both')];
    const out = attributeSpeakers(utterances, activity, people);
    expect(out[2].speaker).toBe('Asha (client)');
  });

  it('infers the second diarized speaker when the first is known (calls are 1:1)', () => {
    const utterances: Utterance[] = [
      { startMs: 0, endMs: 2000, text: 'consultant, clearly', speaker: 0 },
      { startMs: 2500, endMs: 4000, text: 'ambiguous, other speaker', speaker: 1 },
    ];
    const activity = [...samples(0, 2000, 'consultant'), ...samples(2500, 4000, 'both')];
    const out = attributeSpeakers(utterances, activity, people);
    expect(out.map((s) => s.role)).toEqual(['CONSULTANT', 'CLIENT']);
  });

  it('labels "Speaker N" instead of guessing when nothing decides', () => {
    const utterances: Utterance[] = [{ startMs: 0, endMs: 1000, text: 'hello', speaker: 1 }];
    const out = attributeSpeakers(utterances, samples(0, 1000, 'both'), people);
    expect(out[0]).toMatchObject({ speaker: 'Speaker 2', role: null });
  });
});
