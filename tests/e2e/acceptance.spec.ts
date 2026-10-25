import { readFile } from 'node:fs/promises';
import { expect, test, type Frame, type Page } from '@playwright/test';

/**
 * Final acceptance: the 15-step product workflow, end to end through the real
 * UI, on the synthetic Harborline mortgage demo. Each test.step maps 1:1 to a
 * step of the acceptance workflow. Every action is driven through the studio
 * UI (clicks, the command palette, the toolbar); the store (window.__IFDY__,
 * dev builds only) is read for assertions only.
 */

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Read from the studio store. `pick` must be self-contained: it is serialized into the page. */
function store<T>(page: Page, pick: (s: any) => T): Promise<T> {
  return page.evaluate(`(${pick.toString()})(window.__IFDY__.useStudio.getState())`) as Promise<T>;
}

/** The canvas preview: the real demo document inside the device frame. */
async function primaryFrame(page: Page): Promise<Frame> {
  const handle = await page.locator('iframe[data-instance="primary"]').elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error('Primary preview frame is not attached');
  return frame;
}

/** Horizontal page overflow of the canvas page in CSS px (> 0: the page scrolls sideways). */
async function overflow(page: Page): Promise<number> {
  return (await primaryFrame(page)).evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

/** Right edge of the promotional banner vs. the viewport width. */
async function bannerEdge(page: Page) {
  return (await primaryFrame(page)).evaluate(() => ({ right: document.querySelector('.rate-banner')!.getBoundingClientRect().right, vw: innerWidth }));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Run a registered action from the command palette (Mod+K) by its label. */
async function runCommand(page: Page, label: string) {
  // Studio shortcuts belong to the studio document, not to the previewed page.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByPlaceholder(/Search actions/);
  await expect(input).toBeVisible();
  await input.fill(label);
  await page.getByRole('option', { name: new RegExp(`^${escapeRe(label)}`) }).first().click();
  await expect(input).toBeHidden();
}

/** test.step that also logs its duration. */
async function step(title: string, body: () => Promise<void>) {
  const t0 = Date.now();
  await test.step(title, body);
  console.log(`[acceptance] ${title}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

async function download(page: Page, click: () => Promise<void>) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: dl.suggestedFilename(), text: await readFile(await dl.path(), 'utf8') };
}

type Cap = { id: string; kind: string; changes: number; w: number; posture: string; png: boolean };
const listCaptures = (page: Page) =>
  store(page, (s) =>
    s.captures.map((c: { id: string; kind: string; changeCount: number; viewport: { width: number; posture: string }; dataUrl: string }) => ({
      id: c.id,
      kind: c.kind,
      changes: c.changeCount,
      w: c.viewport.width,
      posture: c.viewport.posture,
      png: c.dataUrl.startsWith('data:image/png;base64,'),
    })),
  ) as Promise<Cap[]>;

/* ------------------------------------------------------------------ */
/* The workflow                                                        */
/* ------------------------------------------------------------------ */

test.describe('IFDY acceptance workflow', () => {
  test('15-step acceptance workflow on the synthetic mortgage login', async ({ page }) => {
    test.setTimeout(240_000);
    const iframe = page.locator('iframe[data-instance="primary"]');
    const frame = page.frameLocator('iframe[data-instance="primary"]');
    const posture = page.getByRole('radiogroup', { name: 'Posture' });
    const inspector = page.getByTestId('right');

    await step('1. Open the studio', async () => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: /Build interfaces against the real browser/ })).toBeVisible();
      await expect(page.getByText('Companion connected')).toBeVisible();
      await expect(page.getByRole('button', { name: /Open the Harborline demo/ })).toBeEnabled();
      expect(await store(page, (s) => s.project)).toBeNull();
    });

    await step('2. Load the authorized synthetic mortgage login', async () => {
      await page.getByRole('button', { name: /Open the Harborline demo/ }).click();
      await expect(frame.locator('[data-testid="login-submit"]')).toBeVisible();
      await expect(frame.getByLabel('Demo credentials')).toContainText('demo.borrower');
      await expect(frame.getByText(/fictional mortgage servicer/)).toBeAttached();
      const p = await store(page, (s) => ({ project: s.project, route: s.currentRoute, origin: s.server.previewOrigin, status: s.instances.primary?.status, url: s.instances.primary?.url }));
      expect(p.project).toMatchObject({ name: 'Harborline Mortgage', source: { kind: 'demo', label: expect.stringMatching(/synthetic/i) } });
      expect(p.route).toBe('#/login');
      expect(p.status).toBe('ready');
      // Served from the companion's authorised preview origin (a separate origin from the studio).
      expect(p.origin).toMatch(/^http:\/\/localhost:\d+$/);
      expect(p.origin).not.toBe(new URL(page.url()).origin);
      expect(p.url).toBe(`${p.origin}/demo/index.html#/login`);
      expect((await primaryFrame(page)).url()).toBe(p.url);
    });

    await step('3. Inspect the actual page in the device simulator', async () => {
      await expect(page.getByText(/Running\s+Harborline Mortgage on Surface Duo/)).toBeVisible();
      await expect(iframe).toHaveAttribute('style', /width: 540px/);
      expect(await store(page, (s) => s.viewport)).toMatchObject({ deviceId: 'surface-duo', posture: 'folded' });
      // The real rendered document at the device's CSS viewport, not a picture of it.
      const f = await primaryFrame(page);
      const doc = await f.evaluate(() => ({ w: innerWidth, h: innerHeight, title: document.title, form: Boolean(document.querySelector('form [data-testid="login-username"]')) }));
      expect(doc).toMatchObject({ w: 540, h: 720, form: true });
      expect(doc.title).toMatch(/Harborline/);
      // Inspect mode: hovering outlines the real element and labels it with its measured size.
      const dims = await f.evaluate(() => {
        const b = document.querySelector('[data-testid="login-submit"]')!.getBoundingClientRect();
        return `${Math.round(b.width)}×${Math.round(b.height)}`;
      });
      await frame.locator('[data-testid="login-submit"]').hover({ position: { x: 12, y: 24 } });
      await expect(page.getByText(dims, { exact: true })).toBeVisible();
    });

    await step('4. Switch between compact and expanded viewports', async () => {
      await expect.poll(() => overflow(page)).toBeGreaterThan(0); // D1 manifests when compact...
      await posture.getByRole('radio', { name: 'Expanded' }).click();
      await expect(iframe).toHaveAttribute('style', /width: 1114px/, { timeout: 8000 });
      await expect.poll(async () => (await primaryFrame(page)).evaluate(() => innerWidth)).toBe(1114);
      await expect.poll(() => store(page, (s) => s.viewport.posture)).toBe('expanded');
      await expect.poll(() => overflow(page)).toBeLessThanOrEqual(0); // ...and not when expanded.

      await posture.getByRole('radio', { name: 'Folded' }).click();
      await expect(iframe).toHaveAttribute('style', /width: 540px/, { timeout: 8000 });
      await expect.poll(async () => (await primaryFrame(page)).evaluate(() => innerWidth)).toBe(540);
      await expect.poll(() => store(page, (s) => s.viewport.posture)).toBe('folded');
      await expect.poll(() => overflow(page)).toBeGreaterThan(0);
      // The page snaps back as soon as the content slides off; wait for the hinge to close too.
      await expect.poll(() => store(page, (s) => ({ playing: s.transition.playing, p: s.transition.progress }))).toEqual({ playing: false, p: 0 });
    });

    await step('5. Animate the device transition', async () => {
      // Sample the 3D hinge (CSS variables written by the motion engine), the slide-across
      // reveal and the device viewport (iframe layout width) on every animation frame,
      // and the page's own innerWidth on every resize.
      await page.evaluate(() => {
        const w = window as unknown as { __samples: { a: number; s: number; w: number }[]; __sampling: boolean };
        const el = document.querySelector('iframe[data-instance="primary"]') as HTMLIFrameElement;
        const stage = document.querySelector('[data-device-stage="primary"]') as HTMLElement;
        w.__samples = [];
        w.__sampling = true;
        const tick = () => {
          w.__samples.push({ a: parseFloat(stage.style.getPropertyValue('--fold-angle')), s: parseFloat(stage.style.getPropertyValue('--fold-slide')), w: el.offsetWidth });
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
      const dock = page.getByTestId('fold-dock');
      await dock.getByRole('button', { name: 'Play unfold' }).click();
      await expect.poll(() => store(page, (s) => s.transition.playing)).toBe(true);
      await expect.poll(() => store(page, (s) => ({ playing: s.transition.playing, posture: s.viewport.posture, p: s.transition.progress }))).toEqual({ playing: false, posture: 'expanded', p: 1 });
      const samples = await page.evaluate(() => {
        const w = window as unknown as { __samples: { a: number; s: number; w: number }[]; __sampling: boolean };
        w.__sampling = false;
        return w.__samples;
      });
      const widths = await f.evaluate(() => (window as unknown as { __widths: number[] }).__widths);
      // The second panel swings round its hinge from behind (180°) to flat (0°).
      const swinging = samples.filter((x) => x.a > 5 && x.a < 175);
      expect(swinging.length, 'the hinge passes through intermediate angles').toBeGreaterThanOrEqual(5);
      expect(samples.every((x, i) => i === 0 || x.a <= samples[i - 1].a + 0.001), 'the hinge only opens').toBe(true);
      // The live page keeps its folded viewport while the hinge moves, and reflows once it is flat.
      expect(samples.filter((x) => x.a > 0.5).every((x) => x.w === 540), 'viewport stays 540 while the hinge swings').toBe(true);
      expect(new Set(samples.map((x) => x.w)), 'the viewport switches once, 540 → 1114').toEqual(new Set([540, 1114]));
      expect(widths.filter((x) => x > 560 && x < 1100), 'no intermediate reflows').toEqual([]);
      expect(widths.at(-1)).toBe(1114);
      // Then the expanded content slides across the second screen.
      const sliding = samples.filter((x) => x.w === 1114 && x.s > 0.02 && x.s < 0.98);
      expect(sliding.length, 'content slides across after the reflow').toBeGreaterThanOrEqual(2);
      expect(samples.at(-1)!.s).toBe(1);
      await expect(dock.getByText('100%', { exact: true })).toBeVisible();

      // Fold back, animated, to work on the compact defect.
      await dock.getByRole('button', { name: 'Play fold' }).click();
      await expect.poll(() => store(page, (s) => ({ playing: s.transition.playing, posture: s.viewport.posture, p: s.transition.progress }))).toEqual({ playing: false, posture: 'folded', p: 0 });
      await expect(iframe).toHaveAttribute('style', /width: 540px/);
      await expect(dock.getByText('0%', { exact: true })).toBeVisible();
    });

    await step('6. Select a problematic element', async () => {
      await expect(page.getByRole('radio', { name: /Inspect/ })).toBeChecked();
      await frame.locator('.rate-banner').click({ position: { x: 6, y: 6 } });
      await expect.poll(() => store(page, (s) => s.selection.info?.selector ?? null)).toBe('[data-testid="rate-banner"]');
      const info = await store(page, (s) => ({ tag: s.selection.info.tag, classes: s.selection.info.classes, component: s.selection.info.component?.name, w: s.selection.info.rect.width }));
      expect(info).toMatchObject({ tag: 'aside', classes: ['rate-banner'], component: 'RateBanner', w: 560 });
      // The inspector header names the element, its component and its size.
      await expect(inspector.getByText('RateBanner', { exact: true })).toBeVisible();
      await expect(inspector.getByText(/^560×\d+$/)).toBeVisible();
    });

    await step('7. Inspect its DOM, computed CSS, and box model', async () => {
      await page.getByRole('tab', { name: 'DOM', exact: true }).click();
      await expect(page.getByRole('tree', { name: 'DOM' }).locator('[role="treeitem"][aria-selected="true"]')).toContainText('rate-banner');

      await page.getByRole('tab', { name: 'Computed', exact: true }).click();
      await page.getByPlaceholder('Filter computed styles').fill('width');
      // Computed width 560px, attributed to the authored .rate-banner rule in login.css.
      await expect(inspector.locator('[title^="From .rate-banner"]', { hasText: /^width/ }).filter({ hasText: '560px' })).toBeVisible();

      await page.getByRole('tab', { name: 'Box', exact: true }).click();
      await expect(inspector.getByText(/^560 × \d+(\.\d+)? CSS px$/)).toBeVisible(); // border box
      await expect(inspector.getByText(/box-sizing: border-box/)).toBeVisible();

      await page.getByRole('tab', { name: 'Styles', exact: true }).click();
      await expect(inspector.getByText('.rate-banner', { exact: true }).first()).toBeVisible();
      await expect(inspector.getByRole('button', { name: /^login\.css:\d+$/ }).first()).toBeVisible();
      await expect(inspector.getByText('560px', { exact: true })).toBeVisible();
    });

    await step('8. Identify a responsive defect', async () => {
      // The banner's right edge lies past the 540px viewport...
      const edge = await bannerEdge(page);
      expect(edge.right).toBeGreaterThan(edge.vw);
      // ...and the responsive audit (all postures + reference viewports) names it.
      await runCommand(page, 'Run responsive audit (all postures + reference viewports)');
      await expect.poll(() => store(page, (s) => s.auditStatus.responsive), { timeout: 90_000 }).toBe('done');
      const issues = await store<{ rule: string; selector: string; c: string; w: number; device: string }[]>(page, (s) => s.responsiveIssues.map((i: { rule: string; selector: string; classification: string; viewport: { width: number; deviceId: string } }) => ({ rule: i.rule, selector: i.selector, c: i.classification, w: i.viewport.width, device: i.viewport.deviceId })));
      const d1 = issues.filter((i) => i.rule === 'horizontal-overflow' && i.selector.includes('rate-banner'));
      expect(d1.some((i) => i.w === 540 && i.device === 'surface-duo'), 'D1: .rate-banner overflows the folded Surface Duo').toBe(true);
      expect(d1.some((i) => i.w >= 1114), 'D1 does not apply when expanded or on desktop').toBe(false);
      // D2 is found too: the sign-in button sits under the hinge when the Duo is spanned.
      expect(issues).toContainEqual(expect.objectContaining({ rule: 'fold-intersection', selector: '[data-testid="login-submit"]', w: 1114, c: 'regression' }));
      // The finding is listed in the Responsive panel.
      await expect(page.getByLabel('Responsive findings').getByText('[data-testid="rate-banner"]', { exact: true }).first()).toBeVisible();
    });

    await step('9. Apply and undo a visual fix', async () => {
      // Edit the authored declaration in the cascade: .rate-banner { width: 560px → 100% }.
      await page.getByRole('tab', { name: 'Styles', exact: true }).click();
      await inspector.getByText('560px', { exact: true }).click();
      const value = inspector.locator('input:focus');
      await expect(value).toHaveValue('560px');
      await value.fill('100%');
      await value.press('Enter');
      await expect.poll(() => overflow(page)).toBeLessThanOrEqual(0);
      const edge = await bannerEdge(page);
      expect(edge.right).toBeLessThanOrEqual(edge.vw);
      await expect(page.getByText('1 edit', { exact: true })).toBeVisible();
      const changes = await store(page, (s) => s.changes.map((c: { kind: string; property: string; before: string; after: string; target: { ruleSelector?: string }; viewport: { width: number } }) => ({ kind: c.kind, rule: c.target.ruleSelector, property: c.property, before: c.before, after: c.after, w: c.viewport.width })));
      expect(changes).toEqual([{ kind: 'rule', rule: '.rate-banner', property: 'width', before: '560px', after: '100%', w: 540 }]);

      // Undo restores the defect...
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect.poll(() => overflow(page)).toBeGreaterThan(0);
      await expect.poll(() => store(page, (s) => s.changes.length)).toBe(0);
      await expect(page.getByText('1 edit', { exact: true })).toBeHidden();
      await expect(inspector.getByText('560px', { exact: true })).toBeVisible();

      // ...and redo brings the fix back for the rest of the workflow.
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect.poll(() => overflow(page)).toBeLessThanOrEqual(0);
      await expect.poll(() => store(page, (s) => s.changes.length)).toBe(1);
    });

    let a11yCount = 0;
    await step('10. Run the responsive diff and accessibility checks', async () => {
      await runCommand(page, 'Run all audits (responsive + accessibility)');
      await expect.poll(() => store(page, (s) => [s.auditStatus.responsive, s.auditStatus.a11y]), { timeout: 120_000 }).toEqual(['done', 'done']);
      const a11y = await store(page, (s) => s.a11yIssues.map((i: { ruleId: string; nodes: { selector: string }[] }) => ({ rule: i.ruleId, nodes: i.nodes.map((n) => n.selector) })));
      a11yCount = a11y.length;
      // The seeded accessibility defects: D3 contrast (axe), D4 placeholder-only label and D5 tap target (IFDY checks).
      expect(a11y).toContainEqual({ rule: 'color-contrast', nodes: expect.arrayContaining(['.login-form__forgot']) });
      expect(a11y).toContainEqual({ rule: 'ifdy-placeholder-label', nodes: expect.arrayContaining(['#login-loan-number']) });
      expect(a11y).toContainEqual({ rule: 'ifdy-target-size', nodes: expect.arrayContaining(['#login-remember']) });
      await page.getByRole('tab', { name: new RegExp(`^Accessibility\\s*${a11yCount}$`) }).click();
      await expect(page.getByText('color-contrast', { exact: true }).first()).toBeVisible();
      // Re-audited with the fix applied: the folded banner overflow is gone, the hinge defect is not.
      const responsive = await store<{ rule: string; selector: string; w: number }[]>(page, (s) => s.responsiveIssues.map((i: { rule: string; selector: string; viewport: { width: number } }) => ({ rule: i.rule, selector: i.selector, w: i.viewport.width })));
      expect(responsive.filter((i) => i.rule === 'horizontal-overflow' && i.selector.includes('rate-banner'))).toEqual([]);
      expect(responsive).toContainEqual({ rule: 'fold-intersection', selector: '[data-testid="login-submit"]', w: 1114 });

      // Responsive diff: capture the device folded and expanded, then compare.
      const known = new Set((await listCaptures(page)).map((c) => c.id));
      await runCommand(page, 'Compare folded vs expanded (capture both postures + diff)');
      await expect.poll(async () => (await listCaptures(page)).filter((c) => !known.has(c.id)).length, { timeout: 90_000 }).toBe(2);
      const pair = (await listCaptures(page)).filter((c) => !known.has(c.id));
      const folded = pair.find((c) => c.posture === 'folded');
      const expanded = pair.find((c) => c.posture === 'expanded');
      expect(folded).toMatchObject({ w: 540, png: true });
      expect(expanded).toMatchObject({ w: 1114, png: true });
      await expect(page.getByLabel('Capture A')).toHaveValue(folded!.id);
      await expect(page.getByLabel('Capture B')).toHaveValue(expanded!.id);
      await expect(page.getByText('Size Δ', { exact: false }).first()).toBeVisible();
      const summary = page.getByText(/^\d+ structural changes? · \d+ suspicious · \d+ unchanged$/);
      await expect(summary).toBeVisible({ timeout: 30_000 });
      expect(parseInt((await summary.textContent())!, 10), 'layout differs between postures').toBeGreaterThan(0);
    });

    let scenarioName = '';
    await step('11. Record and replay an interaction', async () => {
      await page.getByRole('tab', { name: 'Canvas', exact: true }).click();
      await runCommand(page, 'Start / stop recording an interaction');
      await expect.poll(() => store(page, (s) => s.recording.active)).toBe(true);
      await expect(page.getByRole('radio', { name: /Interact/ })).toBeChecked(); // recording switches to Interact
      const username = frame.locator('[data-testid="login-username"]');
      const remember = frame.locator('[data-testid="login-remember"]');
      await username.click();
      await username.pressSequentially('demo.borrower', { delay: 20 });
      await remember.check();
      await runCommand(page, 'Start / stop recording an interaction');
      await expect.poll(() => store(page, (s) => s.recording.active)).toBe(false);

      const dialog = page.getByRole('dialog', { name: 'Save recorded scenario' });
      await expect(dialog).toBeVisible();
      scenarioName = `Acceptance sign-in ${Date.now() % 100000}`;
      await dialog.getByLabel('Name').fill(scenarioName);
      await dialog.getByRole('button', { name: 'Save scenario' }).click();
      await expect(dialog).toBeHidden();
      const saved = await store(page, (s) =>
        s.scenarios
          .filter((x: { builtIn: boolean }) => !x.builtIn)
          .map((x: { name: string; route: string; steps: { action: { type: string; value?: string; checked?: boolean } }[] }) => ({ name: x.name, route: x.route, steps: x.steps.map((st) => ({ type: st.action.type, value: st.action.value, checked: st.action.checked })) })),
      );
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({ name: scenarioName, route: '#/login' });
      // Typed credentials are stored as fixture placeholders, never as the typed value.
      expect(saved[0].steps).toEqual([
        { type: 'fill', value: '{{secret:username}}', checked: undefined },
        { type: 'check', value: undefined, checked: true },
      ]);

      // Reset the form by hand, then replay from the Test scenarios panel.
      await username.fill('');
      await remember.uncheck();
      await runCommand(page, 'Show test scenarios');
      await page.getByPlaceholder('Filter scenarios').fill(scenarioName);
      const item = page.getByRole('treeitem').filter({ hasText: scenarioName });
      await item.hover(); // row actions appear on hover
      await item.getByRole('button', { name: 'Replay on the canvas device' }).click({ timeout: 10_000 });
      const latestRun = () =>
        store(page, (s) => {
          const r = s.runs[0]; // newest first
          return r ? { name: r.scenarioName as string, status: r.status as string, steps: r.steps.map((x: { status: string }) => x.status) as string[], device: r.viewport.deviceId as string, w: r.viewport.width as number } : null;
        });
      await expect.poll(async () => (await latestRun())?.status, { timeout: 60_000 }).toBe('passed');
      expect(await latestRun()).toEqual({ name: scenarioName, status: 'passed', steps: ['passed', 'passed'], device: 'surface-duo', w: 540 });
      // The replay drove the real page: the fixture value is typed and the box checked again.
      await expect(username).toHaveValue('demo.borrower');
      await expect(remember).toBeChecked();
      await expect(item.getByRole('button', { name: new RegExp(`^Passed ${escapeRe(scenarioName)}`) })).toBeVisible();
      // The fix survives the replay's page reset.
      await expect.poll(() => overflow(page)).toBeLessThanOrEqual(0);
    });

    await step('12. Capture before-and-after screenshots', async () => {
      await page.getByRole('radio', { name: /Inspect/ }).click();
      /** Toolbar camera; resolves with the captures it made (DOM raster, plus Chromium when the companion has it). */
      const shoot = async (): Promise<Cap[]> => {
        const known = new Set((await listCaptures(page)).map((c) => c.id));
        await page.getByRole('button', { name: 'Capture screenshot' }).click();
        const fresh = async () => (await listCaptures(page)).filter((c) => !known.has(c.id));
        await expect.poll(async () => (await fresh()).length > 0 && !(await page.getByText('Capturing the preview…').isVisible()), { timeout: 60_000 }).toBe(true);
        return fresh();
      };
      // Before: the defect (fix undone).
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect.poll(() => overflow(page)).toBeGreaterThan(0);
      const before = await shoot();
      // After: the fix re-applied.
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect.poll(() => overflow(page)).toBeLessThanOrEqual(0);
      const after = await shoot();
      for (const [shots, edits] of [[before, 0], [after, 1]] as const) {
        expect(shots.some((c) => c.kind === 'raster'), 'live DOM raster of the canvas').toBe(true);
        for (const c of shots) expect(c).toMatchObject({ changes: edits, w: 540, posture: 'folded', png: true });
      }
      // Compare like with like: Chromium (deterministic) when both have it, else the DOM rasters.
      const kind = before.some((c) => c.kind === 'chromium') && after.some((c) => c.kind === 'chromium') ? 'chromium' : 'raster';
      const a = before.find((c) => c.kind === kind)!.id;
      const b = after.find((c) => c.kind === kind)!.id;

      // In the responsive diff they are one edit apart and their pixels differ.
      await runCommand(page, 'Open responsive diff & screenshots');
      await page.getByLabel('Capture A').selectOption(a);
      await page.getByLabel('Capture B').selectOption(b);
      await expect(page.getByText('+1 edit', { exact: true })).toBeVisible();
      await page.getByRole('radio', { name: /Pixels/ }).click();
      const pct = page.getByText(/^\d+\.\d\d% changed$/);
      await expect(pct).toBeVisible({ timeout: 30_000 });
      expect(parseFloat((await pct.textContent())!), 'before and after differ').toBeGreaterThan(0);
    });

    await step('13. Review the generated code changes', async () => {
      await page.getByRole('button', { name: 'Export changes' }).click();
      const panel = page.getByTestId('export-panel');
      await expect(panel).toBeVisible();
      await expect(panel.getByText('1 exact', { exact: true })).toBeVisible({ timeout: 20_000 }); // mapped exactly to source
      const files = panel.getByTestId('diff-file');
      await expect(files).toHaveCount(1);
      await expect(files.first()).toHaveAttribute('data-path', 'src/styles/login.css');
      // One hunk replacing the authored declaration in place.
      const text = await files.first().innerText();
      expect(text).toMatch(/@@ −\d+,\d+ \+\d+,\d+ @@/);
      expect(text).toMatch(/−\s*\n\s*width: 560px;/);
      expect(text).toMatch(/\+\s*\n\s*width: 100%;/);
      expect(text.match(/^[+−]$/gm)).toHaveLength(2);
    });

    await step('14. Export a patch or QA report', async () => {
      const panel = page.getByTestId('export-panel');
      const patch = await download(page, () => panel.getByRole('button', { name: '.patch' }).click());
      expect(patch.name).toBe('harborline-mortgage-ifdy.patch');
      expect(patch.text).toMatch(/^diff --git a\/src\/styles\/login\.css b\/src\/styles\/login\.css$/m);
      expect(patch.text).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@/m);
      expect(patch.text).toMatch(/^-  width: 560px;$/m);
      expect(patch.text).toMatch(/^\+  width: 100%;$/m);
      expect(patch.text).toMatch(/^ {3}gap: var\(--hl-space-3\);$/m); // context from the .rate-banner rule
      expect(patch.text.match(/^[-+](?![-+])/gm)).toHaveLength(2);

      await runCommand(page, 'Open responsive QA report');
      const report = page.getByTestId('report-doc');
      await expect(report).toBeVisible();
      const html = await download(page, () => report.getByTestId('report-download').click());
      const counts = await store(page, (s) => ({ responsive: s.responsiveIssues.length, captures: s.captures.length }));
      expect(html.name).toBe('harborline-mortgage-qa-report.html');
      expect(html.text).toMatch(/^<!doctype html>/i);
      expect(html.text).toContain('<h1>Responsive QA report</h1>');
      expect(html.text).toContain('Harborline Mortgage');
      expect(html.text).toContain('<h2>Changes <span class="n">1</span></h2>');
      expect(html.text).toContain('.rate-banner: width 560px → 100%');
      expect(html.text).toContain(`<h2>Responsive issues <span class="n">${counts.responsive}</span></h2>`);
      expect(html.text).toContain(`<h2>Accessibility findings <span class="n">${a11yCount}</span></h2>`);
      expect(html.text).toContain('color-contrast');
      expect(html.text).toContain(scenarioName);
      expect(html.text).toMatch(/<h2>Screenshots <span class="n">[1-9]\d*<\/span><\/h2>/);
      expect(html.text).toContain('data:image/png;base64,');
    });

    await step('15. Reopen the project with its saved configuration intact', async () => {
      // Leave the device unfolded so the restored posture is not the default one.
      await page.getByRole('tab', { name: 'Canvas', exact: true }).click();
      await posture.getByRole('radio', { name: 'Expanded' }).click();
      await expect(iframe).toHaveAttribute('style', /width: 1114px/, { timeout: 8000 });
      await expect.poll(() => store(page, (s) => [s.viewport.posture, s.saveStatus]), { timeout: 10_000 }).toEqual(['expanded', 'saved']);
      await expect(page.locator('[data-status="saved"]')).toBeVisible();
      const saved = await store(page, (s) => ({ captures: s.captures.length, a11y: s.a11yIssues.length, responsive: s.responsiveIssues.length }));

      await page.reload();
      await page.getByText('Recent projects').waitFor();
      expect(await store(page, (s) => s.project)).toBeNull();
      await page.getByRole('button', { name: /^Harborline Mortgage \d/ }).click();
      await expect(page.getByText(/Restored “Harborline Mortgage”/)).toBeVisible();
      await expect(frame.locator('[data-testid="login-submit"]')).toBeVisible();

      const restored = await store(page, (s) => ({
        viewport: s.viewport,
        changes: s.changes.map((c: { kind: string; property: string; before: string; after: string }) => ({ kind: c.kind, property: c.property, before: c.before, after: c.after })),
        captures: s.captures.length,
        scenarios: s.scenarios.filter((x: { builtIn: boolean }) => !x.builtIn).map((x: { name: string }) => x.name),
        a11y: s.a11yIssues.length,
        responsive: s.responsiveIssues.length,
      }));
      expect(restored.viewport).toMatchObject({ deviceId: 'surface-duo', posture: 'expanded', orientation: 'portrait' });
      expect(restored.changes).toEqual([{ kind: 'rule', property: 'width', before: '560px', after: '100%' }]);
      expect(restored.scenarios).toEqual([scenarioName]);
      expect({ captures: restored.captures, a11y: restored.a11y, responsive: restored.responsive }).toEqual(saved);
      // The UI reflects it: unfolded device, one edit.
      await expect(iframe).toHaveAttribute('style', /width: 1114px/, { timeout: 8000 });
      await expect(posture.getByRole('radio', { name: 'Expanded' })).toBeChecked();
      await expect(page.getByText('1 edit', { exact: true })).toBeVisible();
      // The saved edit is re-applied to the fresh page: folded, the banner no longer overflows.
      await posture.getByRole('radio', { name: 'Folded' }).click();
      await expect(iframe).toHaveAttribute('style', /width: 540px/, { timeout: 8000 });
      await expect.poll(() => overflow(page)).toBeLessThanOrEqual(0);
      const edge = await bannerEdge(page);
      expect(edge.right).toBeLessThanOrEqual(edge.vw);
    });
  });
});
