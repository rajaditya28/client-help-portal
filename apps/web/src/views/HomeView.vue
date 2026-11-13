<script setup lang="ts">
import ClientDashboard from '@/components/ClientDashboard.vue';
import ConsultantDashboard from '@/components/ConsultantDashboard.vue';
import { useAuth } from '@/stores/auth';

const auth = useAuth();
</script>

<template>
  <ConsultantDashboard v-if="auth.isConsultant" />
  <ClientDashboard v-else />
</template>
