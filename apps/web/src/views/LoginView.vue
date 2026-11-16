<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { HelpRequestDto } from '@help/shared';
import BrandMark from '@/components/BrandMark.vue';
import TicketTrack from '@/components/TicketTrack.vue';
import { useAuth } from '@/stores/auth';

const auth = useAuth();
const router = useRouter();
const route = useRoute();

const email = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

const DEMO_PASSWORD = 'password123';
const demoUsers = [
  { email: 'consultant@demo.test', name: 'Priya Sharma', role: 'Consultant' },
  { email: 'asha@demo.test', name: 'Asha Verma', role: 'Client' },
  { email: 'ben@demo.test', name: 'Ben Carter', role: 'Client' },
  { email: 'chen@demo.test', name: 'Chen Li', role: 'Client' },
];

// Illustration only: what a request's track looks like once it has been handled end to end.
const example: HelpRequestDto = {
  id: 'a3f20000-0000-0000-0000-000000000000',
  title: "Invoice template won't save",
  description: '',
  status: 'RESOLVED',
  createdAt: '',
  updatedAt: '',
  client: { id: 'c', name: 'Asha Verma' },
  consultant: { id: 'p', name: 'Priya Sharma' },
  activeCallId: null,
  lastCallId: null,
  latestCall: { status: 'ENDED', processingStatus: 'READY' },
};

async function submit(e = email.value, p = password.value) {
  error.value = '';
  busy.value = true;
  try {
    await auth.login(e, p);
    const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/';
    await router.replace(next);
  } catch (err) {
    error.value = (err as Error).message || 'Login failed';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-dvh flex-col lg:flex-row">
    <aside class="flex flex-col justify-between gap-10 bg-brand-950 px-6 py-8 text-white sm:px-10 lg:w-[46%] lg:px-14 lg:py-12">
      <div class="flex items-center gap-2.5 font-semibold tracking-tight">
        <BrandMark class="h-8 w-8" />
        Client Help Portal
      </div>
      <div class="max-w-md">
        <h1 class="text-3xl leading-tight font-semibold tracking-tight text-balance lg:text-4xl">Stuck in the software? Show your consultant.</h1>
        <p class="mt-4 text-base leading-relaxed text-brand-100/85">
          Raise a request, share your screen on a call, and both of you get the recording, a transcript and a summary afterwards.
        </p>
      </div>
      <div class="max-w-md space-y-8">
      <figure class="hidden lg:block">
        <div class="rounded-[10px] bg-white p-5 text-slate-900 shadow-[0_20px_40px_-20px_rgb(0_0_0/0.6)]">
          <div class="flex items-start gap-3">
            <span class="ticket-ref mt-0.5">#A3F2</span>
            <div class="min-w-0 flex-1">
              <p class="font-semibold">{{ example.title }}</p>
              <p class="mt-1 flex gap-3 text-xs">
                <span class="font-medium text-slate-700">Asha Verma</span>
                <span class="text-slate-500">Priya Sharma</span>
              </p>
              <TicketTrack :request="example" class="mt-3.5" />
            </div>
          </div>
        </div>
        <figcaption class="mt-3 text-sm text-brand-100/70">An example request, tracked from raised to resolved.</figcaption>
      </figure>
      <p class="text-xs text-brand-100/60">Built for HighLevel by Aditya Raj</p>
      </div>
    </aside>

    <section class="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
      <div class="w-full max-w-sm">
        <h2 class="text-xl font-semibold tracking-tight">Sign in</h2>
        <p class="mt-1 text-sm text-slate-600">Pick a demo user. Everyone's password is password123.</p>

        <div class="mt-5 grid grid-cols-2 gap-2">
          <button
            v-for="u in demoUsers"
            :key="u.email"
            class="rounded-md border border-slate-300 bg-white px-3 py-2.5 text-left transition-[border-color,background-color,transform] duration-150 hover:border-brand-400 hover:bg-brand-50/60 active:scale-[0.97] disabled:opacity-50"
            :disabled="busy"
            :data-testid="`login-${u.email}`"
            @click="submit(u.email, DEMO_PASSWORD)"
          >
            <div class="text-sm font-semibold text-slate-900">{{ u.name }}</div>
            <div class="text-xs" :class="u.role === 'Consultant' ? 'font-medium text-brand-700' : 'text-slate-600'">{{ u.role }}</div>
          </button>
        </div>

        <div class="my-6 flex items-center gap-3 text-xs text-slate-500">
          <div class="h-px flex-1 bg-slate-200" />
          or with email
          <div class="h-px flex-1 bg-slate-200" />
        </div>

        <form class="space-y-4" @submit.prevent="submit()">
          <div>
            <label class="label" for="email">Email</label>
            <input id="email" v-model="email" class="input" type="email" autocomplete="username" required />
          </div>
          <div>
            <label class="label" for="password">Password</label>
            <input id="password" v-model="password" class="input" type="password" autocomplete="current-password" required />
          </div>
          <p v-if="error" class="text-sm text-red-800">{{ error }}</p>
          <button class="btn-primary w-full" :disabled="busy">{{ busy ? 'Signing in…' : 'Sign in' }}</button>
        </form>

        <p class="mt-6 text-xs leading-relaxed text-slate-600">
          To try a call, open a second window (or an incognito window) and sign in as another user. Each tab keeps its own session.
        </p>
      </div>
    </section>
  </div>
</template>
