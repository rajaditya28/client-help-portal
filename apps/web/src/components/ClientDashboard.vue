<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { CallDto } from '@help/shared';
import { useCallEvents, useRequests } from '@/composables/useRequests';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { ticketRef } from '@/lib/track';
import TicketTrack from './TicketTrack.vue';

const router = useRouter();
const { requests, loading, error, upsert, reload } = useRequests();

const title = ref('');
const description = ref('');
const submitting = ref(false);
const formError = ref('');
const now = ref(Date.now());
const tick = window.setInterval(() => (now.value = Date.now()), 30_000);
onUnmounted(() => window.clearInterval(tick));

/** A live call the consultant started for one of my requests. */
const incoming = ref<CallDto | null>(null);
useCallEvents((c) => {
  if (c.status === 'ENDED') {
    if (incoming.value?.id === c.id) incoming.value = null;
  } else {
    incoming.value = c;
  }
  void reload();
});

/** The call to offer "Join" for: a live push, or (after a refresh) any request with a call in progress. */
const liveCall = computed(() => {
  if (incoming.value) return { id: incoming.value.id, who: incoming.value.consultant.name, title: incoming.value.requestTitle };
  const r = requests.value.find((x) => x.activeCallId);
  return r ? { id: r.activeCallId!, who: r.consultant.name, title: r.title } : null;
});

async function submit() {
  formError.value = '';
  submitting.value = true;
  try {
    upsert(await api.createRequest(title.value, description.value));
    title.value = '';
    description.value = '';
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    submitting.value = false;
  }
}

function join(callId: string) {
  void router.push({ name: 'call', params: { id: callId } });
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-8">
    <div
      v-if="liveCall"
      class="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-rose-200 bg-white px-5 py-4 shadow-[0_8px_24px_-12px_rgb(190_18_60/0.35)]"
      data-testid="incoming-call"
    >
      <div class="flex items-center gap-3.5">
        <span class="relative flex h-3 w-3">
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
          <span class="relative inline-flex h-3 w-3 rounded-full bg-rose-600" />
        </span>
        <div>
          <p class="font-semibold text-slate-900">{{ liveCall.who }} is calling you</p>
          <p class="text-sm text-slate-600">About “{{ liveCall.title }}”. Join to share your screen and talk.</p>
        </div>
      </div>
      <button class="btn-primary" data-testid="join-call" @click="join(liveCall.id)">Join call</button>
    </div>

    <div class="grid gap-6 lg:grid-cols-5">
      <section class="card self-start p-5 lg:col-span-2">
        <h2 class="font-semibold text-slate-900">Raise a help request</h2>
        <p class="mt-1 text-sm text-slate-600">Your consultant sees it right away and can start a call.</p>
        <form class="mt-5 space-y-4" @submit.prevent="submit">
          <div>
            <label class="label" for="title">What are you stuck on?</label>
            <input
              id="title"
              v-model="title"
              class="input"
              placeholder="e.g. Invoice template won't save"
              minlength="3"
              maxlength="120"
              required
              data-testid="request-title"
            />
          </div>
          <div>
            <label class="label" for="desc">Details <span class="font-normal text-slate-500">(optional)</span></label>
            <textarea
              id="desc"
              v-model="description"
              class="input min-h-24"
              maxlength="2000"
              placeholder="What did you try? What happened?"
            />
          </div>
          <p v-if="formError" class="text-sm text-red-800">{{ formError }}</p>
          <button class="btn-primary w-full" :disabled="submitting" data-testid="submit-request">
            {{ submitting ? 'Sending…' : 'Send request' }}
          </button>
        </form>
      </section>

      <section class="lg:col-span-3">
        <h2 class="mb-3 font-semibold text-slate-900">My requests</h2>
        <p v-if="error" class="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{{ error }}</p>
        <div class="card overflow-hidden">
          <div v-if="loading" class="space-y-3 p-5" aria-label="Loading requests">
            <div v-for="n in 2" :key="n" class="h-14 animate-pulse rounded-md bg-slate-100" />
          </div>
          <div v-else-if="!requests.length" class="px-6 py-12 text-center">
            <p class="font-medium text-slate-800">No requests yet</p>
            <p class="mx-auto mt-1 max-w-xs text-sm text-slate-600">Describe what you're stuck on and your consultant will call you here.</p>
          </div>
          <ul v-else class="divide-y divide-slate-200/70">
            <li v-for="r in requests" :key="r.id" class="grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-[auto_1fr_auto]">
              <span class="ticket-ref mt-0.5">{{ ticketRef(r.id) }}</span>
              <div class="min-w-0">
                <span class="block font-semibold text-slate-900">{{ r.title }}</span>
                <p class="mt-1 flex gap-3 text-xs">
                  <span class="font-medium text-slate-700">{{ r.consultant.name }}</span>
                  <span class="text-slate-500">{{ timeAgo(r.createdAt, now) }}</span>
                </p>
                <TicketTrack :request="r" class="mt-3.5" />
              </div>
              <div class="col-start-2 sm:col-start-auto">
                <button v-if="r.activeCallId" class="btn-primary" @click="join(r.activeCallId)">Join call</button>
                <RouterLink
                  v-else-if="r.lastCallId"
                  :to="{ name: 'call-detail', params: { id: r.lastCallId } }"
                  class="btn-secondary"
                  :data-testid="`view-call-${r.id}`"
                >
                  View call
                </RouterLink>
              </div>
            </li>
          </ul>
        </div>
        <p class="mt-3 text-sm text-slate-600">
          Recordings, transcripts and summaries of past calls are in
          <RouterLink to="/history" class="font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:decoration-brand-600">Call history</RouterLink>.
        </p>
      </section>
    </div>
  </div>
</template>
