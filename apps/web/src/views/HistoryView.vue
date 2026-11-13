<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { CallDto } from '@help/shared';
import StatusBadge from '@/components/StatusBadge.vue';
import { useCallEvents } from '@/composables/useRequests';
import { api } from '@/lib/api';
import { clock, dateTime } from '@/lib/format';
import { useAuth } from '@/stores/auth';

const auth = useAuth();
const calls = ref<CallDto[]>([]);
const loading = ref(true);
const error = ref('');

async function load() {
  try {
    calls.value = await api.listCalls();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// Processing status changes arrive live (Queued -> Processing -> Ready).
useCallEvents((c) => {
  const i = calls.value.findIndex((x) => x.id === c.id);
  if (i === -1) calls.value = [c, ...calls.value];
  else calls.value.splice(i, 1, c);
});

function duration(c: CallDto) {
  if (c.recordingDurationMs) return clock(c.recordingDurationMs);
  if (c.startedAt && c.endedAt) return clock(new Date(c.endedAt).getTime() - new Date(c.startedAt).getTime());
  return '–';
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-8">
    <h1 class="text-xl font-semibold tracking-tight">Call history</h1>
    <p class="mt-1 text-sm text-slate-500">Recordings, transcripts and summaries of your calls.</p>

    <p v-if="error" class="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>

    <div class="card mt-6 overflow-hidden">
      <div v-if="loading" class="p-8 text-center text-sm text-slate-500">Loading…</div>
      <div v-else-if="!calls.length" class="p-10 text-center text-sm text-slate-500">No calls yet.</div>
      <table v-else class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-5 py-3 font-medium">Request</th>
            <th class="px-5 py-3 font-medium">{{ auth.isConsultant ? 'Client' : 'Consultant' }}</th>
            <th class="px-5 py-3 font-medium">Date</th>
            <th class="px-5 py-3 font-medium">Length</th>
            <th class="px-5 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="c in calls" :key="c.id" class="cursor-pointer hover:bg-slate-50" @click="$router.push(`/history/${c.id}`)">
            <td class="px-5 py-3 font-medium">
              <RouterLink :to="`/history/${c.id}`" class="hover:text-indigo-600" @click.stop>{{ c.requestTitle }}</RouterLink>
            </td>
            <td class="px-5 py-3 text-slate-600">{{ auth.isConsultant ? c.client.name : c.consultant.name }}</td>
            <td class="px-5 py-3 text-slate-600">{{ dateTime(c.createdAt) }}</td>
            <td class="px-5 py-3 tabular-nums text-slate-600">{{ duration(c) }}</td>
            <td class="px-5 py-3">
              <StatusBadge :status="c.status === 'ENDED' ? c.processingStatus : c.status" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
