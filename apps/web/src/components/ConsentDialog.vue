<script setup lang="ts">
defineProps<{ consultantName: string; busy: boolean }>();
const emit = defineEmits<{ decide: [granted: boolean] }>();
</script>

<template>
  <div class="fixed inset-0 z-40 grid place-items-center bg-slate-900/40 px-4 backdrop-blur-sm">
    <div class="card w-full max-w-md p-6" role="dialog" aria-modal="true" aria-labelledby="consent-title" data-testid="consent-dialog">
      <div class="mb-3 grid h-10 w-10 place-items-center rounded-full bg-rose-50 text-rose-600">
        <span class="h-3 w-3 rounded-full bg-current" />
      </div>
      <h2 id="consent-title" class="text-lg font-semibold">Allow this call to be recorded?</h2>
      <p class="mt-2 text-sm text-slate-600">
        {{ consultantName }} would like to record this call. The recording includes your shared screen and both of your voices.
      </p>
      <p class="mt-2 text-sm text-slate-600">
        After the call you both get the recording, a transcript and a summary in your call history. Only the two of you can see them.
      </p>
      <p class="mt-2 text-sm text-slate-500">If you say no, the call goes ahead without a recording.</p>
      <div class="mt-6 flex justify-end gap-3">
        <button class="btn-secondary" :disabled="busy" data-testid="consent-decline" @click="emit('decide', false)">Don't record</button>
        <button class="btn-primary" :disabled="busy" data-testid="consent-allow" @click="emit('decide', true)">Allow recording</button>
      </div>
    </div>
  </div>
</template>
