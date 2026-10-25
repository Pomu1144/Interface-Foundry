import { describe, expect, it } from 'vitest';
import type { ScenarioRun } from '@shared/types';
import { DEMO_ROUTES } from '@/modules/project-adapter/projects';
import { FINANCIAL_SCENARIOS, FINANCIAL_SUITES, isFinancialScenario } from '@/modules/financial-ux-suite/scenarios';
import { buildTestReport, escapeHtml, SCOPE_NOTE } from '@/modules/financial-ux-suite/report';
import { parseScenario, serializeScenario, stepLocator, validateStep } from '@/modules/interaction-recorder/steps';

describe('built-in financial UX suite', () => {
  it('covers every suite from the spec', () => {
    expect(new Set(FINANCIAL_SCENARIOS.map((s) => s.suite))).toEqual(new Set(FINANCIAL_SUITES));
    expect(FINANCIAL_SUITES).toEqual(['Login', 'Payment review', 'Mortgage statement', 'Account maintenance', 'Session recovery']);
  });

  it('has unique, stable ids and valid steps', () => {
    const ids = FINANCIAL_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const sc of FINANCIAL_SCENARIOS) {
      expect(sc.builtIn).toBe(true);
      expect(isFinancialScenario(sc)).toBe(true);
      expect(sc.steps.length).toBeGreaterThan(3);
      const stepIds = sc.steps.map((s) => s.id);
      expect(new Set(stepIds).size).toBe(stepIds.length);
      sc.steps.forEach((s, i) => expect(() => validateStep(s, i)).not.toThrow());
      expect(parseScenario(serializeScenario(sc)).steps).toEqual(sc.steps);
    }
  });

  it('starts every scenario on a demo route', () => {
    const routes = new Set(DEMO_ROUTES.map((r) => r.path));
    for (const sc of FINANCIAL_SCENARIOS) expect(routes.has(sc.route!)).toBe(true);
  });

  it('never embeds the synthetic credentials (fixtures are placeholders)', () => {
    const json = JSON.stringify(FINANCIAL_SCENARIOS);
    expect(json).not.toContain('Harbor!2026');
    expect(json).not.toContain('demo.borrower');
    expect(json).toContain('{{secret:password}}');
    for (const sc of FINANCIAL_SCENARIOS)
      for (const s of sc.steps) if (s.action.type === 'fill' && s.action.value.includes('{{secret:')) expect(s.action.masked).toBe(true);
  });

  it('targets elements by data-testid where one exists', () => {
    const locators = FINANCIAL_SCENARIOS.flatMap((sc) => sc.steps.map((s) => stepLocator(s.action)).filter(Boolean));
    const withTestId = locators.filter((l) => l!.testId).length;
    expect(withTestId / locators.length).toBeGreaterThan(0.8);
  });

  it('includes the key behaviours from the brief', () => {
    const byId = new Map(FINANCIAL_SCENARIOS.map((s) => [s.id, s]));
    const resize = byId.get('fin.login.resize-during-input')!;
    expect(resize.steps.some((s) => s.action.type === 'fold' && s.action.posture === 'expanded')).toBe(true);
    expect(resize.steps.some((s) => s.action.type === 'assert' && s.action.assertion.kind === 'count')).toBe(true);
    const dup = byId.get('fin.payment.duplicate-submission')!;
    expect(dup.steps.filter((s) => s.action.type === 'click' && s.action.clickCount === 2)).toHaveLength(2);
  });
});

describe('test report', () => {
  const sc = FINANCIAL_SCENARIOS[0];
  const run: ScenarioRun = {
    id: 'r1',
    scenarioId: sc.id,
    scenarioName: sc.name,
    viewport: { deviceId: 'surface-duo', deviceName: 'Surface Duo', posture: 'folded', orientation: 'portrait', width: 540, height: 720 },
    startedAt: 1000,
    finishedAt: 3500,
    status: 'failed',
    steps: sc.steps.map((s, i) => ({ stepId: s.id, status: i === 2 ? 'failed' : i > 2 ? 'skipped' : 'passed', durationMs: 50, error: i === 2 ? 'Expected <b>error</b>' : undefined })),
    issues: [],
    consoleErrors: ['[harborline] boom <script>'],
    finalScreenshot: 'data:image/png;base64,AAAA',
  };

  it('builds Markdown, JSON and self-contained HTML with the scope note', () => {
    const r = buildTestReport([run], { scenarios: [sc], projectName: 'Harborline', generatedAt: 0 });
    expect(r.summary).toMatchObject({ total: 1, failed: 1 });
    expect(r.markdown).toContain(SCOPE_NOTE);
    expect(r.markdown).toContain('**Steps to reproduce**');
    expect(r.markdown).toMatch(/\n1\. Open #\/login on Surface Duo/);
    const json = JSON.parse(r.json);
    expect(json.scope).toBe(SCOPE_NOTE);
    expect(json.runs[0].reproduction.length).toBeGreaterThan(1);
    expect(r.html).toContain(escapeHtml(SCOPE_NOTE));
    expect(r.html).not.toContain('<script');
    expect(r.html).toContain('&lt;b&gt;error&lt;/b&gt;');
    expect(r.html).toContain("default-src 'none'");
  });

  it('ignores runs that are still in progress', () => {
    expect(buildTestReport([{ ...run, status: 'running' }]).runs).toHaveLength(0);
  });
});
