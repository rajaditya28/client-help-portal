# How I used and checked the AI

I built this with an AI coding agent (Claude Code). The agent wrote most of the code. I made the product and architecture decisions, and nothing counted as done until something independent of the AI had checked it: the compiler, a test, a deliberate break of the code, or a real browser run. This is the record of what that checking caught.

## How the work was checked

| Layer | Check |
|---|---|
| Types | `tsc` / `vue-tsc` strict, with types shared between API and web (`packages/shared`). |
| API behaviour | A scripted smoke test (22 checks) run against the running server before any UI existed. |
| Access control | An e2e test against the real app and a test database, then a **mutation check**: I broke `ownedBy()` on purpose and confirmed the test fails (7 of 9 cases did). |
| The risky part (WebRTC + recording + pipeline) | A Playwright test with two real Chromium users and fake media devices, run repeatedly (`--repeat-each=3`) to catch flakiness. |
| Docs | README claims checked against the code; two were corrected. |

## Issues caught, and how

1. **Job retries ignored their backoff** (a time-zone bug). The smoke test deliberately uploaded a corrupt chunk to exercise the failure path. The logs showed all 3 retries in the same second. Cause: Prisma's default `timestamp without time zone` holds UTC, but the claim query compared it with Postgres `now()` in the session zone (IST), so every scheduled job looked 5.5 h overdue. That would also have skipped the grace window for the recording's last chunk. Fix: `timestamptz` on every timestamp column.
2. **A flaky call join, found by the browser test.** The first E2E run hung on "Joining…". Two causes: no timeout on the socket acknowledgement, and a double join (initial connect handled as a "reconnect") that triggered overlapping renegotiations, where a stale answer could be applied to a newer connection. Fix: an ack timeout, the server always acks, duplicate joins are ignored, and every offer, answer and ICE candidate carries a negotiation id so stale ones are dropped. After the fix it passed 3 of 3 repeated runs.
3. **The recorder could start without the client's voice.** Found in review of the AI's code: recording started on the first remote track. If video arrived before audio, the client's voice would be missing from the whole segment. Fix: wait for both tracks, and re-run the trigger on every track arrival.
4. **The build silently produced nothing.** Nest's `deleteOutDir` plus TypeScript `incremental` left a stale `.tsbuildinfo`, so `tsc` emitted no files and reported no error. Caught because the E2E server wouldn't start.
5. **Misleading speaker labels in mock mode.** The test screenshot showed consultant lines labelled as the client. The mock transcript isn't aligned with the real audio, so voice-activity attribution is noise there. Fix: providers can declare known roles (the mock does). The real attribution logic is covered by unit tests.
6. **Library versions newer than the AI's knowledge.** npm's latest majors (TypeScript 7, NestJS 12, Prisma 8 rc) were released after the model's training data. I pinned the last majors it knows well, rather than let it guess at new APIs.
7. **No guessing at the LLM SDK.** The summarizer call was checked against the official SDK documentation and type-checked against the installed SDK, not written from memory.
8. **A safety guard respected, not bypassed.** Prisma refused an AI-initiated `migrate reset` without the user's explicit consent. Instead of working around the guard, the agent created a fresh development database.

## AI inside the product

- **The summary is constrained, then validated.** The response must match a JSON schema, and Zod validates it again. A schema failure throws, and the job queue retries it.
- **Grounding.** The prompt says to use only what's in the transcript, to write "Not discussed on the call" rather than invent, and to treat the transcript as data, not instructions (prompt-injection guard).
- **No LLM call when nothing was said.** An empty transcript gets a fixed response, so the model has nothing to invent.
- **Cost visibility.** Input and output tokens are stored per summary.
- **Next step: an eval set.** Real transcripts paired with reference summaries, scored for faithfulness, run on every prompt or model change.
