import { createRouter, createWebHistory } from 'vue-router';
import { useAuth } from './stores/auth';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
    { path: '/call/:id', name: 'call', component: () => import('./views/CallView.vue'), props: true },
    { path: '/history', name: 'history', component: () => import('./views/HistoryView.vue') },
    { path: '/history/:id', name: 'call-detail', component: () => import('./views/CallDetailView.vue'), props: true },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach((to) => {
  const auth = useAuth();
  if (!to.meta.public && !auth.user) return { name: 'login', query: { next: to.fullPath } };
  if (to.name === 'login' && auth.user) return { name: 'home' };
});
