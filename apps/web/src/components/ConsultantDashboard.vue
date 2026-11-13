<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { HelpRequestDto } from '@help/shared';
import { useRequests } from '@/composables/useRequests';
import { api } from '@/lib/api';
import { initials, timeAgo } from '@/lib/format';
import StatusBadge from './StatusBadge.vue';

const router = useRouter();
const { requests, loading, error, freshIds, upsert } = useRequests();
const busyId = ref<string | null>(null);
const actionError = ref('');
const now = ref(Date.now());
const tick = window.setInterval(() => (now.value = Date.now()), 30_000);
onUnmounted(() => window.clearInterval(tick));

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
    <div class="mb-6 flex items-end justify-between">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Help requests</h1>
        <p class="mt-1 text-sm text-slate-500">New requests from your clients appear here instantly.</p>
      </div>
      <span class="inline-flex items-center gap-2 text-xs text-slate-500">
        <span class="h-2 w-2 rounded-full bg-emerald-500" /> Live
      </span>
    </div>

    <p v-if="error || actionError" class="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error || actionError }}</p>

    <div class="card overflow-hidden">
      <div v-if="loading" class="p-8 text-center text-sm text-slate-500">Loading…</div>
      <div v-else-if="!open.length" class="p-10 text-center">
        <p class="font-medium text-slate-700">No open requests</p>
        <p class="mt-1 text-sm text-slate-500">When a client raises a request it shows up here, no refresh needed.</p>
      </div>
      <ul v-else class="divide-y divide-slate-100" data-testid="open-requests">
        <li
          v-for="r in open"
          :key="r.id"
          class="flex items-start gap-4 px-5 py-4"
          :class="{ 'flash-in': freshIds.has(r.id) }"
          @mouseenter="seen(r.id)"
        >
          <span class="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">
            {{ initials(r.client.name) }}
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium">{{ r.title }}</span>
              <StatusBadge :status="r.status" />
              <span v-if="freshIds.has(r.id)" class="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">New</span>
            </div>
            <p v-if="r.description" class="mt-1 line-clamp-2 text-sm text-slate-600">{{ r.description }}</p>
            <p class="mt-1 text-xs text-slate-500">{{ r.client.name }} · {{ timeAgo(r.createdAt, now) }}</p>
          </div>
          <div class="flex shrink-0 gap-2">
            <button class="btn-secondary" :disabled="busyId === r.id || !!r.activeCallId" @click="resolve(r)">Mark resolved</button>
            <button class="btn-primary" :disabled="busyId === r.id" :data-testid="`start-call-${r.id}`" @click="startCall(r)">
              {{ r.activeCallId ? 'Rejoin call' : 'Start call' }}
            </button>
          </div>
        </li>
      </ul>
    </div>

    <details v-if="resolved.length" class="mt-6">
      <summary class="cursor-pointer text-sm font-medium text-slate-600">Resolved ({{ resolved.length }})</summary>
      <ul class="card mt-3 divide-y divide-slate-100">
        <li v-for="r in resolved" :key="r.id" class="flex items-center justify-between px-5 py-3 text-sm">
          <span>{{ r.title }} <span class="text-slate-500">· {{ r.client.name }}</span></span>
          <span class="text-xs text-slate-500">{{ timeAgo(r.updatedAt, now) }}</span>
        </li>
      </ul>
    </details>
  </div>
</template>
