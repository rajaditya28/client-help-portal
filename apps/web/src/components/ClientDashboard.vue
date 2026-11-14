<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { CallDto } from '@help/shared';
import { useCallEvents, useRequests } from '@/composables/useRequests';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import StatusBadge from './StatusBadge.vue';

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
      class="mb-6 flex items-center justify-between gap-4 rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-4"
      data-testid="incoming-call"
    >
      <div class="flex items-center gap-3">
        <span class="relative flex h-3 w-3">
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
          <span class="relative inline-flex h-3 w-3 rounded-full bg-indigo-600" />
        </span>
        <div>
          <p class="font-medium text-indigo-900">
            {{ liveCall.who }} is calling you
          </p>
          <p class="text-sm text-indigo-700">About “{{ liveCall.title }}”. Join to share your screen and talk.</p>
        </div>
      </div>
      <button class="btn-primary" data-testid="join-call" @click="join(liveCall.id)">Join call</button>
    </div>

    <div class="grid gap-6 lg:grid-cols-5">
      <section class="card p-5 lg:col-span-2">
        <h2 class="font-semibold">Raise a help request</h2>
        <p class="mt-1 text-sm text-slate-500">Your consultant sees it right away and can start a call.</p>
        <form class="mt-4 space-y-3" @submit.prevent="submit">
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
            <label class="label" for="desc">Details <span class="font-normal text-slate-400">(optional)</span></label>
            <textarea
              id="desc"
              v-model="description"
              class="input min-h-24"
              maxlength="2000"
              placeholder="What did you try? What happened?"
            />
          </div>
          <p v-if="formError" class="text-sm text-rose-600">{{ formError }}</p>
          <button class="btn-primary w-full" :disabled="submitting" data-testid="submit-request">Send request</button>
        </form>
      </section>

      <section class="lg:col-span-3">
        <h2 class="mb-3 font-semibold">My requests</h2>
        <p v-if="error" class="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>
        <div class="card overflow-hidden">
          <div v-if="loading" class="p-8 text-center text-sm text-slate-500">Loading…</div>
          <div v-else-if="!requests.length" class="p-10 text-center text-sm text-slate-500">No requests yet.</div>
          <ul v-else class="divide-y divide-slate-100">
            <li v-for="r in requests" :key="r.id" class="flex items-center gap-4 px-5 py-4">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="truncate font-medium">{{ r.title }}</span>
                  <StatusBadge :status="r.status" />
                </div>
                <p class="mt-0.5 text-xs text-slate-500">{{ timeAgo(r.createdAt, now) }} · {{ r.consultant.name }}</p>
              </div>
              <button v-if="r.activeCallId" class="btn-primary" @click="join(r.activeCallId)">Join call</button>
              <RouterLink
                v-else-if="r.lastCallId"
                :to="{ name: 'call-detail', params: { id: r.lastCallId } }"
                class="btn-secondary"
                :data-testid="`view-call-${r.id}`"
              >
                View call
              </RouterLink>
            </li>
          </ul>
        </div>
        <p class="mt-3 text-sm text-slate-500">
          Recordings, transcripts and summaries of past calls are in
          <RouterLink to="/history" class="font-medium text-indigo-600 hover:underline">Call history</RouterLink>.
        </p>
      </section>
    </div>
  </div>
</template>
