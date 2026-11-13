<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
  <div class="flex min-h-full items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-emerald-50 px-4 py-12">
    <div class="w-full max-w-md">
      <div class="mb-8 text-center">
        <span class="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/30">
          <svg viewBox="0 0 24 24" class="h-6 w-6" fill="currentColor"><path d="M4 5h16v11H9l-5 4z" /></svg>
        </span>
        <h1 class="text-2xl font-semibold tracking-tight">Client Help Portal</h1>
        <p class="mt-1 text-sm text-slate-500">Get help over a recorded screen-sharing call.</p>
      </div>

      <div class="card p-6">
        <p class="mb-3 text-sm font-medium text-slate-700">Sign in as a demo user</p>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="u in demoUsers"
            :key="u.email"
            class="rounded-lg border border-slate-200 px-3 py-2.5 text-left transition hover:border-indigo-300 hover:bg-indigo-50/50 disabled:opacity-50"
            :disabled="busy"
            :data-testid="`login-${u.email}`"
            @click="submit(u.email, DEMO_PASSWORD)"
          >
            <div class="text-sm font-medium">{{ u.name }}</div>
            <div class="text-xs" :class="u.role === 'Consultant' ? 'text-indigo-600' : 'text-emerald-600'">{{ u.role }}</div>
          </button>
        </div>

        <div class="my-5 flex items-center gap-3 text-xs text-slate-400">
          <div class="h-px flex-1 bg-slate-200" />
          or with email
          <div class="h-px flex-1 bg-slate-200" />
        </div>

        <form class="space-y-3" @submit.prevent="submit()">
          <div>
            <label class="label" for="email">Email</label>
            <input id="email" v-model="email" class="input" type="email" autocomplete="username" required />
          </div>
          <div>
            <label class="label" for="password">Password</label>
            <input id="password" v-model="password" class="input" type="password" autocomplete="current-password" required />
          </div>
          <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
          <button class="btn-primary w-full" :disabled="busy">Sign in</button>
        </form>
      </div>

      <p class="mt-4 text-center text-xs text-slate-500">
        Tip: open a second window (or an incognito window) and sign in as another user. Each tab keeps its own session.
      </p>
    </div>
  </div>
</template>
