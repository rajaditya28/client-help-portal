<script setup lang="ts">
import { useRouter } from 'vue-router';
import { initials } from '@/lib/format';
import { useAuth } from '@/stores/auth';

const auth = useAuth();
const router = useRouter();

function logout() {
  auth.logout();
  void router.push({ name: 'login' });
}
</script>

<template>
  <header class="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
    <div class="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
      <RouterLink to="/" class="flex items-center gap-2 font-semibold text-slate-900">
        <span class="grid h-7 w-7 place-items-center rounded-lg bg-indigo-600 text-white">
          <svg viewBox="0 0 24 24" class="h-4 w-4" fill="currentColor"><path d="M4 5h16v11H9l-5 4z" /></svg>
        </span>
        Help Portal
      </RouterLink>
      <nav class="flex items-center gap-1 text-sm">
        <RouterLink to="/" class="btn-ghost" exact-active-class="bg-slate-100 text-slate-900">Dashboard</RouterLink>
        <RouterLink to="/history" class="btn-ghost" active-class="bg-slate-100 text-slate-900">Call history</RouterLink>
        <RouterLink v-if="auth.isConsultant" to="/ops" class="btn-ghost" active-class="bg-slate-100 text-slate-900">Ops</RouterLink>
      </nav>
      <div class="ml-auto flex items-center gap-3">
        <div class="hidden text-right sm:block">
          <div class="text-sm font-medium leading-tight">{{ auth.user?.name }}</div>
          <div class="text-xs leading-tight text-slate-500">{{ auth.isConsultant ? 'Consultant' : 'Client' }}</div>
        </div>
        <span
          class="grid h-8 w-8 place-items-center rounded-full text-xs font-semibold text-white"
          :class="auth.isConsultant ? 'bg-indigo-600' : 'bg-emerald-600'"
          >{{ initials(auth.user?.name ?? '') }}</span
        >
        <button class="btn-ghost" @click="logout">Log out</button>
      </div>
    </div>
  </header>
</template>
