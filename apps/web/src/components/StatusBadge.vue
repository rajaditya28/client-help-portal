<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ status: string }>();

const styles: Record<string, [string, string]> = {
  OPEN: ['Open', 'bg-amber-50 text-amber-700 ring-amber-600/20'],
  IN_CALL: ['In call', 'bg-indigo-50 text-indigo-700 ring-indigo-600/20'],
  RESOLVED: ['Resolved', 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'],
  RINGING: ['Ringing', 'bg-indigo-50 text-indigo-700 ring-indigo-600/20'],
  ACTIVE: ['Live', 'bg-rose-50 text-rose-700 ring-rose-600/20'],
  ENDED: ['Ended', 'bg-slate-100 text-slate-600 ring-slate-500/20'],
  NOT_RECORDED: ['Not recorded', 'bg-slate-100 text-slate-600 ring-slate-500/20'],
  RECORDING: ['Recording', 'bg-rose-50 text-rose-700 ring-rose-600/20'],
  QUEUED: ['Queued', 'bg-sky-50 text-sky-700 ring-sky-600/20'],
  PROCESSING: ['Processing', 'bg-sky-50 text-sky-700 ring-sky-600/20'],
  READY: ['Ready', 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'],
  FAILED: ['Failed', 'bg-rose-50 text-rose-700 ring-rose-600/20'],
};

const view = computed(() => styles[props.status] ?? [props.status, 'bg-slate-100 text-slate-600 ring-slate-500/20']);
</script>

<template>
  <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset" :class="view[1]">
    <span
      v-if="status === 'ACTIVE' || status === 'RECORDING' || status === 'PROCESSING'"
      class="h-1.5 w-1.5 animate-pulse rounded-full bg-current"
    />
    {{ view[0] }}
  </span>
</template>
