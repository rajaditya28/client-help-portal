<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { HelpRequestDto } from '@help/shared';
import { useCallEvents, useRequests } from '@/composables/useRequests';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { ticketRef } from '@/lib/track';
import TicketTrack from './TicketTrack.vue';

const router = useRouter();
const { requests, loading, error, freshIds, upsert, reload } = useRequests();
const busyId = ref<string | null>(null);
const actionError = ref('');
const now = ref(Date.now());
const tick = window.setInterval(() => (now.value = Date.now()), 30_000);
onUnmounted(() => window.clearInterval(tick));

// Recording and summary progress arrive as call events; refetch so each request's track moves on.
useCallEvents(() => void reload());

const open = computed(() => requests.value.filter((r) => r.status !== 'RESOLVED'));
const resolved = computed(() => requests.value.filter((r) => r.status === 'RESOLVED'));

// Surface new requests even when the tab is in the background.
const baseTitle = document.title;
watch(
  () => freshIds.value.size,
  (n) => (document.title = n ? `(${n}) New request · ${baseTitle}` : baseTitle),
);
onUnmounted(() => (document.title = baseTitle));

async function startCall(r: HelpRequestDto) {
  busyId.value = r.id;
  actionError.value = '';
  try {
    const call = r.activeCallId ? { id: r.activeCallId } : await api.startCall(r.id);
    await router.push({ name: 'call', params: { id: call.id } });
  } catch (e) {
    actionError.value = (e as Error).message;
  } finally {
    busyId.value = null;
  }
}

async function resolve(r: HelpRequestDto) {
  busyId.value = r.id;
  try {
    upsert(await api.resolveRequest(r.id));
  } catch (e) {
    actionError.value = (e as Error).message;
  } finally {
    busyId.value = null;
  }
}

function seen(id: string) {
  if (!freshIds.value.has(id)) return;
  const next = new Set(freshIds.value);
  next.delete(id);
  freshIds.value = next;
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-8">
    <div class="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 class="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
          Help requests
          <span v-if="!loading" class="rounded-full bg-slate-200/70 px-2 py-0.5 text-xs font-semibold text-slate-700 tabular-nums">{{ open.length }} open</span>
        </h1>
        <p class="mt-1 text-sm text-slate-600">New requests from your clients appear here instantly.</p>
      </div>
      <span class="inline-flex shrink-0 items-center gap-2 text-xs font-medium text-slate-600">
        <span class="relative flex h-2 w-2">
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-60" />
          <span class="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
        </span>
        Live
      </span>
    </div>

    <p v-if="error || actionError" class="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{{ error || actionError }}</p>

    <div class="card overflow-hidden">
      <div v-if="loading" class="space-y-3 p-5" aria-label="Loading requests">
        <div v-for="n in 3" :key="n" class="h-14 animate-pulse rounded-md bg-slate-100" />
      </div>
      <div v-else-if="!open.length" class="px-6 py-12 text-center">
        <p class="font-medium text-slate-800">No open requests</p>
        <p class="mx-auto mt-1 max-w-sm text-sm text-slate-600">When a client raises a request it lands here straight away, with no refresh needed.</p>
      </div>
      <ul v-else class="divide-y divide-slate-200/70" data-testid="open-requests">
        <li
          v-for="r in open"
          :key="r.id"
          class="grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-[auto_1fr_auto]"
          :class="{ 'flash-in': freshIds.has(r.id) }"
          @mouseenter="seen(r.id)"
        >
          <span class="ticket-ref mt-0.5">{{ ticketRef(r.id) }}</span>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-semibold text-slate-900">{{ r.title }}</span>
              <span v-if="freshIds.has(r.id)" class="rounded-full bg-capture px-2 py-0.5 text-xs font-semibold text-brand-950">New</span>
            </div>
            <p v-if="r.description" class="mt-1 line-clamp-2 max-w-prose text-sm text-slate-600">{{ r.description }}</p>
            <p class="mt-1 flex gap-3 text-xs">
              <span class="font-medium text-slate-700">{{ r.client.name }}</span>
              <span class="text-slate-500">{{ timeAgo(r.createdAt, now) }}</span>
            </p>
            <TicketTrack :request="r" class="mt-3.5" />
          </div>
          <div class="col-start-2 flex flex-wrap gap-2 sm:col-start-auto sm:justify-end">
            <RouterLink
              v-if="r.lastCallId && !r.activeCallId"
              :to="{ name: 'call-detail', params: { id: r.lastCallId } }"
              class="btn-ghost"
              :data-testid="`view-call-${r.id}`"
            >
              View call
            </RouterLink>
            <button class="btn-secondary" :disabled="busyId === r.id || !!r.activeCallId" @click="resolve(r)">Mark resolved</button>
            <button class="btn-primary" :disabled="busyId === r.id" :data-testid="`start-call-${r.id}`" @click="startCall(r)">
              {{ r.activeCallId ? 'Rejoin call' : 'Start call' }}
            </button>
          </div>
        </li>
      </ul>
    </div>

    <details v-if="resolved.length" class="group mt-8">
      <summary class="flex w-fit items-center gap-2 text-sm font-semibold text-slate-700 [&::-webkit-details-marker]:hidden">
        <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 text-slate-500 transition-transform duration-200 group-open:rotate-90" aria-hidden="true">
          <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        Resolved
        <span class="font-medium text-slate-500 tabular-nums">{{ resolved.length }}</span>
      </summary>
      <ul class="card mt-3 divide-y divide-slate-200/70">
        <li v-for="r in resolved" :key="r.id" class="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-2 px-5 py-3 text-sm lg:grid-cols-[auto_1fr_24rem_auto]">
          <span class="ticket-ref">{{ ticketRef(r.id) }}</span>
          <span class="min-w-0">
            <span class="block truncate font-medium text-slate-800">{{ r.title }}</span>
            <span class="flex gap-3 text-xs">
              <span class="text-slate-600">{{ r.client.name }}</span>
              <span class="text-slate-500">{{ timeAgo(r.updatedAt, now) }}</span>
            </span>
          </span>
          <TicketTrack :request="r" class="hidden lg:grid" />
          <RouterLink
            v-if="r.lastCallId"
            :to="{ name: 'call-detail', params: { id: r.lastCallId } }"
            class="btn-ghost -my-1 text-brand-700 hover:text-brand-800"
            :data-testid="`view-call-${r.id}`"
          >
            View call
          </RouterLink>
          <span v-else class="text-xs text-slate-500">No call</span>
        </li>
      </ul>
    </details>
  </div>
</template>
