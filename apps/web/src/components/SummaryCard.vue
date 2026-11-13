<script setup lang="ts">
import type { SummaryDto } from '@help/shared';

defineProps<{ summary: SummaryDto; model: string | null }>();
</script>

<template>
  <section class="card p-5" data-testid="summary">
    <div class="flex items-center justify-between gap-3">
      <h2 class="font-semibold">Summary</h2>
      <span v-if="model" class="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-500">AI · {{ model }}</span>
    </div>
    <p class="mt-3 text-sm leading-relaxed text-slate-700">{{ summary.overview }}</p>

    <dl class="mt-4 space-y-4 text-sm">
      <div>
        <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Problem</dt>
        <dd class="mt-1 text-slate-700">{{ summary.problem }}</dd>
      </div>
      <div v-if="summary.stepsTaken.length">
        <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Steps taken</dt>
        <dd>
          <ol class="mt-1 list-decimal space-y-1 pl-5 text-slate-700">
            <li v-for="(s, i) in summary.stepsTaken" :key="i">{{ s }}</li>
          </ol>
        </dd>
      </div>
      <div>
        <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Resolution</dt>
        <dd class="mt-1 text-slate-700">{{ summary.resolution }}</dd>
      </div>
      <div v-if="summary.followUps.length">
        <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Follow-ups</dt>
        <dd>
          <ul class="mt-1 list-disc space-y-1 pl-5 text-slate-700">
            <li v-for="(f, i) in summary.followUps" :key="i">{{ f }}</li>
          </ul>
        </dd>
      </div>
    </dl>
    <p class="mt-4 text-xs text-slate-400">Generated from the transcript. It can contain mistakes; check the recording if something looks off.</p>
  </section>
</template>
