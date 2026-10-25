import { expect, test, type Page } from '@playwright/test';

/**
 * WebKit engine: the Harborline demo rendered by the companion's WebKit,
 * streamed into the primary board, inspectable through the injected agent, and
 * unfolded (Surface Duo) in place without reloading.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store = <T,>(page: Page, pick: (s: any) => T) =>
  // Undefined while the studio (re)loads, so polls retry instead of failing.
  page.evaluate(`window.__IFDY__ ? (${pick.toString()})(window.__IFDY__.useStudio.getState()) : undefined`) as Promise<T>;

/** Distinct sampled colours on the streamed canvas (1 = blank). */
const canvasColours = (page: Page) =>
  page.locator('canvas[data-instance="primary"]').evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d');
    if (!ctx || c.width < 50) return 0;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 97) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return seen.size;
  });

test('WebKit engine: streams the demo, inspects it and unfolds in place', async ({ page }) => {
  test.setTimeout(120_000);
  // Agent hellos and page loads streamed from the companion, per remote page.
  const received: string[] = [];
  page.on('websocket', (ws) => {
    if (ws.url().includes('/api/ws/browser')) ws.on('framereceived', (f) => typeof f.payload === 'string' && received.push(f.payload));
  });
  const hellos = () => received.filter((m) => m.includes('"t":"agent"') && m.includes('"event":"hello"')).length;
  const loads = () => received.filter((m) => m.includes('"t":"status"') && m.includes('"status":"loading"')).length;

  await page.goto('/');
  await page.getByRole('button', { name: /Open the Harborline demo/ }).click();
  await expect(page.frameLocator('iframe[data-instance="primary"]').locator('[data-testid="login-submit"]')).toBeVisible();
  // Switch the primary board to WebKit with the engine chip on its label.
  await page.locator('[data-board="primary"] button[data-engine]').click();
  await page.getByRole('menuitem', { name: /^WebKit/ }).click();
  await expect.poll(() => store(page, (s) => s.viewport.engine)).toBe('webkit');
  // The companion socket opens for the first remote board; its hello lists the engines.
  await expect.poll(() => store(page, (s) => Boolean(s.server.engines?.length)), { timeout: 30_000 }).toBe(true);
  const webkit = await store(page, (s) => s.server.engines.find((e: { id: string }) => e.id === 'webkit') ?? null);
  test.skip(!webkit?.available, `WebKit unavailable: ${webkit?.detail ?? 'not reported by the companion'}`);
  expect(webkit.label).toMatch(/^WebKit \d+/);
  expect(webkit.detail).toMatch(/not iOS Safari/);
  await expect(page.locator('canvas[data-instance="primary"]')).toBeAttached();
  await expect
    .poll(() => store(page, (s) => ({ status: s.instances.primary?.status, engine: s.instances.primary?.engine })), { timeout: 45_000 })
    .toEqual({ status: 'ready', engine: 'remote' });
  expect(await store(page, (s) => s.instances.primary.url)).toMatch(/\/demo\/index\.html#\/login$/);

  // A streamed WebKit frame is drawn on the canvas (backing store at the 540px viewport, not blank).
  const canvas = page.locator('canvas[data-instance="primary"]');
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width), { timeout: 20_000 }).toBeGreaterThanOrEqual(540);
  await expect.poll(() => canvasColours(page), { timeout: 20_000 }).toBeGreaterThan(4);
  // The agent runs once per document even though the preview host also injects it into the HTML.
  await expect.poll(hellos).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  expect(hellos()).toBe(1);

  // Inspect: click an element on the streamed canvas -> the agent selects it in WebKit.
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.3);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.32);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.32);
  await expect.poll(() => store(page, (s) => s.selection.info?.selector ?? null)).toBeTruthy();
  const inspector = page.getByTestId('right');
  const tag = await store(page, (s) => s.selection.info.tag as string);
  await expect(inspector.getByText(new RegExp(`^${tag}`)).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Computed', exact: true }).click();
  await expect(inspector.getByText(/^display/).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Styles', exact: true }).click();
  await expect(inspector.getByText(/\{|element\.style|inline/i).first()).toBeVisible();

  // Unfold the Surface Duo: WebKit resizes the same page to 1114px, no reload.
  const hellosBefore = hellos();
  const loadsBefore = loads();
  await page.getByRole('radiogroup', { name: 'Posture' }).getByRole('radio', { name: 'Expanded' }).click();
  await expect.poll(() => store(page, (s) => s.viewport.posture)).toBe('expanded');
  // The agent inside WebKit reports the new innerWidth.
  await expect.poll(() => store(page, (s) => s.instances.primary?.viewport?.width), { timeout: 15_000 }).toBe(1114);
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width), { timeout: 15_000 }).toBeGreaterThanOrEqual(1114);
  await page.waitForTimeout(1000);
  expect(hellos()).toBe(hellosBefore);
  expect(loads()).toBe(loadsBefore);
  expect(received.some((m) => m.includes('"t":"emulated"') && m.includes('"width":1114') && m.includes('"displayFeature":"unsupported"'))).toBe(true);
});
