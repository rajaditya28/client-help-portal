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
    baseURL: 'http://localhost:3000',
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
  webServer: {
    command: 'node dist/main.js',
    cwd: 'apps/api',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: true,
    timeout: 60_000,
    env: { JOB_POLL_INTERVAL_MS: '300' },
  },
});
