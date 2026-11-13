import { Injectable, Logger } from '@nestjs/common';
import type { Role } from '@help/shared';

/** One utterance as returned by a speech-to-text provider, on the recording's timeline. */
export interface Utterance {
  startMs: number;
  endMs: number;
  text: string;
  /** Diarization label from the provider (0, 1, ...), when available. */
  speaker: number | null;
  /** Set only when the provider knows the speaker for certain (e.g. one channel per person, or the mock). */
  knownRole?: Role;
}

export abstract class TranscriptionProvider {
  abstract readonly name: string;
  abstract transcribe(audio: Buffer, mimeType: string, durationMs: number | null): Promise<Utterance[]>;
}

/**
 * Deepgram pre-recorded API over plain fetch (one endpoint, no SDK surface to track).
 * nova-3 + diarize + utterances gives speaker-turn segments with word-level timing.
 */
@Injectable()
export class DeepgramTranscriptionProvider extends TranscriptionProvider {
  readonly name = 'deepgram:nova-3';
  private readonly logger = new Logger(DeepgramTranscriptionProvider.name);

  constructor(private readonly apiKey: string) {
    super();
  }

  async transcribe(audio: Buffer, mimeType: string): Promise<Utterance[]> {
    const params = new URLSearchParams({
      model: 'nova-3',
      smart_format: 'true',
      punctuate: 'true',
      diarize: 'true',
      utterances: 'true',
      detect_language: 'true',
    });
    const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: { Authorization: `Token ${this.apiKey}`, 'Content-Type': mimeType },
      body: new Uint8Array(audio),
      signal: AbortSignal.timeout(5 * 60_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // 4xx (bad key, bad audio) will not fix itself on retry, but the queue caps attempts anyway.
      throw new Error(`Deepgram ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      results?: { utterances?: { start: number; end: number; transcript: string; speaker?: number }[] };
    };
    const utterances = json.results?.utterances ?? [];
    this.logger.log(`Deepgram returned ${utterances.length} utterances`);
    return utterances
      .filter((u) => u.transcript.trim())
      .map((u) => ({
        startMs: Math.round(u.start * 1000),
        endMs: Math.round(u.end * 1000),
        text: u.transcript.trim(),
        speaker: u.speaker ?? null,
      }));
  }
}

/**
 * Deterministic stand-in used when DEEPGRAM_API_KEY is unset, so the full pipeline
 * (and the UI) can be exercised without any third-party account.
 */
@Injectable()
export class MockTranscriptionProvider extends TranscriptionProvider {
  readonly name = 'mock';

  async transcribe(_audio: Buffer, _mimeType: string, durationMs: number | null): Promise<Utterance[]> {
    const script: [number, string][] = [
      [1, 'Hi, thanks for jumping on. I am stuck on the billing settings page.'],
      [0, 'No problem. Can you share your screen and show me where it fails?'],
      [1, 'Sure. When I click save on the invoice template, it just spins forever.'],
      [0, 'I see it. Your logo file is very large. Try uploading a smaller version.'],
      [1, 'Okay, uploading a smaller one now. That worked, it saved instantly.'],
      [0, 'Great. I will also note that the size limit should be shown on that page.'],
    ];
    const total = Math.max(durationMs ?? 0, 12_000);
    const slot = total / script.length;
    return script.map(([speaker, text], i) => ({
      startMs: Math.round(i * slot),
      endMs: Math.round((i + 1) * slot - 200),
      text: `[mock transcript] ${text}`,
      speaker,
      // The scripted lines aren't aligned with the real audio, so voice activity can't attribute them.
      knownRole: speaker === 0 ? 'CONSULTANT' : 'CLIENT',
    }));
  }
}
