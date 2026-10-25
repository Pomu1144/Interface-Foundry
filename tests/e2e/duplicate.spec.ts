import { expect, test, type Page } from '@playwright/test';

/** "Duplicate into": the right-click menu opens the current view on another device. */

const state = <T,>(page: Page, fn: string) => page.evaluate((f) => new Function('s', `return ${f}`)((window as unknown as { __IFDY__: { useStudio: { getState(): unknown } } }).__IFDY__.useStudio.getState()) as T, fn);

async function scrollRatio(page: Page, instanceId: string) {
  for (const f of page.frames()) {
    const el = await f.frameElement().catch(() => null);
    if (el && (await el.getAttribute('data-instance')) === instanceId) return f.evaluate(() => Math.round((scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight)) * 100) / 100);
  }
  return null;
}

test('duplicate the current view onto other devices from the right-click menu', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Open the Harborline demo/ }).click();
  const primary = page.frameLocator('iframe[data-instance="primary"]');
  await expect(primary.locator('[data-testid="login-submit"]')).toBeVisible();

  await expect.poll(() => state<string>(page, 's.instances.primary?.status')).toBe('ready');

  // The view to copy: an edit and a scroll position.
  await primary.locator('[data-testid="login-submit"]').click();
  await expect.poll(() => state<string>(page, "s.selection.info?.selector ?? ''")).toContain('login-submit');
  await page.getByRole('toolbar', { name: 'Selection' }).getByRole('button', { name: 'Hide in preview' }).click();
  await expect.poll(() => state<number>(page, 's.changes.length')).toBe(1);
  await page.frame({ url: /\/demo\// })!.evaluate(() => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.5));

  // Right-click inside the page (Inspect mode) opens the canvas menu at the cursor.
  const box = (await page.locator('iframe[data-instance="primary"]').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3, { button: 'right' });
  await page.getByRole('menuitem', { name: /Duplicate into/ }).hover();
  await page.getByRole('menuitem', { name: /^iPhone 16 Pro\b(?! Max)/ }).click();

  await expect.poll(() => state<number>(page, 's.duplicates.length')).toBe(1);
  const id = await state<string>(page, "'dup-' + s.duplicates[0].id");
  await expect(page.frameLocator(`iframe[data-instance="${id}"]`).locator('[data-testid="login-username"]')).toBeAttached();
  await expect(page.locator(`iframe[data-instance="${id}"]`)).toHaveAttribute('style', /width: 402px/);
  await expect.poll(() => state<string>(page, `s.instances['${id}']?.status`)).toBe('ready');
  // Same edits (the hidden button) and the same scroll position.
  const overrides = async () => {
    for (const f of page.frames()) {
      const el = await f.frameElement().catch(() => null);
      if (el && (await el.getAttribute('data-instance')) === id) return f.evaluate(() => document.getElementById('__ifdy-overrides')?.textContent ?? '');
    }
    return '';
  };
  await expect.poll(overrides).toMatch(/login-submit[^{]*\{\s*display: none/);
  await expect.poll(() => scrollRatio(page, id)).toBe(0.5);

  // Right-click on the canvas itself: duplicate into an unfolded foldable, then remove it.
  const canvas = (await page.locator('[data-ifdy-canvas]').boundingBox())!;
  await page.mouse.click(canvas.x + 30, canvas.y + canvas.height - 120, { button: 'right' });
  await page.getByRole('menuitem', { name: /Duplicate into/ }).hover();
  await page.getByRole('menuitem', { name: /Galaxy Z Fold 5.*Unfolded/ }).click();
  await expect.poll(() => state<string>(page, "s.duplicates.map((d) => d.deviceId + ':' + d.posture).join(',')")).toBe('iphone-16-pro:folded,galaxy-z-fold-5:expanded');
  await page.getByRole('button', { name: 'Remove the Galaxy Z Fold 5 duplicate' }).click();
  await expect.poll(() => state<number>(page, 's.duplicates.length')).toBe(1);
});
