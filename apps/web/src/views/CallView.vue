<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import { MAX_CALL_DURATION_MS } from '@help/shared';
import type { CallDto } from '@help/shared';
import { CallSession, type PeerState } from '@/call/CallSession';
import { Recorder, type RecorderStats } from '@/call/Recorder';
import { useCallEvents } from '@/composables/useRequests';
import { api } from '@/lib/api';
import { clock } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import ConsentDialog from '@/components/ConsentDialog.vue';

const props = defineProps<{ id: string }>();
const router = useRouter();
const auth = useAuth();
const isConsultant = computed(() => auth.isConsultant);

type Phase = 'loading' | 'lobby' | 'joining' | 'in-call' | 'leaving' | 'error';
const phase = ref<Phase>('loading');
const errorMsg = ref('');
const call = ref<CallDto | null>(null);
const peerState = ref<PeerState>('waiting');
const muted = ref(false);
const sharing = ref(false);
const remoteHasVideo = ref(false);
const consentBusy = ref(false);
const now = ref(Date.now());

const session = shallowRef<CallSession | null>(null);
const recorder = shallowRef<Recorder | null>(null);
const recorderStats = ref<RecorderStats | null>(null);
const remoteStream = shallowRef<MediaStream | null>(null);
const remoteGeneration = ref(0);
/** Bumped on every remote track so watchers re-run when the 2nd track of a connection arrives. */
const remoteTrackCount = ref(0);
let recordedGeneration = 0;

const remoteVideo = ref<HTMLVideoElement | null>(null);
const remoteAudio = ref<HTMLAudioElement | null>(null);
const screenPreview = ref<HTMLVideoElement | null>(null);

const other = computed(() => (isConsultant.value ? call.value?.client.name : call.value?.consultant.name) ?? '');
const elapsed = computed(() => (call.value?.startedAt ? now.value - new Date(call.value.startedAt).getTime() : 0));

const tick = window.setInterval(() => {
  now.value = Date.now();
  // Safety net: the consultant auto-ends a call that ran past the hard cap.
  if (isConsultant.value && phase.value === 'in-call' && elapsed.value > MAX_CALL_DURATION_MS) void endCall();
}, 1000);

onMounted(async () => {
  try {
    const detail = await api.getCall(props.id);
    if (detail.status === 'ENDED') {
      await router.replace({ name: 'call-detail', params: { id: props.id } });
      return;
    }
    call.value = detail;
    phase.value = 'lobby';
  } catch (e) {
    errorMsg.value = (e as Error).message;
    phase.value = 'error';
  }
});

useCallEvents((c) => {
  if (c.id !== props.id) return;
  call.value = c;
  if (c.status === 'ENDED' && phase.value !== 'leaving') void finish();
});

/* ------------------------------------------------------------------ joining */

async function join() {
  phase.value = 'joining';
  errorMsg.value = '';
  try {
    const { iceServers } = await api.rtcConfig();
    const s = new CallSession(props.id, auth.user!.role, iceServers, {
      onRemoteStream(stream, generation) {
        remoteStream.value = stream;
        remoteGeneration.value = generation;
        remoteTrackCount.value++;
      },
      onPeerState(state) {
        peerState.value = state;
      },
      onRemoteScreen(isSharing) {
        remoteHasVideo.value = isSharing;
      },
      onError(message) {
        errorMsg.value = message;
      },
    });
    session.value = s;
    await s.start();
    phase.value = 'in-call';
  } catch (e) {
    const err = e as DOMException;
    errorMsg.value =
      err.name === 'NotAllowedError'
        ? 'Microphone permission was denied. Allow it in the address bar and try again.'
        : err.message || 'Could not join the call';
    await session.value?.leave();
    session.value = null;
    phase.value = 'lobby';
  }
}

// Attach remote media whenever the stream or the element changes (tracks can arrive before the element renders).
watch([remoteStream, remoteTrackCount, remoteVideo, remoteAudio], () => {
  const stream = remoteStream.value;
  const el = isConsultant.value ? remoteVideo.value : remoteAudio.value;
  if (!stream || !el) return;
  if (el.srcObject !== stream) el.srcObject = stream;
  // Whether the client is sharing comes from an explicit signal (see CallSession), not from
  // the video track: a stopped share just stops frames, and the element keeps the last one.
});

/* ---------------------------------------------------------------- recording */

// Consultant: start (or restart, after a reconnect) recording once consent is given and the
// client's tracks have arrived. Each peer-connection generation is a new recording segment.
watch(
  [() => call.value?.consent, remoteGeneration, remoteTrackCount, phase],
  async () => {
    if (!isConsultant.value || phase.value !== 'in-call') return;
    if (call.value?.consent !== 'GRANTED' || call.value.status === 'ENDED') return;
    const stream = remoteStream.value;
    // Wait for both remote tracks: starting on video alone would record without the client's voice.
    if (!stream?.getVideoTracks().length || !stream.getAudioTracks().length) return;
    if (recordedGeneration === remoteGeneration.value) return;
    recordedGeneration = remoteGeneration.value;
    if (!recorder.value) {
      const startedAt = call.value.startedAt ? new Date(call.value.startedAt).getTime() : Date.now();
      recorder.value = new Recorder(props.id, startedAt, (s) => (recorderStats.value = { ...s }));
    }
    try {
      await recorder.value.start(session.value!.micStream!, stream);
    } catch (e) {
      errorMsg.value = `Recording could not start: ${(e as Error).message}`;
    }
  },
);

const recordingLabel = computed(() => {
  const c = call.value;
  if (!c) return '';
  if (c.consent === 'PENDING') return isConsultant.value ? `Waiting for ${c.client.name} to allow recording` : 'Recording needs your permission';
  if (c.consent === 'DECLINED') return 'Not recorded: the client declined';
  const s = recorderStats.value;
  if (!isConsultant.value) return 'This call is being recorded';
  if (!s || s.state === 'idle') return 'Recording starts when the client connects';
  if (s.state === 'error') return s.error ?? 'Recording error';
  return `Recording · ${s.uploaded} chunk${s.uploaded === 1 ? '' : 's'} uploaded (${(s.bytes / 1_048_576).toFixed(1)} MB)${
    s.pending ? ` · ${s.pending} pending` : ''
  }`;
});
const isRecordingLive = computed(() => call.value?.consent === 'GRANTED');

/* ------------------------------------------------------------------ controls */

async function setConsent(granted: boolean) {
  consentBusy.value = true;
  try {
    call.value = await api.consent(props.id, granted);
  } catch (e) {
    errorMsg.value = (e as Error).message;
  } finally {
    consentBusy.value = false;
  }
}

function toggleMute() {
  muted.value = !muted.value;
  session.value?.setMuted(muted.value);
}

async function toggleShare() {
  if (!session.value) return;
  try {
    if (sharing.value) {
      await session.value.stopScreenShare();
      sharing.value = false;
    } else {
      const stream = await session.value.startScreenShare();
      sharing.value = true;
      stream.getVideoTracks()[0].addEventListener('ended', () => (sharing.value = false));
      await nextTick();
      if (screenPreview.value) screenPreview.value.srcObject = stream;
    }
  } catch (e) {
    if ((e as DOMException).name !== 'NotAllowedError') errorMsg.value = (e as Error).message; // cancelled picker is fine
  }
}

async function endCall() {
  if (phase.value === 'leaving') return;
  try {
    await api.endCall(props.id);
  } catch (e) {
    errorMsg.value = (e as Error).message;
  }
  await finish();
}

/** Tear down in order: flush the recording, tell the server it's complete, leave, go to the call's history page. */
async function finish() {
  if (phase.value === 'leaving') return;
  phase.value = 'leaving';
  if (recorder.value) {
    await recorder.value.stop();
    await api.completeRecording(props.id).catch(() => undefined);
  }
  await session.value?.leave();
  session.value = null;
  await router.replace({ name: 'call-detail', params: { id: props.id } });
}

onBeforeUnmount(() => {
  window.clearInterval(tick);
  // Navigating away without ending: stop recording (remaining chunks still upload) and leave the room.
  // The call stays live, so either side can come back and rejoin.
  if (phase.value !== 'leaving') {
    void recorder.value?.stop();
    void session.value?.leave();
  }
});

const peerLabel = computed(
  () =>
    ({
      waiting: `Waiting for ${other.value} to join…`,
      connecting: `Connecting to ${other.value}…`,
      connected: `Connected with ${other.value}`,
      reconnecting: `${other.value} disconnected. Waiting for them to rejoin…`,
    })[peerState.value],
);
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6">
    <div v-if="phase === 'loading'" class="py-20 text-center text-slate-500">Loading call…</div>

    <div v-else-if="phase === 'error'" class="card mx-auto max-w-md p-8 text-center">
      <p class="font-medium">Can't open this call</p>
      <p class="mt-1 text-sm text-slate-500">{{ errorMsg }}</p>
      <RouterLink to="/" class="btn-secondary mt-4">Back to dashboard</RouterLink>
    </div>

    <!-- Lobby: a click is required (mic permission + audio autoplay), which also makes refresh-rejoin explicit. -->
    <div v-else-if="phase === 'lobby' || phase === 'joining'" class="card mx-auto max-w-lg p-8 text-center">
      <p class="text-sm font-medium text-indigo-600">{{ call?.requestTitle }}</p>
      <h1 class="mt-1 text-xl font-semibold">Call with {{ other }}</h1>
      <p class="mt-2 text-sm text-slate-500">
        {{
          isConsultant
            ? 'You will hear the client and see their screen once they share it.'
            : 'Your consultant will hear you. You can share your screen once you are in.'
        }}
      </p>
      <p v-if="call?.status === 'ACTIVE'" class="mt-3 text-xs text-slate-500">This call is in progress. Joining again reconnects you.</p>
      <p v-if="errorMsg" class="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ errorMsg }}</p>
      <div class="mt-6 flex justify-center gap-3">
        <RouterLink to="/" class="btn-secondary">Back</RouterLink>
        <button class="btn-primary" :disabled="phase === 'joining'" data-testid="join" @click="join">
          {{ phase === 'joining' ? 'Joining…' : call?.status === 'ACTIVE' ? 'Rejoin call' : 'Join call' }}
        </button>
      </div>
    </div>

    <div v-else class="space-y-4">
      <!-- Status bar -->
      <div class="card flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <div class="min-w-0">
          <p class="truncate text-sm font-medium">{{ call?.requestTitle }}</p>
          <p class="text-xs text-slate-500" data-testid="peer-state">{{ peerLabel }}</p>
        </div>
        <div class="flex items-center gap-2 text-sm" data-testid="recording-status">
          <span v-if="isRecordingLive" class="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-600" />
          <span v-else class="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span :class="isRecordingLive ? 'text-rose-700' : 'text-slate-600'">{{ recordingLabel }}</span>
        </div>
        <div class="ml-auto font-mono text-sm tabular-nums text-slate-600">{{ clock(elapsed) }}</div>
      </div>

      <p v-if="errorMsg" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ errorMsg }}</p>

      <!-- Stage -->
      <div class="relative aspect-video overflow-hidden rounded-xl bg-slate-900">
        <template v-if="isConsultant">
          <video ref="remoteVideo" autoplay playsinline class="h-full w-full object-contain" data-testid="remote-video" />
          <div v-if="!remoteHasVideo" class="absolute inset-0 grid place-items-center bg-slate-900 text-center text-slate-300" data-testid="no-screen">
            <div>
              <p class="text-lg font-medium">{{ peerState === 'connected' ? `${other} is not sharing their screen yet` : peerLabel }}</p>
              <p v-if="peerState === 'connected'" class="mt-1 text-sm text-slate-400">You can talk in the meantime.</p>
            </div>
          </div>
        </template>
        <template v-else>
          <audio ref="remoteAudio" autoplay />
          <video v-show="sharing" ref="screenPreview" autoplay muted playsinline class="h-full w-full object-contain" />
          <div v-if="!sharing" class="absolute inset-0 grid place-items-center text-center text-slate-300">
            <div>
              <p class="text-lg font-medium">Share your screen so {{ other }} can see what you see</p>
              <button class="btn-primary mt-4" data-testid="share-screen" @click="toggleShare">Share screen</button>
            </div>
          </div>
          <span v-else class="absolute left-3 top-3 rounded bg-black/60 px-2 py-1 text-xs text-white">You are sharing your screen</span>
        </template>
      </div>

      <!-- Controls -->
      <div class="flex flex-wrap items-center justify-center gap-3">
        <button class="btn-secondary min-w-28" :class="{ '!bg-rose-50 !text-rose-700': muted }" @click="toggleMute">
          {{ muted ? 'Unmute' : 'Mute' }}
        </button>
        <button v-if="!isConsultant" class="btn-secondary min-w-28" @click="toggleShare">
          {{ sharing ? 'Stop sharing' : 'Share screen' }}
        </button>
        <button
          v-if="!isConsultant && call?.consent === 'DECLINED'"
          class="btn-secondary"
          :disabled="consentBusy"
          @click="setConsent(true)"
        >
          Allow recording
        </button>
        <button class="btn-danger min-w-28" data-testid="end-call" @click="endCall">End call</button>
      </div>
    </div>

    <ConsentDialog
      v-if="phase === 'in-call' && !isConsultant && call?.consent === 'PENDING'"
      :consultant-name="call.consultant.name"
      :busy="consentBusy"
      @decide="setConsent"
    />

    <div v-if="phase === 'leaving'" class="fixed inset-0 z-50 grid place-items-center bg-white/80 backdrop-blur-sm">
      <div class="text-center">
        <p class="font-medium">Ending call…</p>
        <p v-if="recorder" class="mt-1 text-sm text-slate-500">Uploading the last part of the recording</p>
      </div>
    </div>
  </div>
</template>
