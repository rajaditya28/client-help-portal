import { RECORDING_TIMESLICE_MS } from '@help/shared';
import { api, ApiError } from '@/lib/api';

export interface RecorderStats {
  state: 'idle' | 'recording' | 'stopping' | 'stopped' | 'error';
  uploaded: number;
  pending: number;
  bytes: number;
  error: string | null;
}

interface PendingChunk {
  segment: number;
  seq: number;
  offsetMs: number;
  blob: Blob;
  activity: ActivitySample[];
}

/** Compact voice-activity sample: t = ms since segment start, c = consultant speaking, k = client speaking. */
interface ActivitySample {
  t: number;
  c: 0 | 1;
  k: 0 | 1;
}

const ACTIVITY_INTERVAL_MS = 250;
const SPEAKING_RMS = 0.015;
const MAX_UPLOAD_ATTEMPTS = 8;

/**
 * Records the call on the consultant's side and uploads it while the call runs.
 *
 * Why the consultant records: their browser already has every input — the client's screen
 * and voice (remote tracks) plus their own mic — and it keeps the extra encoding work off the
 * client's machine, which is already encoding the screen share.
 *
 * Output: one video track (the client's screen) + one audio track (both voices mixed with
 * Web Audio). MediaRecorder emits a WebM chunk every few seconds; chunks upload in order
 * through a retrying queue. Each (re)start is a new "segment" so a page refresh mid-call
 * never corrupts earlier footage; the server stitches segments together after the call.
 */
export class Recorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioCtx: AudioContext | null = null;
  private activityTimer: number | null = null;
  private activity: ActivitySample[] = [];
  private segment = 0;
  private seq = 0;
  private segmentStartedAt = 0;
  private queue: PendingChunk[] = [];
  private uploading: Promise<void> | null = null;
  private closed = false;

  stats: RecorderStats = { state: 'idle', uploaded: 0, pending: 0, bytes: 0, error: null };

  constructor(
    private readonly callId: string,
    private readonly callStartedAtMs: number,
    private readonly onStats: (s: RecorderStats) => void,
  ) {}

  get isRecording() {
    return this.mediaRecorder?.state === 'recording';
  }

  /** Start a new segment from the given tracks. Safe to call again after a reconnect (restarts). */
  async start(localMic: MediaStream, remote: MediaStream): Promise<void> {
    if (this.closed) return;
    await this.stopSegment();

    const video = remote.getVideoTracks()[0];
    const remoteAudio = remote.getAudioTracks()[0];
    if (!video) throw new Error('No remote video track to record');

    // Mix both voices into a single track, and tap each one for voice-activity detection.
    const ctx = new AudioContext();
    await ctx.resume();
    const dest = ctx.createMediaStreamDestination();
    const consultantLevel = this.tap(ctx, localMic, dest);
    const clientLevel = remoteAudio ? this.tap(ctx, new MediaStream([remoteAudio]), dest) : () => 0;
    this.audioCtx = ctx;

    // Segment ids are seconds since call start: unique, monotonic, and survive a page refresh.
    const elapsed = Date.now() - this.callStartedAtMs;
    this.segment = Math.max(this.segment + 1, Math.floor(elapsed / 1000));
    this.seq = 0;
    this.segmentStartedAt = Date.now();
    this.activity = [];
    const segment = this.segment;
    const offsetMs = Math.max(0, elapsed);

    this.activityTimer = window.setInterval(() => {
      this.activity.push({
        t: Date.now() - this.segmentStartedAt,
        c: consultantLevel() > SPEAKING_RMS ? 1 : 0,
        k: clientLevel() > SPEAKING_RMS ? 1 : 0,
      });
    }, ACTIVITY_INTERVAL_MS);

    const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) =>
      MediaRecorder.isTypeSupported(t),
    );
    const mr = new MediaRecorder(new MediaStream([video, dest.stream.getAudioTracks()[0]]), {
      mimeType,
      videoBitsPerSecond: 800_000, // screen content compresses well; keeps a 30-min call ~200 MB
      audioBitsPerSecond: 64_000,
    });
    mr.ondataavailable = (e) => {
      if (!e.data.size) return;
      const activity = this.activity;
      this.activity = [];
      this.enqueue({ segment, seq: this.seq++, offsetMs, blob: e.data, activity });
    };
    mr.onerror = () => this.update({ state: 'error', error: 'Recorder error' });
    mr.start(RECORDING_TIMESLICE_MS);
    this.mediaRecorder = mr;
    this.update({ state: 'recording', error: null });
  }

  /** Stop recording and wait until every chunk is uploaded (or has permanently failed). */
  async stop(): Promise<void> {
    this.update({ state: 'stopping' });
    await this.stopSegment();
    this.closed = true;
    await this.drain();
    this.update({ state: this.stats.error ? 'error' : 'stopped' });
  }

  private async stopSegment() {
    const mr = this.mediaRecorder;
    this.mediaRecorder = null;
    if (mr && mr.state !== 'inactive') {
      // The final dataavailable fires before onstop, so the last chunk is queued by then.
      await new Promise<void>((resolve) => {
        mr.addEventListener('stop', () => resolve(), { once: true });
        mr.stop();
      });
    }
    if (this.activityTimer !== null) window.clearInterval(this.activityTimer);
    this.activityTimer = null;
    await this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
  }

  private tap(ctx: AudioContext, stream: MediaStream, dest: AudioNode): () => number {
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(dest);
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    return () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      return Math.sqrt(sum / buf.length);
    };
  }

  /* ------------------------------------------------------------- upload queue */

  private enqueue(chunk: PendingChunk) {
    this.queue.push(chunk);
    this.update({});
    if (!this.uploading) this.uploading = this.pump().finally(() => (this.uploading = null));
  }

  private async drain() {
    while (this.uploading) await this.uploading;
  }

  /** Uploads strictly in order: chunk 0 holds the WebM header, later chunks are only valid after it. */
  private async pump() {
    while (this.queue.length) {
      const chunk = this.queue[0];
      let attempt = 0;
      for (;;) {
        try {
          await api.uploadChunk(this.callId, chunk.segment, chunk.seq, chunk.offsetMs, chunk.blob, chunk.activity);
          this.stats.uploaded++;
          this.stats.bytes += chunk.blob.size;
          break;
        } catch (e) {
          attempt++;
          const status = e instanceof ApiError ? e.status : 0;
          // 4xx other than 408/429 will not succeed on retry (e.g. 409: recording closed).
          const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
          if (!retryable || attempt >= MAX_UPLOAD_ATTEMPTS) {
            this.update({ error: `Upload failed (${status || 'network'}): ${(e as Error).message}` });
            this.queue = [];
            return;
          }
          await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** attempt, 10_000)));
        }
      }
      this.queue.shift();
      this.update({});
    }
  }

  private update(patch: Partial<RecorderStats>) {
    this.stats = { ...this.stats, ...patch, pending: this.queue.length };
    this.onStats(this.stats);
  }
}
