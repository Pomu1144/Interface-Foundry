import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 1 milestone: load a real page, select an element, inspect CSS, modify a
 * property reversibly, and watch the page adapt between folded and expanded.
 */

async function openDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Open the Harborline demo/ }).click();
  const frame = page.frameLocator('iframe[data-instance="primary"]');
  await expect(frame.locator('[data-testid="login-submit"]')).toBeVisible();
  await expect(page.getByText(/Running\s+Harborline Mortgage on Surface Duo/)).toBeVisible();
  return frame;
}

const overflow = (page: Page) =>
  page.frame({ url: /\/demo\// })!.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test('inspect, fix and undo the folded overflow defect', async ({ page }) => {
  const frame = await openDemo(page);
  await expect.poll(() => overflow(page)).toBeGreaterThan(0); // D1: .rate-banner is 560px wide at 540px

  // Clicking on the canvas selects the deepest element (Inspect mode is the default)...
  await frame.locator('.rate-banner').click({ position: { x: 20, y: 10 } });
  await expect(page.locator('[role="tab"][aria-selected="true"]', { hasText: 'Design' })).toBeVisible();
  // ...and the command palette finds elements by selector, text or accessible name.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByPlaceholder(/Search actions/).fill('.rate-banner');
  await page.getByRole('option', { name: /aside\.rate-banner/ }).first().click();
  await expect(page.getByText('RateBanner').first()).toBeVisible();

  // Styles tab shows the authored rule with its fixed width.
  await page.getByRole('tab', { name: 'Styles', exact: true }).click();
  await expect(page.getByText('560px').first()).toBeVisible();

  // Fix it from the Design tab: W = 100% (element override, undoable).
  await page.getByRole('tab', { name: 'Design', exact: true }).click();
  const width = page.locator('label', { has: page.locator('span', { hasText: /^W$/ }) }).locator('input').first();
  await width.click();
  await width.fill('100%');
  await width.press('Enter');
  await expect.poll(() => overflow(page)).toBeLessThanOrEqual(0);
  await expect(page.getByText('1 edit')).toBeVisible();

  // Undo / redo round-trip through the change history.
  await page.locator('body').click({ position: { x: 5, y: 1040 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => overflow(page)).toBeGreaterThan(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => overflow(page)).toBeLessThanOrEqual(0);

  // The change is recorded with its viewport context.
  await page.getByRole('tab', { name: /Changes/ }).click();
  await expect(page.getByText(/width .* → 100%/)).toBeVisible();
  await expect(page.getByText(/Surface Duo · 540×720/).first()).toBeVisible();
});

test('unfolding reflows the real page and preserves form state', async ({ page }) => {
  const frame = await openDemo(page);
  await page.getByRole('radio', { name: /Interact/ }).click();
  const username = frame.locator('[data-testid="login-username"]');
  await username.click();
  await username.fill('demo.borrower');

  const iframe = page.locator('iframe[data-instance="primary"]');
  await expect(iframe).toHaveAttribute('style', /width: 540px/);
  await page.getByRole('radio', { name: 'Expanded' }).click();
  await expect(iframe).toHaveAttribute('style', /width: 1114px/, { timeout: 8000 });
  await expect.poll(() => page.frame({ url: /\/demo\// })!.evaluate(() => window.innerWidth)).toBe(1114);
  // Same document: typed value survives the posture change, no re-render of the form.
  await expect(username).toHaveValue('demo.borrower');

  // Fold back with the dock scrubber reset.
  await page.getByRole('radio', { name: 'Folded' }).click();
  await expect(iframe).toHaveAttribute('style', /width: 540px/, { timeout: 8000 });
  await expect(username).toHaveValue('demo.borrower');
});

test('project state persists across a reload', async ({ page }) => {
  const frame = await openDemo(page);
  await frame.locator('[data-testid="login-submit"]').click();
  await page.getByRole('button', { name: 'Hide in preview' }).first().click();
  await expect(page.getByText(/\d+ edits?/)).toBeVisible();
  await expect(page.locator('[data-status="saved"]')).toBeVisible({ timeout: 5000 });
  await page.reload();
  await page.getByText('Recent projects').waitFor();
  await page.getByRole('button', { name: /^Harborline Mortgage \d/ }).click();
  await expect(page.locator('iframe[data-instance="primary"]')).toBeVisible();
  await expect(page.getByText(/Restored “Harborline Mortgage”/)).toBeVisible();
  // The saved edit is re-applied to the freshly loaded preview.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __IFDY__: { useStudio: { getState(): { changes: unknown[] } } } }).__IFDY__.useStudio.getState().changes.length)).toBeGreaterThan(0);
  await expect.poll(() => page.frame({ url: /\/demo\// })?.evaluate(() => document.getElementById('__ifdy-overrides')?.textContent ?? '')).toContain('display: none');
});
