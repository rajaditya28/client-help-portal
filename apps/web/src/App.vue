<script setup lang="ts">
import { useRoute } from 'vue-router';
import AppHeader from './components/AppHeader.vue';
import { useAuth } from './stores/auth';

const auth = useAuth();
const route = useRoute();
</script>

<template>
  <div class="flex min-h-full flex-col">
    <AppHeader v-if="auth.user && route.name !== 'login'" />
    <main class="flex-1">
      <RouterView />
    </main>
  </div>
</template>
