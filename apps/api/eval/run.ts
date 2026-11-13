/**
 * Summary eval: runs the production summarizer over a fixed case set and scores it.
 *
 *   npm run eval                 # from the repo root (uses apps/api/.env for keys)
 *   EVAL_MIN_PASS=1 npm run eval # fail CI unless every case passes
 *
 * Per case: deterministic checks (required facts, forbidden content) + an LLM judge for
 * unsupported claims. Results go to eval/results/latest.json so prompt/model changes can be
 * compared against the previous baseline.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SummaryDto } from '@help/shared';
import { createSummarizer } from '../src/ai/summarizer-factory';
import { loadConfig } from '../src/config/app-config';
import { CASES, Check } from './cases';
import { judgeFaithfulness } from './judge';

const PAUSE_MS = Number(process.env.EVAL_PAUSE_MS ?? 4000); // stay under free-tier per-minute limits
const MIN_PASS = Number(process.env.EVAL_MIN_PASS ?? 0.85);
const JUDGE_MODELS = (process.env.EVAL_JUDGE_MODELS ?? 'gemini-flash-latest,gemini-2.5-flash,gemini-flash-lite-latest')
  .split(',')
  .map((s) => s.trim());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function runCheck(check: Check, summary: SummaryDto): boolean {
  const value = check.field ? summary[check.field] : summary;
  const text = (typeof value === 'string' ? value : JSON.stringify(value)).toLowerCase();
  if (check.anyOf && !check.anyOf.some((s) => text.includes(s.toLowerCase()))) return false;
  if (check.mustNotMatch) {
    const raw = typeof value === 'string' ? value : Array.isArray(value) ? value.join('\n') : JSON.stringify(value);
    if (check.mustNotMatch.test(raw)) return false;
  }
  return true;
}

interface CaseResult {
  id: string;
  pass: boolean;
  failedChecks: string[];
  model: string;
  faithfulness: number | null;
  unsupportedClaims: string[];
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  error?: string;
}

async function main() {
  const cfg = loadConfig();
  const summarizer = createSummarizer(cfg);
  const canJudge = !!cfg.GEMINI_API_KEY;
  const results: CaseResult[] = [];

  // EVAL_CASES=id1,id2 runs a subset (e.g. while iterating on one failure mode).
  const only = process.env.EVAL_CASES?.split(',').map((s) => s.trim());
  for (const c of only ? CASES.filter((x) => only.includes(x.id)) : CASES) {
    const started = Date.now();
    try {
      const r = await summarizer.summarize({
        requestTitle: c.requestTitle,
        requestDescription: c.requestDescription,
        transcript: c.transcript,
      });
      const latencyMs = Date.now() - started;
      const failedChecks = c.checks.filter((k) => !runCheck(k, r.summary)).map((k) => k.label);
      if (c.expectNoModelCall && !r.model.startsWith('none')) failedChecks.push('should not call the model');

      let faithfulness: number | null = null;
      let unsupportedClaims: string[] = [];
      if (canJudge && c.transcript.length) {
        await sleep(PAUSE_MS);
        const v = await judgeFaithfulness(cfg.GEMINI_API_KEY!, JUDGE_MODELS, c.transcript, r.summary);
        faithfulness = v.faithfulness;
        unsupportedClaims = v.unsupportedClaims;
        if (unsupportedClaims.length) failedChecks.push(`judge: ${unsupportedClaims.length} unsupported claim(s)`);
      }
      results.push({
        id: c.id,
        pass: failedChecks.length === 0,
        failedChecks,
        model: r.model,
        faithfulness,
        unsupportedClaims,
        latencyMs,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
      });
    } catch (e) {
      results.push({
        id: c.id, pass: false, failedChecks: ['error'], model: '-', faithfulness: null, unsupportedClaims: [],
        latencyMs: Date.now() - started, inputTokens: null, outputTokens: null, error: (e as Error).message,
      });
    }
    const last = results.at(-1)!;
    console.log(`${last.pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(22)} ${last.failedChecks.join('; ') || ''}${last.error ? ` ${last.error}` : ''}`);
    await sleep(PAUSE_MS);
  }

  const passed = results.filter((r) => r.pass).length;
  const passRate = passed / results.length;
  const judged = results.filter((r) => r.faithfulness !== null);
  const avgFaith = judged.length ? judged.reduce((n, r) => n + r.faithfulness!, 0) / judged.length : null;
  const tokensIn = results.reduce((n, r) => n + (r.inputTokens ?? 0), 0);
  const tokensOut = results.reduce((n, r) => n + (r.outputTokens ?? 0), 0);

  console.log('');
  console.table(
    results.map((r) => ({
      case: r.id,
      pass: r.pass ? '✔' : '✖',
      faithfulness: r.faithfulness ?? '-',
      model: r.model,
      'latency s': (r.latencyMs / 1000).toFixed(1),
    })),
  );
  for (const r of results.filter((x) => x.unsupportedClaims.length)) {
    console.log(`Unsupported claims in ${r.id}:\n  - ${r.unsupportedClaims.join('\n  - ')}`);
  }

  const dir = join(__dirname, 'results');
  mkdirSync(dir, { recursive: true });
  const latestPath = join(dir, 'latest.json');
  const previous = existsSync(latestPath) ? (JSON.parse(readFileSync(latestPath, 'utf8')) as { passRate: number }) : null;
  const report = {
    ranAt: new Date().toISOString(),
    summarizerModels: [...new Set(results.map((r) => r.model))],
    judgeModels: JUDGE_MODELS,
    passRate,
    avgFaithfulness: avgFaith,
    tokens: { input: tokensIn, output: tokensOut },
    results,
  };
  writeFileSync(latestPath, JSON.stringify(report, null, 2));

  console.log(
    `\nPassed ${passed}/${results.length} (${Math.round(passRate * 100)}%)` +
      (avgFaith !== null ? ` · avg faithfulness ${avgFaith.toFixed(2)}/5` : '') +
      ` · ${tokensIn} in / ${tokensOut} out tokens` +
      (previous ? ` · previous run ${Math.round(previous.passRate * 100)}%` : ''),
  );
  if (passRate < MIN_PASS) {
    console.error(`Below the required pass rate of ${Math.round(MIN_PASS * 100)}%`);
    process.exit(1);
  }
}

void main();
