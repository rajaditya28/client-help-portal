import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { UserDto } from '@help/shared';
import { api, loadSession, saveSession } from '@/lib/api';
import { disconnectSocket } from '@/lib/socket';

export const useAuth = defineStore('auth', () => {
  const session = ref(loadSession());

  const user = computed<UserDto | null>(() => session.value?.user ?? null);
  const isConsultant = computed(() => user.value?.role === 'CONSULTANT');

  async function login(email: string, password: string) {
    const res = await api.login(email, password);
    session.value = { token: res.accessToken, user: res.user };
    saveSession(session.value);
  }

  function logout() {
    session.value = null;
    saveSession(null);
    disconnectSocket();
  }

  return { user, isConsultant, login, logout };
});
