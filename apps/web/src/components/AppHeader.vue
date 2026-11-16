<script setup lang="ts">
import { useRouter } from 'vue-router';
import { initials } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import BrandMark from './BrandMark.vue';

const auth = useAuth();
const router = useRouter();

function logout() {
  auth.logout();
  void router.push({ name: 'login' });
}

const link =
  'whitespace-nowrap rounded-md px-2 py-1.5 text-sm font-medium text-brand-100/80 transition-colors duration-150 hover:bg-white/5 hover:text-white sm:px-3';
const active = '!bg-white/10 !text-white';
</script>

<template>
  <header class="sticky top-0 z-20 bg-brand-950 text-white shadow-[0_1px_0_rgb(255_255_255/0.06),0_4px_16px_-8px_rgb(8_39_37/0.5)]">
    <div class="mx-auto flex h-14 max-w-6xl items-center gap-2 px-3 sm:gap-6 sm:px-4">
      <RouterLink to="/" class="flex items-center gap-2 font-semibold tracking-tight" aria-label="Help Portal home">
        <BrandMark class="h-7 w-7" />
        <span class="hidden sm:inline">Help Portal</span>
      </RouterLink>
      <nav class="flex items-center gap-0.5 sm:gap-1" aria-label="Main">
        <RouterLink to="/" :class="link" :exact-active-class="active">Dashboard</RouterLink>
        <RouterLink to="/history" :class="link" :active-class="active">Call history</RouterLink>
        <RouterLink v-if="auth.isConsultant" to="/ops" :class="link" :active-class="active">Ops</RouterLink>
      </nav>
      <div class="ml-auto flex items-center gap-2 sm:gap-3">
        <div class="hidden text-right md:block">
          <div class="text-sm font-medium leading-tight">{{ auth.user?.name }}</div>
          <div class="text-xs leading-tight text-brand-200">{{ auth.isConsultant ? 'Consultant' : 'Client' }}</div>
        </div>
        <span class="hidden h-8 w-8 place-items-center rounded-full bg-brand-200 sm:grid text-xs font-semibold text-brand-950" aria-hidden="true">
          {{ initials(auth.user?.name ?? '') }}
        </span>
        <button
          class="whitespace-nowrap rounded-md px-2 py-1.5 text-sm font-medium text-brand-100/80 transition-colors duration-150 hover:bg-white/5 hover:text-white active:scale-[0.97]"
          @click="logout"
        >
          Log out
        </button>
      </div>
    </div>
  </header>
</template>
