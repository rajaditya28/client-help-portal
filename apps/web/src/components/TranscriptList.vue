<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { TranscriptSegmentDto } from '@help/shared';
import { clock } from '@/lib/format';

const props = defineProps<{ segments: TranscriptSegmentDto[]; currentMs: number }>();
const emit = defineEmits<{ seek: [ms: number] }>();

const list = ref<HTMLElement | null>(null);

/** Index of the line being spoken at the current playback position. */
const activeIndex = computed(() => {
  let idx = -1;
  for (let i = 0; i < props.segments.length; i++) {
    if (props.segments[i].startMs <= props.currentMs + 150) idx = i;
    else break;
  }
  return idx;
});

// Keep the active line in view while the recording plays.
watch(activeIndex, (i) => {
  const el = list.value?.querySelector<HTMLElement>(`[data-index="${i}"]`);
  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});

function color(s: TranscriptSegmentDto) {
  if (s.role === 'CONSULTANT') return 'text-indigo-700';
  if (s.role === 'CLIENT') return 'text-emerald-700';
  return 'text-slate-600';
}
</script>

<template>
  <div class="card flex max-h-[38rem] flex-col">
    <div class="border-b border-slate-100 px-4 py-3">
      <h2 class="font-semibold">Transcript</h2>
      <p class="text-xs text-slate-500">Click a line to jump to that moment in the recording.</p>
    </div>
    <div v-if="!segments.length" class="p-6 text-sm text-slate-500">No speech was detected in this recording.</div>
    <ol v-else ref="list" class="flex-1 overflow-y-auto p-2" data-testid="transcript">
      <li v-for="(s, i) in segments" :key="i" :data-index="i" :data-active="i === activeIndex">
        <button
          class="w-full rounded-lg px-3 py-2 text-left transition hover:bg-slate-50"
          :class="{ 'bg-indigo-50 hover:bg-indigo-50': i === activeIndex }"
          @click="emit('seek', s.startMs)"
        >
          <div class="flex items-baseline gap-2 text-xs">
            <span class="font-mono tabular-nums text-slate-400">{{ clock(s.startMs) }}</span>
            <span class="font-semibold" :class="color(s)">{{ s.speaker }}</span>
          </div>
          <p class="mt-0.5 text-sm leading-relaxed text-slate-800">{{ s.text }}</p>
        </button>
      </li>
    </ol>
  </div>
</template>
