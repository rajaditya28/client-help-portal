import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ffmpeg-static ships a binary per platform at install time, so reviewers need no system ffmpeg.
// FFMPEG_PATH lets a deploy use the system binary instead.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FFMPEG: string = process.env.FFMPEG_PATH || require('ffmpeg-static');

export interface FinalizedRecording {
  file: Buffer;
  durationMs: number | null;
  /** Start of each input segment on the final timeline (ms). */
  segmentStartsMs: number[];
}

/**
 * Why this exists: MediaRecorder writes a "live" WebM: only the first chunk has a header,
 * and there is no duration or seek index (Cues). Concatenated chunks play, but the browser
 * cannot seek them, which breaks "click a transcript line to jump". A stream-copy remux
 * through ffmpeg rewrites the container with duration + cues in seconds, without re-encoding.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  /** @param segments each segment is the ordered list of raw chunks from one MediaRecorder session */
  async finalize(segments: Buffer[][]): Promise<FinalizedRecording> {
    const dir = await mkdtemp(join(tmpdir(), 'rec-'));
    try {
      const fixed: string[] = [];
      const durations: (number | null)[] = [];
      for (const [i, chunks] of segments.entries()) {
        const raw = join(dir, `seg-${i}.raw.webm`);
        const out = join(dir, `seg-${i}.webm`);
        await writeFile(raw, Buffer.concat(chunks));
        const log = await this.run(['-y', '-fflags', '+genpts', '-i', raw, '-c', 'copy', out]);
        fixed.push(out);
        durations.push(await this.probeDurationMs(out, log));
      }

      let final = fixed[0];
      if (fixed.length > 1) {
        // Concat demuxer, stream copy: segments come from the same browser/codec settings.
        const list = join(dir, 'list.txt');
        await writeFile(list, fixed.map((f) => `file '${f}'`).join('\n'));
        final = join(dir, 'final.webm');
        await this.run(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', final]);
      }

      const segmentStartsMs: number[] = [];
      let acc = 0;
      for (const d of durations) {
        segmentStartsMs.push(acc);
        acc += d ?? 0;
      }

      return {
        file: await readFile(final),
        durationMs: await this.probeDurationMs(final),
        segmentStartsMs,
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Audio-only copy for speech-to-text (much smaller upload than the video).
   * Stream copy, not a re-encode: the recording is already Opus, which Deepgram accepts, and
   * re-encoding is slow on small instances (it dominated the TRANSCRIBE step on a 0.1-CPU host).
   */
  async extractAudio(video: Buffer): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), 'aud-'));
    try {
      const input = join(dir, 'in.webm');
      const out = join(dir, 'audio.webm');
      await writeFile(input, video);
      await this.run(['-y', '-i', input, '-vn', '-c:a', 'copy', out]);
      return await readFile(out);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** ffmpeg-static has no ffprobe, so read the duration from ffmpeg's own stderr. */
  private async probeDurationMs(file: string, existingLog?: string): Promise<number | null> {
    let log = existingLog;
    if (!log || !/Duration: \d/.test(log)) {
      // Stream copy into the null muxer: reads packet timestamps without decoding any frames.
      log = await this.run(['-i', file, '-c', 'copy', '-f', 'null', '-'], true);
    }
    // Prefer the last "time=" progress value (exact), fall back to the container Duration.
    const times = [...log.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
    const m = times.at(-1) ?? log.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!m) return null;
    return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000);
  }

  private run(args: string[], allowFailure = false): Promise<string> {
    return new Promise((resolve, reject) => {
      const p = spawn(FFMPEG, ['-hide_banner', ...args]);
      let stderr = '';
      p.stderr.on('data', (d) => (stderr += d.toString()));
      p.on('error', reject);
      p.on('close', (code) => {
        if (code === 0 || allowFailure) return resolve(stderr);
        this.logger.error(stderr.slice(-2000));
        reject(new Error(`ffmpeg exited with code ${code}`));
      });
    });
  }
}
