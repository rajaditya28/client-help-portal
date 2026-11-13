# Client Help Portal

A consultant supports several clients. A client raises a help request, the consultant starts a screen-sharing call from it, the call is recorded with the client's consent, and afterwards both of them get the recording, a transcript and an AI summary in their call history.

**Stack:** Vue 3 + Vite + Pinia · NestJS 11 + Socket.IO · PostgreSQL + Prisma · WebRTC (peer-to-peer) · MediaRecorder · ffmpeg · Deepgram (speech-to-text) · Gemini or Claude (summary) · TypeScript end to end.

---

## Try it

### Option A: live demo
> Live URL: _added after deployment_

### Option B: one command (Docker)
```bash
docker compose up --build
# open http://localhost:3000
```

### Option C: local Node (no Docker)
Needs Node 20+ and a PostgreSQL database.
```bash
npm install
cp apps/api/.env.example apps/api/.env      # set DATABASE_URL
npm run db:setup                            # migrations + seed users
npm run dev                                 # web on :5173, API on :3000
```

Without API keys the app runs end to end on **mock** speech-to-text and summary providers (clearly labelled in the UI). For real ones, set `DEEPGRAM_API_KEY` and either `GEMINI_API_KEY` (free tier) or `ANTHROPIC_API_KEY`.

### Demo users (password `password123`; one-click buttons on the login page)
| Role | Name | Email |
|---|---|---|
| Consultant | Priya Sharma | consultant@demo.test |
| Client | Asha Verma | asha@demo.test |
| Client | Ben Carter | ben@demo.test |
| Client | Chen Li | chen@demo.test |

### 60-second test script
1. Open two browser windows (the second can be incognito). Log in as **Priya** in one and **Asha** in the other. Each tab keeps its own session.
2. As Asha, send a help request. It appears on Priya's dashboard immediately, with no refresh.
3. As Priya, click **Start call** and then **Join call**. Asha sees "Priya is calling you"; she clicks **Join call** and then **Join call** again.
4. Asha is asked for consent and clicks **Allow recording**, then **Share screen**. Priya sees the screen, both can talk, and Priya's status bar shows chunks uploading while the call runs.
5. Optional: refresh Asha's tab mid-call and click **Rejoin call**. The call and the recording continue.
6. Click **End call**. Both land on the call's history page, which fills in by itself: recording, then transcript, then summary.
7. Click a transcript line and the video jumps to that moment.

**Use headphones** if both windows are on one laptop, or the two tabs will feed back through one microphone.

---

## Requirements → implementation

| # | Requirement | How |
|---|---|---|
| 1 | Two roles, ≥3 seeded clients, two windows | Idempotent seed (`npm run db:setup`; the Docker image runs it on every boot). The JWT lives in `sessionStorage` (per tab), so two windows can be two users. |
| 2 | Request appears instantly | Socket.IO with JWT auth on the handshake. Each user is in a private room `user:{id}`; new requests are pushed only to the assigned consultant. |
| 3 | Screen share + both talk | Peer-to-peer WebRTC. The consultant always makes the offer: audio sendrecv plus a recvonly video slot that the client fills with `replaceTrack(screen)`, so share and stop never renegotiate. |
| 4 | Consent before recording; record screen + both voices; upload while running | The server rejects chunks until the client has consented (`409`). The consultant's browser mixes both voices with Web Audio and adds the screen track; `MediaRecorder` uploads a chunk every 4 s through an ordered, retrying, idempotent queue. |
| 5 | Transcript + summary in the background, shown in history | A Postgres job queue (`FOR UPDATE SKIP LOCKED`) runs `FINALIZE_RECORDING → TRANSCRIBE → SUMMARIZE`, one retryable job per step. Pages update live over the socket. |
| 6 | Users only see their own data, plus a test | One ownership predicate (`ownedBy(user)`) applied to every query; foreign records return 404. Tested in [`access-control.e2e-spec.ts`](apps/api/test/access-control.e2e-spec.ts). |
| ★ | Speaker labels | The browser samples who is speaking on each track (consultant mic vs. client's remote audio) and uploads it with each chunk. Transcript lines are attributed from that, with Deepgram diarization as the fallback. |
| ★ | Click a line to seek | Recordings are remuxed with ffmpeg so they're seekable; the player supports HTTP Range requests. |
| ★ | Rejoin after refresh | The call state lives on the server. A refreshed tab rejoins the room, the consultant re-offers, and recording continues as a new segment that the server stitches in. |

---

## Architecture

```
 Client browser                         Consultant browser
 ┌─────────────────────┐   WebRTC (P2P)  ┌──────────────────────────────┐
 │ mic ──────────────────────────────────▶ remote audio ┐               │
 │ screen (replaceTrack) ────────────────▶ remote video ┼▶ MediaRecorder │──▶ POST chunk every 4 s
 │                     ◀──────────────── │ mic ─────────┘ (+ voice      │    (ordered, retried,
 └─────────┬───────────┘                 └──────┬───────  activity)     ┘     idempotent)
           │ Socket.IO: events + signalling     │
 ┌─────────▼────────────────────────────────────▼─────────────────────────────────┐
 │ NestJS API (one process)                                                       │
 │  Auth guard ─ RolesGuard ─ ownedBy(user) on every query                        │
 │  Requests · Calls · Gateway (rooms: user:{id}, call:{id})                      │
 │  Job worker ── FINALIZE (concat chunks + ffmpeg remux) → TRANSCRIBE → SUMMARIZE │
 └──────┬────────────────────────────┬───────────────────────────┬────────────────┘
        │ Prisma                     │ Storage driver            │ Providers (env-selected)
   PostgreSQL                  local disk / S3 (R2)        Deepgram / mock · Claude / mock
   (data + job queue)
```

```
apps/api/src
  auth/        JWT login, global guard, @Roles, @CurrentUser
  common/      access.ts (the ownership rule), DTO mappers
  requests/    help requests
  calls/       call lifecycle, consent, chunk upload, playback URLs, pipeline steps
  realtime/    Socket.IO gateway + RealtimeService facade
  jobs/        Postgres job queue + worker loop
  media/       ffmpeg: concat, remux, audio extraction
  ai/          transcription + summarizer providers (real + mock), speaker attribution
  storage/     local / S3-compatible blob storage
apps/web/src
  call/        CallSession.ts (WebRTC + signalling), Recorder.ts (mix, record, upload queue)
  views/       login, dashboards, call, history, call detail
packages/shared  types + socket event names shared by API and web
```

---

## Key decisions and trade-offs

- **Peer-to-peer WebRTC rather than a media server (SFU).** It's 1:1 by design, so P2P has no extra infrastructure and the lowest latency. Two machines on networks that block P2P need a TURN relay, which `ICE_SERVERS` configures. For group calls or server-side recording I'd move to an SFU such as LiveKit.
- **The consultant's browser records.** It already holds every input (the client's screen and voice, plus its own mic), and the client's machine is already busy encoding the screen share. The trade-off: if the consultant's tab crashes, the last unsent chunk (≤4 s) is lost. A server-side recorder (SFU egress) would remove that.
- **Chunked upload while the call runs.** If a tab closes, at most ~4 s is lost. Chunks are idempotent on `(call, segment, seq)`, so retries are safe. Each recorder restart is a new segment, so a refresh never corrupts earlier footage.
- **ffmpeg remux after the call.** MediaRecorder WebM has no duration or cue index, so concatenated chunks play but can't be seeked. A stream-copy remux fixes that in under a second, with no re-encoding. `ffmpeg-static` means no system install.
- **Postgres as the job queue, not Redis/BullMQ.** One fewer service; jobs are created in the same transaction as the state change; `SKIP LOCKED` lets several workers share it. Each pipeline step is its own job with backoff and an attempt cap; jobs left locked by a crashed worker are re-queued when the worker starts.
- **404 rather than 403 for other users' data,** so a user can't probe which IDs exist.
- **Short-lived signed media URLs.** A `<video>` tag can't send an Authorization header, so after the ownership check the API returns a 15-minute URL: a presigned R2 URL, or a call-scoped token for local disk.
- **Summary guardrails.** Structured JSON output (a schema-constrained response), then validated again with Zod. The prompt treats the transcript as data, not instructions. Empty transcripts skip the LLM entirely, so there's nothing for it to invent. Token usage is logged per summary, and a server-side model fallback is enabled if the primary model declines.
- **Speaker attribution from measurement, not guesswork.** The browser knows which track is speaking, so lines are attributed from that signal. When it's ambiguous (one shared mic in a demo), the code falls back to diarization labels, and if those don't decide either it shows "Speaker N" rather than guessing.

## How I used and checked the AI
See [`docs/AI_WORKFLOW.md`](docs/AI_WORKFLOW.md): how the work was checked, and the bugs those checks caught in AI-written code.

## Tests

```bash
npm test          # API: access-control e2e (real app + test DB) + speaker attribution unit tests
npm run e2e       # Playwright: two real Chromium users, fake media devices, full call → history flow (mock AI)
REAL_AI=1 npx playwright test real-ai   # same, with two synthetic voices + real Deepgram and LLM
```

- **Access control** ([`access-control.e2e-spec.ts`](apps/api/test/access-control.e2e-spec.ts)): boots the real Nest app against a separate `*_test` database. Another client and an unassigned consultant get empty lists and 404s on every read and write, including transcript, summary, recording URL and chunk upload. Owners succeed (positive controls). A media token for one call can't be used for another. I checked that the test can fail by breaking `ownedBy()` on purpose: 7 of 9 cases failed.
- **Browser E2E** ([`e2e/call-flow.spec.ts`](e2e/call-flow.spec.ts)): request → realtime push → call → consent → screen share → live chunk uploads → client refresh and rejoin → end → pipeline → a seekable recording with a real duration → click-to-seek and active-line highlight.

## Configuration

See [`apps/api/.env.example`](apps/api/.env.example). Without the optional keys, the matching mock provider is used.

## Limitations and what I'd do next
- TURN credentials for the hosted demo, for clients behind strict NATs.
- Server-side recording (SFU egress) so recording doesn't depend on one browser tab.
- An evaluation set for summaries (faithfulness to the transcript), run on every prompt or model change.
- Transcripts for long calls in chunks, with streaming progress; today one call is sent whole, which is fine up to the 30-minute cap.
- Metrics: job latency and failure counts per step, plus STT/LLM cost per call (token counts are already stored).
