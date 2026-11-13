import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { join } from 'node:path';

/**
 * Same flow as call-flow.spec.ts, but with real speech and the real AI providers.
 * Each participant runs in its own browser with its own synthetic voice as the microphone,
 * like two people on two machines, so speaker attribution is tested for real.
 *
 * Opt-in (spends provider credits): REAL_AI=1 npx playwright test real-ai
 * Needs DEEPGRAM_API_KEY and an LLM key in the API's environment.
 */
test.skip(!process.env.REAL_AI, 'set REAL_AI=1 to run against real STT/LLM providers');

const FIXTURES = join(__dirname, 'fixtures');

function launchWithVoice(wav: string): Promise<Browser> {
  return chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${join(FIXTURES, wav)}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
}

async function loginAs(page: Page, email: string) {
  await page.goto('/login');
  await page.getByTestId(`login-${email}`).click();
  await expect(page).toHaveURL(/\/$/);
}

test('real speech -> Deepgram transcript with speaker labels -> LLM summary', async ({ baseURL }) => {
  test.setTimeout(300_000);
  const consultantBrowser = await launchWithVoice('consultant-voice.wav');
  const clientBrowser = await launchWithVoice('client-voice.wav');
  const consultant = await (await consultantBrowser.newContext({ baseURL })).newPage();
  const client = await (await clientBrowser.newContext({ baseURL })).newPage();

  await loginAs(consultant, 'consultant@demo.test');
  await loginAs(client, 'asha@demo.test');

  const title = `Invoice template won't save ${Date.now()}`;
  await client.getByTestId('request-title').fill(title);
  await client.getByTestId('submit-request').click();
  const row = consultant.getByTestId('open-requests').locator('li', { hasText: title });
  await row.getByRole('button', { name: 'Start call' }).click();
  await consultant.getByTestId('join').click();

  await client.getByTestId('join-call').click();
  await client.getByTestId('join').click();
  await client.getByTestId('consent-allow').click();
  await client.getByTestId('share-screen').click();
  await expect(consultant.getByTestId('recording-status')).toContainText('uploaded', { timeout: 30_000 });

  // Let the full 34 s conversation play into the recording.
  await consultant.waitForTimeout(36_000);
  await consultant.getByTestId('end-call').click();
  await expect(client).toHaveURL(/\/history\//, { timeout: 30_000 });

  await expect(client.getByTestId('summary')).toBeVisible({ timeout: 180_000 });
  const lines = await client.getByTestId('transcript').locator('li').allInnerTexts();
  const summary = await client.getByTestId('summary').innerText();
  console.log('--- TRANSCRIPT ---\n' + lines.join('\n'));
  console.log('--- SUMMARY ---\n' + summary);

  expect(lines.join(' ').toLowerCase()).toContain('logo');
  expect(lines.some((l) => l.includes('(client)'))).toBe(true);
  expect(lines.some((l) => l.includes('(consultant)'))).toBe(true);
  expect(summary).not.toContain('[mock');

  await client.screenshot({ path: 'e2e/artifacts/real-ai-history.png', fullPage: true });
  await consultantBrowser.close();
  await clientBrowser.close();
});
