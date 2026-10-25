import { readFile } from 'node:fs/promises';
import { expect, test, type Frame, type Page } from '@playwright/test';

/**
 * Final acceptance: the 15-step product workflow, end to end through the real
 * UI, on the synthetic Harborline mortgage demo. Each test.step maps 1:1 to a
 * step of the acceptance workflow. The store (window.__IFDY__) is only read for
 * assertions; every action is driven through the studio UI.
 */

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Read from the studio store (dev hook). `pick` must be self-contained: it is serialized into the page. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function store<T>(page: Page, pick: (s: any) => T): Promise<T> {
  return page.evaluate(`(${pick.toString()})(window.__IFDY__.useStudio.getState())`) as Promise<T>;
}

/** The canvas preview (the real demo page inside the device frame). */
async function primaryFrame(page: Page): Promise<Frame> {
  const handle = await page.locator('iframe[data-instance="primary"]').elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error('Primary preview frame is not attached');
  return frame;
}

/** Horizontal page overflow of the canvas page, in CSS px (> 0 means the page scrolls sideways). */
async function overflow(page: Page): Promise<number> {
  const f = await primaryFrame(page);
  return f.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Run a registered action from the command palette by its label. */
async function runCommand(page: Page, label: string) {
  // Shortcuts belong to the studio document, not the previewed page.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByPlaceholder(/Search actions/);
  await expect(input).toBeVisible();
  await input.fill(label);
  await page.getByRole('option', { name: new RegExp(`^${escapeRe(label)}`) }).first().click();
  await expect(input).toBeHidden();
}

async function download(page: Page, click: () => Promise<void>) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), text: await readFile(path, 'utf8') };
}

/* ------------------------------------------------------------------ */
/* The workflow                                                        */
/* ------------------------------------------------------------------ */

test.describe('IFDY acceptance workflow', () => {
  test('15-step acceptance workflow on the synthetic mortgage login', async ({ page }) => {
    test.setTimeout(300_000);
    const iframe = page.locator('iframe[data-instance="primary"]');
    const frame = page.frameLocator('iframe[data-instance="primary"]');
    const posture = page.getByRole('radiogroup', { name: 'Posture' });

    await test.step('1. Open the studio', async () => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: /Build interfaces against the real browser/ })).toBeVisible();
      await expect(page.getByText('Companion connected')).toBeVisible();
      await expect(page.getByRole('button', { name: /Open the Harborline demo/ })).toBeEnabled();
      expect(await store(page, (s) => s.project)).toBeNull();
    });

    await test.step('2. Load the authorized synthetic mortgage login', async () => {
      await page.getByRole('button', { name: /Open the Harborline demo/ }).click();
      await expect(frame.locator('[data-testid="login-submit"]')).toBeVisible();
      await expect(frame.getByLabel('Demo credentials')).toContainText('demo.borrower');
      await expect(frame.getByText(/fictional mortgage servicer/)).toBeAttached();
      const p = await store(page, (s) => ({ project: s.project, route: s.currentRoute, origin: s.server.previewOrigin, status: s.instances.primary?.status, url: s.instances.primary?.url }));
      console.log('[acceptance] project', JSON.stringify(p));
      expect(p.project).toMatchObject({ name: 'Harborline Mortgage', source: { kind: 'demo', label: expect.stringMatching(/synthetic/i) } });
      expect(p.route).toBe('#/login');
      expect(p.status).toBe('ready');
      // Served by the companion's authorised preview origin, not an arbitrary site.
      expect(p.origin).toBeTruthy();
      expect(p.url.startsWith(p.origin)).toBe(true);
      expect((await primaryFrame(page)).url()).toMatch(/#\/login$/);
    });

    await test.step('3. Inspect the actual page in the device simulator', async () => {
      await expect(page.getByText(/Running\s+Harborline Mortgage on Surface Duo/)).toBeVisible();
      await expect(iframe).toHaveAttribute('style', /width: 540px/);
      const f = await primaryFrame(page);
      // The real rendered document at the device viewport, not a screenshot.
      const page540 = await f.evaluate(() => ({ w: innerWidth, h: innerHeight, title: document.title, hasForm: Boolean(document.querySelector('form [data-testid="login-username"]')) }));
      expect(page540).toMatchObject({ w: 540, h: 720, hasForm: true });
      expect(page540.title).toMatch(/Harborline/);
      const vp = await store(page, (s) => s.viewport);
      expect(vp).toMatchObject({ deviceId: 'surface-duo', posture: 'folded' });
      // Hovering the page in Inspect mode outlines the real element with its measured size.
      const dims = await f.evaluate(() => {
        const b = document.querySelector('[data-testid="login-submit"]')!.getBoundingClientRect();
        return `${Math.round(b.width)}×${Math.round(b.height)}`;
      });
      await frame.locator('[data-testid="login-submit"]').hover({ position: { x: 12, y: 24 } });
      await expect(page.getByText(dims, { exact: true })).toBeVisible();
      await expect(page.getByText(/^button/).filter({ visible: true }).first()).toBeVisible();
    });

    await test.step('4. Switch between compact and expanded viewports', async () => {
      await expect.poll(() => overflow(page)).toBeGreaterThan(0); // D1 manifests when compact
      await posture.getByRole('radio', { name: 'Expanded' }).click();
      await expect(iframe).toHaveAttribute('style', /width: 1114px/, { timeout: 8000 });
      await expect.poll(async () => (await primaryFrame(page)).evaluate(() => innerWidth)).toBe(1114);
      await expect.poll(() => store(page, (s) => s.viewport.posture)).toBe('expanded');
      await expect.poll(() => overflow(page)).toBeLessThanOrEqual(0); // ...and not when expanded

      await posture.getByRole('radio', { name: 'Folded' }).click();
      await expect(iframe).toHaveAttribute('style', /width: 540px/, { timeout: 8000 });
      await expect.poll(async () => (await primaryFrame(page)).evaluate(() => innerWidth)).toBe(540);
      await expect.poll(() => store(page, (s) => s.viewport.posture)).toBe('folded');
      await expect.poll(() => overflow(page)).toBeGreaterThan(0);
    });

    await test.step('5. Animate the device transition', async () => {
      // Sample the store progress and the iframe layout width every frame, and the
      // page's own innerWidth on every resize, while the unfold animation plays.
      await page.evaluate(() => {
        const w = window as unknown as { __IFDY__: { useStudio: { getState(): { transition: { progress: number; playing: boolean } } } }; __samples: unknown[]; __sampling: boolean };
        const el = document.querySelector('iframe[data-instance="primary"]') as HTMLIFrameElement;
        w.__samples = [];
        w.__sampling = true;
        const tick = () => {
          const t = w.__IFDY__.useStudio.getState().transition;
          w.__samples.push({ p: t.progress, playing: t.playing, w: el.offsetWidth });
          if (w.__sampling) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const f = await primaryFrame(page);
      await f.evaluate(() => {
        const w = window as unknown as { __widths: number[] };
        w.__widths = [];
        addEventListener('resize', () => w.__widths.push(innerWidth));
      });
      await page.getByTestId('fold-dock').getByRole('button', { name: 'Play unfold' }).click();
      await expect.poll(() => store(page, (s) => s.transition.playing)).toBe(true);
      await expect.poll(() => store(page, (s) => ({ playing: s.transition.playing, posture: s.viewport.posture, p: s.transition.progress }))).toEqual({ playing: false, posture: 'expanded', p: 1 });
      const samples = await page.evaluate(() => {
        const w = window as unknown as { __samples: { p: number; playing: boolean; w: number }[]; __sampling: boolean };
        w.__sampling = false;
        return w.__samples;
      });
      const widths = await f.evaluate(() => (window as unknown as { __widths: number[] }).__widths);
      const mid = samples.filter((x) => x.p > 0.05 && x.p < 0.95);
      console.log(`[acceptance] transition: ${samples.length} frames, ${mid.length} intermediate, iframe widths ${[...new Set(samples.map((x) => x.w))].slice(0, 12).join(',')}…; page resize widths ${widths.slice(0, 12).join(',')}…`);
      expect(mid.length, 'progress passes through intermediate values').toBeGreaterThanOrEqual(5);
      for (let i = 1; i < samples.length; i++) expect(samples[i].p).toBeGreaterThanOrEqual(samples[i - 1].p); // monotonic unfold
      expect(samples.some((x) => x.w > 560 && x.w < 1100), 'device frame width interpolates').toBe(true);
      expect(widths.some((x) => x > 560 && x < 1100), 'the real page reflows at intermediate widths').toBe(true);
      await expect(iframe).toHaveAttribute('style', /width: 1114px/);

      // Fold back (animated) for the compact defect.
      await page.getByTestId('fold-dock').getByRole('button', { name: 'Play fold' }).click();
      await expect.poll(() => store(page, (s) => ({ playing: s.transition.playing, posture: s.viewport.posture, p: s.transition.progress }))).toEqual({ playing: false, posture: 'folded', p: 0 });
      await expect(iframe).toHaveAttribute('style', /width: 540px/);
    });

    await test.step('6. Select a problematic element', async () => {
      await expect(page.getByRole('radio', { name: /Inspect/ })).toBeChecked();
      await frame.locator('.rate-banner').click({ position: { x: 6, y: 6 } });
      await expect.poll(() => store(page, (s) => s.selection.info?.selector ?? null)).toMatch(/rate-banner/);
      const sel = await store(page, (s) => ({ selector: s.selection.selector, info: { selector: s.selection.info.selector, tag: s.selection.info.tag, component: s.selection.info.component?.name, w: s.selection.info.rect.width } }));
      console.log('[acceptance] selection', JSON.stringify(sel));
      expect(sel.info).toMatchObject({ tag: 'aside', component: 'RateBanner', w: 560 });
      await expect(page.getByText('RateBanner').first()).toBeVisible();
    });

    await test.step('7. Inspect its DOM, computed CSS, and box model', async () => {
      await page.getByRole('tab', { name: 'DOM', exact: true }).click();
      await expect(page.getByRole('tree', { name: 'DOM' }).locator('[role="treeitem"][aria-selected="true"]')).toContainText('rate-banner');

      await page.getByRole('tab', { name: 'Computed', exact: true }).click();
      await page.getByPlaceholder('Filter computed styles').fill('width');
      // Computed width 560px, attributed to the authored .rate-banner rule in login.css.
      await expect(page.locator('[title^="From .rate-banner"]', { hasText: /^width/ }).filter({ hasText: '560px' })).toBeVisible();

      await page.getByRole('tab', { name: 'Box', exact: true }).click();
      await expect(page.getByText(/^560 × \d+(\.\d+)? CSS px$/)).toBeVisible();
      await expect(page.getByText(/box-sizing: border-box/)).toBeVisible();

      await page.getByRole('tab', { name: 'Styles', exact: true }).click();
      await expect(page.getByText('560px').first()).toBeVisible();
      await expect(page.getByText(/login\.css/).first()).toBeVisible();
    });

    await test.step('8. Identify a responsive defect', async () => {
      // The banner's right edge is past the 540px viewport...
      const edge = await (await primaryFrame(page)).evaluate(() => ({ right: document.querySelector('.rate-banner')!.getBoundingClientRect().right, vw: innerWidth }));
      expect(edge.right).toBeGreaterThan(edge.vw);
      // ...and the responsive audit names it.
      await runCommand(page, 'Run responsive audit (all postures + reference viewports)');
      await expect.poll(() => store(page, (s) => s.auditStatus.responsive), { timeout: 90_000 }).toBe('done');
      const issues = await store(page, (s) => s.responsiveIssues.map((i: { rule: string; selector: string; viewport: { width: number; posture: string; deviceId: string }; classification: string; severity: string }) => ({ rule: i.rule, selector: i.selector, w: i.viewport.width, posture: i.viewport.posture, device: i.viewport.deviceId, c: i.classification, sev: i.severity })));
      console.log('[acceptance] responsive issues', issues.length, JSON.stringify(issues.slice(0, 40)));
      const d1 = issues.filter((i) => i.rule === 'horizontal-overflow' && /rate-banner/.test(i.selector));
      expect(d1.some((i) => i.w === 540 && i.device === 'surface-duo'), 'audit reports the .rate-banner overflow at 540px').toBe(true);
      expect(d1.some((i) => i.w === 1114), 'not reported when expanded').toBe(false);
      // Shown in the Responsive findings panel.
      await expect(page.getByLabel('Responsive findings').getByText(/rate-banner/).first()).toBeVisible();
    });

    await test.step('9. Apply and undo a visual fix', async () => {
      await page.getByRole('tab', { name: 'Design', exact: true }).click();
      const width = page.locator('label', { has: page.locator('span', { hasText: /^W$/ }) }).locator('input').first();
      await width.click();
      await width.fill('100%');
      await width.press('Enter');
      await expect.poll(() => overflow(page)).toBeLessThanOrEqual(0);
      await expect(page.getByText('1 edit')).toBeVisible();
      const ch = await store(page, (s) => s.changes.map((c: { property: string; before: string; after: string; viewport: { width: number } }) => ({ property: c.property, before: c.before, after: c.after, w: c.viewport.width })));
      expect(ch).toEqual([expect.objectContaining({ property: 'width', after: '100%', w: 540 })]);

      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect.poll(() => overflow(page)).toBeGreaterThan(0);
      await expect.poll(() => store(page, (s) => s.changes.length)).toBe(0);
      await expect(page.getByText('1 edit')).toBeHidden();

      // Keep the fix for the rest of the workflow.
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect.poll(() => overflow(page)).toBeLessThanOrEqual(0);
      await expect.poll(() => store(page, (s) => s.changes.length)).toBe(1);
    });

    await test.step('10. Run the responsive diff and accessibility checks', async () => {
      await runCommand(page, 'Run all audits (responsive + accessibility)');
      await expect.poll(() => store(page, (s) => [s.auditStatus.responsive, s.auditStatus.a11y]), { timeout: 120_000 }).toEqual(['done', 'done']);
      const a11y = await store(page, (s) => s.a11yIssues.map((i: { ruleId: string; impact: string; nodes: { selector: string }[] }) => ({ rule: i.ruleId, impact: i.impact, nodes: i.nodes.map((n) => n.selector) })));
      console.log('[acceptance] a11y', JSON.stringify(a11y));
      expect(a11y.length).toBeGreaterThan(0);
      expect(a11y.some((i) => i.rule === 'color-contrast' && i.nodes.some((n) => /login-form__forgot|forgot-password/.test(n))), 'D3 low-contrast link').toBe(true);
      // With the fix applied, the folded overflow of the banner is gone.
      const after = await store(page, (s) => s.responsiveIssues.filter((i: { rule: string; selector: string; viewport: { width: number } }) => i.rule === 'horizontal-overflow' && /rate-banner/.test(i.selector) && i.viewport.width === 540).length);
      expect(after).toBe(0);
      await page.getByRole('tab', { name: /Accessibility/ }).click();
      await expect(page.getByText(/color-contrast|contrast/i).first()).toBeVisible();

      // Responsive diff: capture both postures and compare them.
      const before = await store(page, (s) => s.captures.length);
      await runCommand(page, 'Compare folded vs expanded (capture both postures + diff)');
      await expect.poll(() => store(page, (s) => s.captures.length), { timeout: 90_000 }).toBeGreaterThanOrEqual(before + 2);
      const pair = await store(page, (s) => s.captures.slice(-2).map((c: { viewport: { width: number; posture: string } }) => ({ w: c.viewport.width, posture: c.viewport.posture })));
      console.log('[acceptance] fold pair', JSON.stringify(pair));
      expect(pair.map((c) => c.posture).sort()).toEqual(['expanded', 'folded']);
      await expect(page.getByLabel('Capture A')).toBeVisible();
      await expect(page.getByText(/\d+ structural changes? · \d+ suspicious/)).toBeVisible({ timeout: 30_000 });
    });

    let scenarioName = '';
    await test.step('11. Record and replay an interaction', async () => {
      await page.getByRole('tab', { name: 'Canvas' }).first().click().catch(() => {});
      await runCommand(page, 'Start / stop recording an interaction');
      await expect.poll(() => store(page, (s) => s.recording.active)).toBe(true);
      await expect(page.getByRole('radio', { name: /Interact/ })).toBeChecked();
      const username = frame.locator('[data-testid="login-username"]');
      await username.click();
      await username.pressSequentially('demo.borrower', { delay: 20 });
      await frame.locator('[data-testid="login-password"]').click();
      await runCommand(page, 'Start / stop recording an interaction');
      await expect.poll(() => store(page, (s) => s.recording.active)).toBe(false);
      const dialog = page.getByRole('dialog', { name: 'Save recorded scenario' });
      await expect(dialog).toBeVisible();
      scenarioName = `Acceptance sign-in ${Date.now() % 100000}`;
      await dialog.getByLabel('Name').fill(scenarioName);
      await dialog.getByRole('button', { name: 'Save scenario' }).click();
      await expect(dialog).toBeHidden();
      const sc = await store(page, (s) => s.scenarios.filter((x: { builtIn: boolean }) => !x.builtIn).map((x: { name: string; route: string; steps: { action: { type: string; value?: string } }[] }) => ({ name: x.name, route: x.route, steps: x.steps.map((st) => st.action) })));
      console.log('[acceptance] scenarios', JSON.stringify(sc));
      expect(sc).toHaveLength(1);
      expect(sc[0]).toMatchObject({ name: scenarioName, route: '#/login' });
      // Typed credentials are stored as fixture placeholders, never as the value.
      expect(sc[0].steps).toContainEqual(expect.objectContaining({ type: 'fill', value: '{{secret:username}}' }));

      // Clear the field, then replay from the scenarios panel.
      await username.fill('');
      await runCommand(page, 'Show test scenarios');
      await page.getByPlaceholder('Filter scenarios').fill(scenarioName);
      const item = page.getByRole('treeitem').filter({ hasText: scenarioName });
      await item.getByRole('button', { name: 'Replay on the canvas device' }).click();
      await expect.poll(() => store(page, (s) => s.runs.at(-1)?.status ?? null), { timeout: 60_000 }).toBe('passed');
      const run = await store(page, (s) => { const r = s.runs.at(-1); return { name: r.scenarioName, steps: r.steps.map((x: { status: string }) => x.status) }; });
      console.log('[acceptance] run', JSON.stringify(run));
      expect(run.name).toBe(scenarioName);
      expect(run.steps.length).toBeGreaterThan(0);
      expect(run.steps.every((x) => x === 'passed')).toBe(true);
      // The replay really drove the page: the fixture value is back in the field.
      await expect(username).toHaveValue('demo.borrower');
      // The fix survives the replay's page reset.
      await expect.poll(() => overflow(page)).toBeLessThanOrEqual(0);
    });

    let beforeId = '';
    let afterId = '';
    await test.step('12. Capture before-and-after screenshots', async () => {
      await page.getByRole('radio', { name: /Inspect/ }).click();
      const capture = page.getByRole('button', { name: 'Capture screenshot' });
      const n0 = await store(page, (s) => s.captures.length);
      // Before: the defect (fix undone).
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect.poll(() => overflow(page)).toBeGreaterThan(0);
      await capture.click();
      await expect.poll(() => store(page, (s) => s.captures.length), { timeout: 60_000 }).toBeGreaterThan(n0);
      await expect(page.getByText(/Screenshot saved/).first()).toBeVisible({ timeout: 60_000 });
      const n1 = await store(page, (s) => s.captures.length);
      // After: the fix re-applied.
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect.poll(() => overflow(page)).toBeLessThanOrEqual(0);
      await page.waitForTimeout(300);
      await capture.click();
      await expect.poll(() => store(page, (s) => s.captures.length), { timeout: 60_000 }).toBeGreaterThan(n1);
      const caps = await store(page, (s) => s.captures.map((c: { id: string; kind: string; changeCount: number; width: number; viewport: { width: number }; dataUrl: string }) => ({ id: c.id, kind: c.kind, changes: c.changeCount, w: c.viewport.width, png: c.dataUrl.startsWith('data:image/png') })));
      console.log('[acceptance] captures', JSON.stringify(caps));
      const fresh = caps.slice(n0).filter((c) => c.kind === 'raster');
      expect(fresh).toHaveLength(2);
      expect(fresh.map((c) => c.changes)).toEqual([0, 1]);
      expect(fresh.every((c) => c.w === 540 && c.png)).toBe(true);
      [beforeId, afterId] = fresh.map((c) => c.id);

      // Compare them in the responsive diff: one edit apart, and the pixels differ.
      await runCommand(page, 'Open responsive diff & screenshots');
      await page.getByLabel('Capture A').selectOption(beforeId);
      await page.getByLabel('Capture B').selectOption(afterId);
      await expect(page.getByText('+1 edit')).toBeVisible();
      await page.getByRole('radio', { name: /Pixels/ }).click();
      const pct = page.getByText(/^\d+\.\d\d% changed$/);
      await expect(pct).toBeVisible({ timeout: 30_000 });
      expect(parseFloat((await pct.textContent()) ?? '0')).toBeGreaterThan(0);
    });

    await test.step('13. Review the generated code changes', async () => {
      await page.getByRole('button', { name: 'Export changes' }).click();
      const panel = page.getByTestId('export-panel');
      await expect(panel).toBeVisible();
      const diff = panel.getByTestId('diff-file').first();
      await expect(diff).toBeVisible({ timeout: 20_000 });
      console.log('[acceptance] diff file', await diff.getAttribute('data-path'), (await diff.innerText()).slice(0, 600));
      await expect(diff).toHaveAttribute('data-path', /login\.css$/);
      await expect(diff).toContainText('560px');
      await expect(diff).toContainText('100%');
    });

    await test.step('14. Export a patch or QA report', async () => {
      const panel = page.getByTestId('export-panel');
      const patch = await download(page, () => panel.getByRole('button', { name: '.patch' }).click());
      console.log('[acceptance] patch', patch.name, '\n' + patch.text);
      expect(patch.name).toMatch(/\.patch$/);
      expect(patch.text).toMatch(/^diff --git a\/\S*login\.css b\/\S*login\.css/m);
      expect(patch.text).toMatch(/^-\s*width: 560px;/m);
      expect(patch.text).toMatch(/^\+\s*width: 100%;/m);

      await runCommand(page, 'Open responsive QA report');
      const report = page.getByTestId('report-doc');
      await expect(report).toBeVisible();
      const html = await download(page, () => report.getByTestId('report-download').click());
      console.log('[acceptance] report', html.name, html.text.length);
      expect(html.name).toMatch(/qa-report\.html$/);
      expect(html.text).toMatch(/^<!doctype html>/i);
      expect(html.text).toContain('Harborline Mortgage');
      expect(html.text).toContain('rate-banner');
      expect(html.text).toContain('color-contrast');
      expect(html.text).toContain(scenarioName);
    });

    await test.step('15. Reopen the project with its saved configuration intact', async () => {
      // Leave the device unfolded so the restored posture is not the default.
      await page.getByRole('tab', { name: 'Canvas' }).first().click().catch(() => {});
      await posture.getByRole('radio', { name: 'Expanded' }).click();
      await expect(iframe).toHaveAttribute('style', /width: 1114px/, { timeout: 8000 });
      const saved = await store(page, (s) => ({ captures: s.captures.length, scenarios: s.scenarios.filter((x: { builtIn: boolean }) => !x.builtIn).length, a11y: s.a11yIssues.length, responsive: s.responsiveIssues.length }));
      await expect(page.locator('[data-status="saved"]')).toBeVisible({ timeout: 10_000 });

      await page.reload();
      await page.getByText('Recent projects').waitFor();
      await page.getByRole('button', { name: /^Harborline Mortgage \d/ }).click();
      await expect(page.getByText(/Restored “Harborline Mortgage”/)).toBeVisible();
      await expect(frame.locator('[data-testid="login-submit"]')).toBeVisible();

      const restored = await store(page, (s) => ({
        viewport: s.viewport,
        changes: s.changes.map((c: { property: string; after: string }) => ({ property: c.property, after: c.after })),
        captures: s.captures.length,
        scenarios: s.scenarios.filter((x: { builtIn: boolean }) => !x.builtIn).map((x: { name: string }) => x.name),
        a11y: s.a11yIssues.length,
        responsive: s.responsiveIssues.length,
      }));
      console.log('[acceptance] restored', JSON.stringify(restored));
      expect(restored.viewport).toMatchObject({ deviceId: 'surface-duo', posture: 'expanded' });
      expect(restored.changes).toEqual([{ property: 'width', after: '100%' }]);
      expect(restored.captures).toBe(saved.captures);
      expect(restored.scenarios).toEqual([scenarioName]);
      expect(restored.a11y).toBe(saved.a11y);
      expect(restored.responsive).toBe(saved.responsive);
      await expect(iframe).toHaveAttribute('style', /width: 1114px/, { timeout: 8000 });
      await expect(page.getByText('1 edit')).toBeVisible();
      // The saved edit is re-applied to the fresh page: folded, the banner no longer overflows.
      await posture.getByRole('radio', { name: 'Folded' }).click();
      await expect(iframe).toHaveAttribute('style', /width: 540px/, { timeout: 8000 });
      await expect.poll(() => overflow(page)).toBeLessThanOrEqual(0);
    });
  });
});
