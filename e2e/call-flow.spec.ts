import { expect, test, type Page } from '@playwright/test';

async function loginAs(page: Page, email: string) {
  await page.goto('/login');
  await page.getByTestId(`login-${email}`).click();
  await expect(page).toHaveURL(/\/$/);
}

async function uploadedChunks(page: Page): Promise<number> {
  const text = (await page.getByTestId('recording-status').textContent()) ?? '';
  return Number(text.match(/(\d+) chunks? uploaded/)?.[1] ?? 0);
}

test('request → live call with screen share → consented recording → refresh & rejoin → transcript + summary in history', async ({
  browser,
}) => {
  // Two isolated browser contexts = two users side by side, like two windows in the demo.
  const consultantCtx = await browser.newContext();
  const clientCtx = await browser.newContext();
  const consultant = await consultantCtx.newPage();
  const client = await clientCtx.newPage();
  for (const p of [consultant, client]) p.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

  await loginAs(consultant, 'consultant@demo.test');
  await loginAs(client, 'asha@demo.test');

  // 1. Client raises a request; it appears on the consultant's dashboard with no reload.
  const title = `E2E help ${Date.now()}`;
  await client.getByTestId('request-title').fill(title);
  await client.getByTestId('submit-request').click();
  const row = consultant.getByTestId('open-requests').locator('li', { hasText: title });
  await expect(row).toBeVisible();

  // 2. Consultant starts the call and joins.
  await row.getByRole('button', { name: 'Start call' }).click();
  await expect(consultant).toHaveURL(/\/call\//);
  await consultant.getByTestId('join').click();

  // 3. Client gets the incoming call, joins, is asked for consent, allows, shares screen.
  await client.getByTestId('join-call').click();
  await client.getByTestId('join').click();
  await expect(client.getByTestId('consent-dialog')).toBeVisible();
  await client.getByTestId('consent-allow').click();
  await client.getByTestId('share-screen').click();

  await expect(consultant.getByTestId('peer-state')).toContainText('Connected');
  await expect(client.getByTestId('peer-state')).toContainText('Connected');

  // 4. Recording uploads while the call is running.
  await expect.poll(() => uploadedChunks(consultant), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

  // Stopping the share must clear the consultant's view (not freeze on the last frame).
  await expect(consultant.getByTestId('no-screen')).toHaveCount(0);
  await client.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(consultant.getByTestId('no-screen')).toBeVisible();
  await client.getByTestId('share-screen').click();
  await expect(consultant.getByTestId('no-screen')).toHaveCount(0);

  // 5. Stretch: the client refreshes mid-call and rejoins; recording continues in a new segment.
  await client.reload();
  await client.getByTestId('join').click();
  await expect(client.getByTestId('consent-dialog')).toHaveCount(0); // consent is remembered
  await client.getByTestId('share-screen').click();
  await expect(consultant.getByTestId('peer-state')).toContainText('Connected');
  const before = await uploadedChunks(consultant);
  await expect.poll(() => uploadedChunks(consultant), { timeout: 30_000 }).toBeGreaterThanOrEqual(before + 2);

  // 6. Consultant ends the call; both land on the call's history page.
  await consultant.getByTestId('end-call').click();
  await expect(consultant).toHaveURL(/\/history\//, { timeout: 30_000 });
  await expect(client).toHaveURL(/\/history\//, { timeout: 30_000 });

  // 7. Background pipeline finishes: recording, transcript and summary in the client's history.
  await expect(client.getByTestId('summary')).toBeVisible({ timeout: 90_000 });
  await expect(client.getByTestId('transcript').locator('li').first()).toBeVisible();
  const player = client.getByTestId('recording-player');
  await expect(player).toBeVisible();

  // The finalized file must be seekable with a real duration (the ffmpeg remux step).
  const duration = await player.evaluate(async (v: HTMLVideoElement) => {
    if (!Number.isFinite(v.duration) || v.readyState < 1) {
      await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
    }
    return v.duration;
  });
  console.log(`recording duration: ${duration.toFixed(1)}s`);
  expect(Number.isFinite(duration)).toBe(true);
  expect(duration).toBeGreaterThan(8);

  // 8. Stretch: clicking a transcript line seeks the recording.
  const lines = client.getByTestId('transcript').locator('li button');
  const target = lines.nth((await lines.count()) - 1);
  await target.click();
  await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(1);
  // ...and the line being played is the one highlighted.
  await expect(client.getByTestId('transcript').locator('li[data-active="true"]')).toHaveCount(1);
  await expect(client.getByTestId('transcript').locator('li').last()).toHaveAttribute('data-active', 'true');

  // 9. The call is in the consultant's history too.
  await consultant.goto('/history');
  await expect(consultant.locator('td', { hasText: title })).toBeVisible();

  // 10. The request on the client's dashboard links straight to this call's page.
  const callUrl = client.url();
  await client.screenshot({ path: 'e2e/artifacts/client-history.png', fullPage: true });
  await client.goto('/');
  await client.locator('li', { hasText: title }).getByRole('link', { name: 'View call' }).click();
  await expect(client).toHaveURL(callUrl);
  await expect(client.getByTestId('summary')).toBeVisible();
  await consultantCtx.close();
  await clientCtx.close();
});
