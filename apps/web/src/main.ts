import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { setUnauthorizedHandler } from './lib/api';
import { router } from './router';
import { useAuth } from './stores/auth';
import './style.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);

// Expired or invalid token: drop the session and go to login.
setUnauthorizedHandler(() => {
  useAuth().logout();
  void router.push({ name: 'login' });
});

app.mount('#app');
