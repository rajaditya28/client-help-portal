<script setup lang="ts">
import { computed } from 'vue';
import type { HelpRequestDto } from '@help/shared';
import { stateText, trackOf, type StageState } from '@/lib/track';

const props = defineProps<{ request: HelpRequestDto }>();
const stages = computed(() => trackOf(props.request));

const reached = (s: StageState) => s === 'done' || s === 'current' || s === 'failed';

/** One-line caption for narrow widths, where five labels don't fit: the furthest stage reached. */
const furthest = computed(() => [...stages.value].reverse().find((x) => x.state !== 'pending') ?? stages.value[0]);

function dotClass(s: StageState) {
  switch (s) {
    case 'done':
      return 'bg-brand-600 ring-brand-600';
    case 'current':
      return 'bg-white ring-2 ring-brand-600';
    case 'failed':
      return 'bg-rose-600 ring-rose-600';
    case 'skipped':
      return 'bg-slate-200 ring-slate-300';
    default:
      return 'bg-white ring-slate-300';
  }
}

function labelClass(s: StageState) {
  if (s === 'current') return 'font-medium text-brand-700';
  if (s === 'failed') return 'font-medium text-rose-700';
  if (s === 'done') return 'text-slate-700';
  return 'text-slate-500';
}
</script>

<template>
  <div class="@container max-w-lg">
    <ol class="grid grid-cols-5" aria-label="Progress" data-testid="ticket-track">
    <li v-for="(s, i) in stages" :key="s.key" class="min-w-0" :data-state="s.state">
      <div class="flex h-3 items-center">
        <span class="relative grid h-2.5 w-2.5 shrink-0 place-items-center rounded-full ring-1 transition-colors duration-300" :class="dotClass(s.state)">
          <span v-if="s.state === 'current'" class="h-1 w-1 animate-pulse rounded-full bg-brand-600" />
        </span>
        <!-- Connector to the next stage: fills from the left once the next stage is reached. -->
        <span
          v-if="i < stages.length - 1"
          class="mx-1 h-0.5 flex-1 overflow-hidden rounded-full"
          :class="stages[i + 1].state === 'skipped' ? 'track-dashed' : 'bg-slate-200'"
        >
          <span
            class="block h-full origin-left bg-brand-600 transition-transform duration-500 ease-(--ease-out-quint)"
            :class="reached(stages[i + 1].state) ? 'scale-x-100' : 'scale-x-0'"
          />
        </span>
      </div>
      <p class="mt-1.5 hidden pr-1 text-xs leading-tight @[20rem]:block" :class="labelClass(s.state)">
        {{ s.label }}<span class="sr-only">: {{ stateText(s.state) }}</span>
      </p>
      <span class="sr-only @[20rem]:hidden">{{ s.label }}: {{ stateText(s.state) }}</span>
    </li>
  </ol>
    <p class="mt-1.5 text-xs @[20rem]:hidden" :class="labelClass(furthest.state)" aria-hidden="true">
      {{ furthest.label }}<template v-if="furthest.state === 'current'">: in progress</template>
    </p>
  </div>
</template>

<style scoped>
.track-dashed {
  background-image: linear-gradient(90deg, var(--color-slate-300) 50%, transparent 50%);
  background-size: 6px 2px;
}
</style>
