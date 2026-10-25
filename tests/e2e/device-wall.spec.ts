import { expect, test, type Page } from '@playwright/test';

/**
 * Device wall + controlled Chromium: the demo on many devices with mirrored
 * scrolling, a public URL streamed from the companion's Chromium, and the
 * deterministic capture API.
 */

const WALL_TILES = [
  'wall-surface-duo-folded',
  'wall-surface-duo-expanded',
  'wall-galaxy-z-fold-5-folded',
  'wall-galaxy-z-fold-5-expanded',
  'wall-iphone-16-pro-folded',
  'wall-pixel-8-folded',
  'wall-ipad-mini-folded',
  'wall-laptop-13-folded',
];

async function frameFor(page: Page, instanceId: string) {
  for (const f of page.frames()) {
    const el = await f.frameElement().catch(() => null);
    if (el && (await el.getAttribute('data-instance')) === instanceId) return f;
  }
  return null;
}

test('device wall: demo on eight devices with mirrored scrolling', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Open the Harborline demo/ }).click();
  await expect(page.frameLocator('iframe[data-instance="primary"]').locator('[data-testid="login-submit"]')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Shift+w');

  for (const id of WALL_TILES) await expect(page.locator(`iframe[data-instance="${id}"]`)).toBeAttached();
  await expect(page.getByText(/8 devices · 8 live/)).toBeVisible({ timeout: 30_000 });

  // Scroll the iPhone tile; every other tile follows (by scroll ratio).
  const iphone = page.locator('iframe[data-instance="wall-iphone-16-pro-folded"]');
  const box = (await iphone.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 140);
  await expect
    .poll(async () => {
      const f = await frameFor(page, 'wall-pixel-8-folded');
      return f ? f.evaluate(() => scrollY) : 0;
    })
    .toBeGreaterThan(100);
});

test('controlled Chromium: public URL streams on the wall, and captures work', async ({ page, request }) => {
  const sent: string[] = [];
  page.on('websocket', (ws) => ws.on('framesent', (f) => sent.push(String(f.payload))));
  const status = await page.goto('/').then(async () => page.evaluate(async () => {
    const { token } = await (await fetch('/api/bootstrap')).json();
    return (await fetch('/api/browser/status', { headers: { 'x-ifdy-token': token } })).json();
  }));
  test.skip(!status.available, `Chromium unavailable: ${status.reason}`);

  await page.getByRole('textbox', { name: 'Website URL' }).fill('https://example.com');
  await page.keyboard.press('Enter');
  const canvas = page.locator('canvas[data-instance="wall-pixel-8-folded"]');
  await expect(canvas).toBeAttached({ timeout: 20_000 });
  // Frames arrive: the canvas backing store is resized to the streamed image.
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width), { timeout: 30_000 }).toBeGreaterThan(50);
  await expect(page.getByText(/viewport segments emulated|viewport segments not emulated/)).toBeVisible();

  // Interactive: a wheel over a remote tile is forwarded to Chromium as input.
  const b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => sent.some((m) => m.includes('"t":"input"') && m.includes('"kind":"wheel"'))).toBe(true);

  // Deterministic capture of the same URL at a foldable viewport.
  const token = await page.evaluate(async () => (await (await fetch('/api/bootstrap')).json()).token);
  const res = await request.post('/api/capture', {
    headers: { 'x-ifdy-token': token },
    data: { url: 'https://example.com/', viewport: { width: 1114, height: 720, dpr: 1, mobile: true, touch: true }, fold: { axis: 'vertical', offset: 540, maskLength: 34 } },
  });
  expect(res.ok()).toBe(true);
  const cap = await res.json();
  expect(cap.dataUrl).toMatch(/^data:image\/png;base64,/);
  expect(cap).toMatchObject({ width: 1114, height: 720 });
});
