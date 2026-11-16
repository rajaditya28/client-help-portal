<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ status: string }>();

// Yellow: waiting on someone. Rose with a pulse: live. Green: done. Neutral: nothing to do.
const styles: Record<string, [string, string]> = {
  OPEN: ['Open', 'bg-capture-tint text-capture-ink ring-capture/60'],
  IN_CALL: ['In call', 'bg-rose-50 text-rose-700 ring-rose-600/20'],
  RESOLVED: ['Resolved', 'bg-close-tint text-close-ink ring-close/40'],
  RINGING: ['Ringing', 'bg-capture-tint text-capture-ink ring-capture/60'],
  ACTIVE: ['Live', 'bg-rose-50 text-rose-700 ring-rose-600/20'],
  ENDED: ['Ended', 'bg-slate-100 text-slate-600 ring-slate-500/20'],
  NOT_RECORDED: ['Not recorded', 'bg-slate-100 text-slate-600 ring-slate-500/20'],
  RECORDING: ['Recording', 'bg-rose-50 text-rose-700 ring-rose-600/20'],
  QUEUED: ['Queued', 'bg-brand-50 text-brand-700 ring-brand-600/20'],
  PROCESSING: ['Processing', 'bg-brand-50 text-brand-700 ring-brand-600/20'],
  READY: ['Ready', 'bg-close-tint text-close-ink ring-close/40'],
  FAILED: ['Failed', 'bg-red-50 text-red-800 ring-red-700/25'],
};

const view = computed(() => styles[props.status] ?? [props.status, 'bg-slate-100 text-slate-600 ring-slate-500/20']);
const pulsing = computed(() => ['ACTIVE', 'IN_CALL', 'RECORDING', 'PROCESSING'].includes(props.status));
</script>

<template>
  <span class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset" :class="view[1]">
    <span v-if="pulsing" class="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
    {{ view[0] }}
  </span>
</template>
