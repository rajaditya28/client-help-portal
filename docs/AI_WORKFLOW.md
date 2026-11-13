# How I used and checked the AI

I built this the way the role describes: as a team of one, with an AI coding agent (Claude Code) as my pair. I owned the product, the architecture and what counted as done. The agent made implementation fast, and I treated everything it produced as unverified until something independent had checked it: the compiler, a test, a deliberate break of the code, or my own hands-on testing of the app.

## Who did what

| I owned | The agent accelerated |
|---|---|
| Reading the brief as a PM would, and settling the open questions: one consultant; if the client declines, the call goes ahead unrecorded; recordings kept; reviewers must be able to run it with no friction | First drafts of modules, components and config |
| The architecture and the trade-offs behind it (below) | Boilerplate: DTOs, wiring, migrations, CI |
| Choosing providers on cost (free tiers, cost per call, quotas) | Looking up current library and provider APIs |
| Testing the product by hand in two windows and on two networks, and deciding what was good enough to ship | Writing the tests I asked for, and running the checks |
| Deployment and setting up accounts, keys and identities | Driving CLIs and APIs during deployment |

## Decisions I made, and why

- **Peer-to-peer WebRTC rather than a media server.** Calls are 1:1, so there's no extra infrastructure and latency is lowest. A TURN relay covers networks that block direct connections.
- **The consultant's browser records.** It already has the client's screen and voice plus its own mic, and the client's machine is already busy encoding the screen share. Chunks upload every 4 s, so a crash loses seconds, not the call.
- **Consent is enforced on the server,** not just shown in the UI: chunk uploads are rejected until the client agrees.
- **Postgres as the job queue (`SKIP LOCKED`) instead of Redis.** One fewer service, jobs are written in the same transaction as the state change, and each pipeline step retries on its own. I've used this pattern in production before.
- **One ownership rule (`ownedBy`) behind every query,** with 404 for other users' data so a user can't probe which IDs exist.
- **Speaker labels from measurement, not guesswork.** The browser knows which audio track is talking, which beats diarization guessing from a mixed recording.
- **AI providers behind interfaces with mock fallbacks,** so reviewers can run everything with no keys, and switching LLM vendor is one setting.

## How I verified the agent's work

| Layer | Check |
|---|---|
| Types | Strict `tsc` / `vue-tsc`, with types shared between API and web |
| API | A 22-check smoke script against the running server before any UI existed |
| Access control | An e2e test against the real app and a test database, plus a **mutation check**: I broke `ownedBy()` on purpose and confirmed the test fails (7 of 9 cases did) |
| Calls + recording | Playwright with two real browsers, run repeatedly to catch flakiness; a second run with real speech and real AI providers; a third with direct connections forbidden, so only TURN could connect |
| Release | A fresh clone built exactly as a reviewer would, CI on every push, and the same tests run against the live deployment |
| Product | My own hands-on testing in two windows, plus two separate browsers with separate voices against the live site, including a run with direct connections blocked so the call had to go through the TURN relay |

## What the checks caught

From my own testing of the app:
- **The consultant's view froze on the last frame after the client stopped sharing.** A stopped share just stops sending frames, so the video element keeps the last one. Fixed with an explicit start/stop signal from the client, and added to the E2E test.
- **"Will this work with someone on another network?"** Answering that honestly showed that direct connections alone aren't enough. It led to Cloudflare TURN with short-lived per-user credentials, verified on the live site with direct paths forbidden.
- **"How many test runs can we afford?"** I worked out the cost per call for speech-to-text, and the daily free-tier limits on the summary models.

From automated checks:
- **Job retries ignored their backoff** (a time-zone bug). Prisma's default timestamp column is UTC without a time zone, but the claim query compared it with `now()` in the session zone (IST), so every scheduled job looked 5.5 hours overdue. Fixed by storing every timestamp as `timestamptz`.
- **A flaky call join.** An unacknowledged join could hang the UI, and a double join caused overlapping renegotiations. Fixed with an ack timeout and a negotiation id on every offer, answer and ICE candidate.
- **The recorder could start without the client's voice** when the client's video track arrived before their audio. It now waits for both.
- **The source folder for storage was missing from git.** An over-broad `.gitignore` rule matched it. Caught only by the fresh-clone build, which is why that check exists.
- **A deploy-config trap:** `NODE_ENV=production` at build time would have skipped the build tools.
- **Library versions newer than the agent knows well:** I pinned the last major versions it's reliable on, rather than let it guess at new APIs.

## AI inside the product

- **The summary is schema-constrained and validated again with Zod.** A malformed response throws, and the job queue retries.
- **It's grounded:** only what's in the transcript, "Not discussed on the call" instead of invention, and the transcript treated as data, not instructions.
- **No LLM call for an empty transcript,** so there's nothing for the model to invent.
- **Resilience:** a fallback across several models handles free-tier "high demand" errors, which actually happened on the live run. Token usage is stored for each summary.
- **An eval set guards the prompt.** `npm run eval` runs the production summarizer over 8 cases, each targeting one failure mode: invented resolution, prompt injection, mangled IDs, invented names, small talk, follow-up owners, an empty call, plus a basic case. It checks each with deterministic rules and an LLM judge for unsupported claims. Baseline: 8/8, faithfulness 5.0/5. To check that the eval itself works, I swapped in a careless prompt. It failed 2 of 3 targeted cases and named the invented "resolved", the echoed injection payload and the made-up refund promise.
- **Limitation I'm aware of:** the judge is also a Gemini model, so there's some self-grading bias. A cross-vendor judge would be stronger.
