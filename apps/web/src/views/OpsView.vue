<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { MetricsDto, PipelineStep } from '@help/shared';
import { useCallEvents } from '@/composables/useRequests';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';

const m = ref<MetricsDto | null>(null);
const error = ref('');

async function load() {
  try {
    m.value = await api.metrics();
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
// Pipeline progress changes the numbers; refresh live.
useCallEvents(() => void load());

const STEP_LABEL: Record<PipelineStep, string> = {
  FINALIZE_RECORDING: 'Finalize recording',
  TRANSCRIBE: 'Transcribe',
  SUMMARIZE: 'Summarize',
};

function secs(ms: number | null | undefined): string {
  if (ms == null) return '–';
  if (ms < 100) return '<0.1 s';
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`;
}
function usd(v: number | null | undefined): string {
  if (v == null) return '–';
  if (v === 0) return '$0';
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}
function mins(ms: number | null): string {
  return ms == null ? '–' : `${(ms / 60_000).toFixed(1)} min`;
}

const jobsFailed = computed(() => m.value?.steps.reduce((n, s) => n + s.failed, 0) ?? 0);
const jobsDone = computed(() => m.value?.steps.reduce((n, s) => n + s.done, 0) ?? 0);
const successRate = computed(() => {
  const total = jobsDone.value + jobsFailed.value;
  return total ? `${Math.round((jobsDone.value / total) * 100)}%` : '–';
});
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-8">
    <div class="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Ops</h1>
        <p class="mt-1 text-sm text-slate-500">How the post-call pipeline is doing for your calls: speed, failures and cost.</p>
      </div>
      <p v-if="m" class="text-xs text-slate-500">Updated {{ dateTime(m.generatedAt) }} · refreshes live</p>
    </div>

    <p v-if="error" class="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>
    <div v-if="!m && !error" class="py-20 text-center text-slate-500">Loading…</div>

    <template v-if="m">
      <!-- Headline numbers -->
      <div class="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="ops-tiles">
        <div class="card p-4">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Calls with summary</p>
          <p class="mt-2 text-2xl font-semibold tabular-nums">{{ m.callsReady }}</p>
          <p class="mt-1 text-xs text-slate-500">{{ m.callsRecorded }} recorded of {{ m.callsTotal }} calls</p>
        </div>
        <div class="card p-4">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Call end → summary</p>
          <p class="mt-2 text-2xl font-semibold tabular-nums">{{ secs(m.timeToSummaryP50Ms) }}</p>
          <p class="mt-1 text-xs text-slate-500">median · p95 {{ secs(m.timeToSummaryP95Ms) }}</p>
        </div>
        <div class="card p-4">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Job success rate</p>
          <p class="mt-2 text-2xl font-semibold tabular-nums">{{ successRate }}</p>
          <p class="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
            <template v-if="jobsFailed">
              <span class="inline-block h-2 w-2 rounded-full bg-rose-500" aria-hidden="true" />
              {{ jobsFailed }} failed permanently
            </template>
            <template v-else>No permanent failures</template>
          </p>
        </div>
        <div class="card p-4">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Est. cost per call</p>
          <p class="mt-2 text-2xl font-semibold tabular-nums">{{ usd(m.avgUsdPerReadyCall) }}</p>
          <p class="mt-1 text-xs text-slate-500">{{ usd(m.totalUsd) }} across the last {{ m.recentCalls.length }} calls</p>
        </div>
      </div>

      <!-- Per-step latency and reliability -->
      <section class="card mt-6 overflow-hidden">
        <h2 class="border-b border-slate-100 px-5 py-3 font-semibold">Pipeline steps</h2>
        <table class="w-full text-left text-sm" data-testid="ops-steps">
          <thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-5 py-2.5 font-medium">Step</th>
              <th class="px-5 py-2.5 text-right font-medium">Done</th>
              <th class="px-5 py-2.5 text-right font-medium">Retries</th>
              <th class="px-5 py-2.5 text-right font-medium">Failed</th>
              <th class="px-5 py-2.5 text-right font-medium">In queue</th>
              <th class="px-5 py-2.5 text-right font-medium">p50</th>
              <th class="px-5 py-2.5 text-right font-medium">p95</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 tabular-nums">
            <tr v-for="s in m.steps" :key="s.step">
              <td class="px-5 py-2.5 font-medium">{{ STEP_LABEL[s.step] }}</td>
              <td class="px-5 py-2.5 text-right">{{ s.done }}</td>
              <td class="px-5 py-2.5 text-right">{{ s.retries }}</td>
              <td class="px-5 py-2.5 text-right" :class="s.failed ? 'font-medium text-rose-700' : ''">{{ s.failed }}</td>
              <td class="px-5 py-2.5 text-right">{{ s.pending }}</td>
              <td class="px-5 py-2.5 text-right">{{ secs(s.p50Ms) }}</td>
              <td class="px-5 py-2.5 text-right">{{ secs(s.p95Ms) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Per-call cost -->
      <section class="card mt-6 overflow-hidden">
        <div class="border-b border-slate-100 px-5 py-3">
          <h2 class="font-semibold">Recent calls</h2>
          <p class="text-xs text-slate-500">{{ m.pricingNote }}</p>
        </div>
        <div v-if="!m.recentCalls.length" class="p-6 text-sm text-slate-500">No summarized calls yet.</div>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th class="px-5 py-2.5 font-medium">Call</th>
                <th class="px-5 py-2.5 text-right font-medium">Length</th>
                <th class="px-5 py-2.5 text-right font-medium">End → summary</th>
                <th class="px-5 py-2.5 font-medium">Models</th>
                <th class="px-5 py-2.5 text-right font-medium">Tokens in / out</th>
                <th class="px-5 py-2.5 text-right font-medium">STT</th>
                <th class="px-5 py-2.5 text-right font-medium">LLM</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 tabular-nums">
              <tr v-for="c in m.recentCalls" :key="c.callId">
                <td class="px-5 py-2.5">
                  <RouterLink :to="`/history/${c.callId}`" class="font-medium hover:text-indigo-600">{{ c.requestTitle }}</RouterLink>
                  <div class="text-xs text-slate-500">{{ c.clientName }} · {{ c.endedAt ? dateTime(c.endedAt) : '–' }}</div>
                </td>
                <td class="px-5 py-2.5 text-right">{{ mins(c.recordingMs) }}</td>
                <td class="px-5 py-2.5 text-right">{{ secs(c.timeToSummaryMs) }}</td>
                <td class="px-5 py-2.5 text-xs text-slate-600">{{ c.sttProvider ?? '–' }}<br />{{ c.llmModel ?? '–' }}</td>
                <td class="px-5 py-2.5 text-right">{{ c.inputTokens ?? '–' }} / {{ c.outputTokens ?? '–' }}</td>
                <td class="px-5 py-2.5 text-right">{{ usd(c.sttUsd) }}</td>
                <td class="px-5 py-2.5 text-right">{{ usd(c.llmUsd) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Failures -->
      <section v-if="m.recentFailures.length" class="card mt-6 overflow-hidden">
        <h2 class="border-b border-slate-100 px-5 py-3 font-semibold">Recent permanent failures</h2>
        <ul class="divide-y divide-slate-100 text-sm">
          <li v-for="f in m.recentFailures" :key="`${f.callId}-${f.step}`" class="px-5 py-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded bg-rose-50 px-1.5 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-rose-600/20">Failed</span>
              <span class="font-medium">{{ STEP_LABEL[f.step] }}</span>
              <span class="text-slate-500">· {{ f.requestTitle }} · {{ f.attempts }} attempts · {{ dateTime(f.at) }}</span>
            </div>
            <p class="mt-1 font-mono text-xs text-slate-600">{{ f.error }}</p>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
