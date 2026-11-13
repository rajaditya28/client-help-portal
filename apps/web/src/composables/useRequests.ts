import { onMounted, ref } from 'vue';
import { SocketEvents } from '@help/shared';
import type { CallDto, HelpRequestDto } from '@help/shared';
import { api } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';

/**
 * The current user's requests, kept live over the socket.
 * The server only ever pushes events for rows the user owns, so no client-side filtering is needed.
 */
export function useRequests() {
  const requests = ref<HelpRequestDto[]>([]);
  const loading = ref(true);
  const error = ref('');
  const freshIds = ref(new Set<string>());

  async function load() {
    try {
      requests.value = await api.listRequests();
      error.value = '';
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
  }

  function upsert(r: HelpRequestDto) {
    const i = requests.value.findIndex((x) => x.id === r.id);
    if (i === -1) requests.value = [r, ...requests.value];
    else requests.value.splice(i, 1, r);
  }

  useSocketEvent<HelpRequestDto>(SocketEvents.RequestCreated, (r) => {
    upsert(r);
    freshIds.value = new Set([...freshIds.value, r.id]);
  });
  useSocketEvent<HelpRequestDto>(SocketEvents.RequestUpdated, upsert);
  // Socket reconnect after a network blip: refetch anything we may have missed.
  useSocketEvent('connect', load);

  onMounted(load);
  return { requests, loading, error, freshIds, upsert, reload: load };
}

export function useCallEvents(handler: (c: CallDto) => void) {
  useSocketEvent<CallDto>(SocketEvents.CallUpdated, handler);
}
