import { defineConfig } from '@playwright/test';

/**
 * Browser end-to-end test of the full product: two real Chromium sessions (consultant + client)
 * with fake mic/camera/screen devices, real WebRTC, real MediaRecorder uploads, the real
 * background pipeline (ffmpeg + mock or real AI providers), and the history page.
 *
 * Runs against the production build served by the API: `npm run build && npm run e2e`.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    // BASE_URL points the suite at an already-running instance (e.g. a staging build or the live demo).
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream', // auto-accept mic + screen pickers
        '--use-fake-device-for-media-stream', // synthetic mic tone + video frames
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
    command: 'node dist/main.js',
    cwd: 'apps/api',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: true,
    timeout: 60_000,
    // Mock AI unless REAL_AI=1, even if apps/api/.env holds real keys (empty env vars win over .env).
    env: {
      JOB_POLL_INTERVAL_MS: '300',
      ...(process.env.REAL_AI ? {} : { DEEPGRAM_API_KEY: '', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '' }),
    },
  },
});
