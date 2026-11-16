<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { CallDetailDto } from '@help/shared';
import StatusBadge from '@/components/StatusBadge.vue';
import SummaryCard from '@/components/SummaryCard.vue';
import TranscriptList from '@/components/TranscriptList.vue';
import { useCallEvents } from '@/composables/useRequests';
import { api } from '@/lib/api';
import { clock, dateTime } from '@/lib/format';
import { ticketRef } from '@/lib/track';

const props = defineProps<{ id: string }>();

const call = ref<CallDetailDto | null>(null);
const error = ref('');
const videoUrl = ref<string | null>(null);
const player = ref<HTMLVideoElement | null>(null);
const currentMs = ref(0);

async function load() {
  try {
    call.value = await api.getCall(props.id);
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

// Pipeline progress arrives live; refetch the detail when this call changes.
useCallEvents((c) => {
  if (c.id === props.id) void load();
});

// Media URLs are short-lived and fetched after an ownership check (a <video> can't send auth headers).
watch(
  () => call.value?.hasRecording,
  async (has) => {
    if (!has || videoUrl.value) return;
    try {
      videoUrl.value = (await api.recordingUrl(props.id)).url;
    } catch (e) {
      error.value = (e as Error).message;
    }
  },
);

function seek(ms: number) {
  const el = player.value;
  if (!el) return;
  el.currentTime = ms / 1000;
  void el.play();
}

const pipelineSteps = computed(() => {
  const c = call.value;
  if (!c) return [];
  const failed = c.processingStatus === 'FAILED';
  return [
    { label: 'Recording uploaded', done: c.hasRecording },
    { label: 'Transcript', done: !!c.transcript },
    { label: 'Summary', done: !!c.summary },
  ].map((s, i, all) => ({ ...s, active: !s.done && !failed && all.slice(0, i).every((p) => p.done) }));
});

const processing = computed(() => ['QUEUED', 'PROCESSING'].includes(call.value?.processingStatus ?? ''));
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-8">
    <RouterLink to="/history" class="inline-flex items-center gap-1 text-sm font-medium text-slate-600 transition-colors hover:text-brand-700">
      <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" aria-hidden="true"><path d="M10 3.5 5.5 8 10 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
      Call history
    </RouterLink>

    <p v-if="error" class="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{{ error }}</p>
    <div v-if="!call && !error" class="mt-6 space-y-4" aria-label="Loading call"><div class="h-7 w-72 animate-pulse rounded-md bg-slate-200/70" /><div class="aspect-video w-full max-w-3xl animate-pulse rounded-[10px] bg-slate-200/70" /></div>

    <template v-if="call">
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <span class="ticket-ref">{{ ticketRef(call.requestId) }}</span>
        <h1 class="text-xl font-semibold tracking-tight">{{ call.requestTitle }}</h1>
        <StatusBadge :status="call.status === 'ENDED' ? call.processingStatus : call.status" />
      </div>
      <p class="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
        <span><span class="font-medium text-slate-800">{{ call.consultant.name }}</span> with <span class="font-medium text-slate-800">{{ call.client.name }}</span></span>
        <time>{{ dateTime(call.createdAt) }}</time>
        <span v-if="call.recordingDurationMs" class="tabular-nums">{{ clock(call.recordingDurationMs) }} recorded</span>
      </p>

      <div v-if="call.status !== 'ENDED'" class="card mt-6 p-6 text-sm">
        This call is still in progress.
        <RouterLink :to="`/call/${call.id}`" class="font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:decoration-brand-600">Go to the call</RouterLink>
      </div>

      <div v-else-if="call.processingStatus === 'NOT_RECORDED'" class="card mt-6 p-6 text-sm text-slate-600">
        This call was not recorded{{ call.consent === 'DECLINED' ? ' because the client declined.' : '.' }}
      </div>

      <template v-else>
        <!-- Pipeline progress -->
        <div v-if="processing || call.processingStatus === 'FAILED'" class="card mt-6 p-4" data-testid="pipeline">
          <ol class="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <li v-for="s in pipelineSteps" :key="s.label" class="flex items-center gap-2">
              <span v-if="s.done" class="grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-white"><svg viewBox="0 0 16 16" class="h-3 w-3" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg></span>
              <span v-else-if="s.active" class="h-5 w-5 animate-spin rounded-full border-2 border-brand-100 border-t-brand-600" />
              <span v-else class="h-5 w-5 rounded-full border-2 border-slate-200" />
              <span :class="s.done ? 'text-slate-700' : 'text-slate-500'">{{ s.label }}</span>
            </li>
          </ol>
          <p v-if="call.processingStatus === 'FAILED'" class="mt-3 text-sm text-red-800">{{ call.processingError }}</p>
          <p v-else class="mt-3 text-xs text-slate-500">Processing runs in the background. This page updates by itself.</p>
        </div>

        <div class="mt-6 grid gap-6 lg:grid-cols-5">
          <div class="space-y-6 lg:col-span-3">
            <div class="overflow-hidden rounded-[10px] bg-slate-950">
              <video
                v-if="videoUrl"
                ref="player"
                :src="videoUrl"
                controls
                preload="metadata"
                class="aspect-video w-full"
                data-testid="recording-player"
                @timeupdate="currentMs = ($event.target as HTMLVideoElement).currentTime * 1000"
              />
              <div v-else class="grid aspect-video place-items-center text-sm text-slate-400">
                {{ call.hasRecording ? 'Loading recording…' : 'The recording is being prepared…' }}
              </div>
            </div>
            <SummaryCard v-if="call.summary" :summary="call.summary" :model="call.summaryModel" />
          </div>

          <div class="lg:col-span-2">
            <TranscriptList v-if="call.transcript" :segments="call.transcript" :current-ms="currentMs" @seek="seek" />
            <div v-else class="card p-6 text-sm text-slate-500">The transcript will appear here when it's ready.</div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
