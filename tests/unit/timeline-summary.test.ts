import { describe, expect, it } from 'vitest';
import type { Scenario, ScenarioRun, StepResult, ViewportContext } from '@shared/types';
import { makeStep, testIdLocator } from '@/modules/interaction-recorder/steps';
import { buildReproSteps, compareRuns, latestRuns, reproSentence, runCellKey, stepOffsets, summarizeRuns } from '@/modules/interaction-replayer/summary';

const duo: ViewportContext = { deviceId: 'surface-duo', deviceName: 'Surface Duo', posture: 'expanded', orientation: 'portrait', width: 1114, height: 720 };
const iphone: ViewportContext = { deviceId: 'iphone-16-pro', deviceName: 'iPhone 16 Pro', posture: 'folded', orientation: 'portrait', width: 402, height: 778 };

const steps = [
  makeStep({ type: 'fill', locator: testIdLocator('login-username', { role: 'textbox', name: 'Username' }), value: '{{secret:username}}', masked: true }),
  makeStep({ type: 'fold', posture: 'expanded' }),
  makeStep({ type: 'assert', assertion: { kind: 'focused', locator: testIdLocator('login-username', { role: 'textbox', name: 'Username' }) } }, undefined, { expect: 'Focus survives the unfold' }),
  makeStep({ type: 'click', locator: testIdLocator('login-submit', { role: 'button', name: 'Sign in' }) }),
];
const scenario: Scenario = { id: 'sc1', name: 'Resize', description: '', route: '#/login', steps, createdAt: 0, builtIn: false, tags: [] };

function run(id: string, status: ScenarioRun['status'], results: Partial<StepResult>[], extra: Partial<ScenarioRun> = {}): ScenarioRun {
  return {
    id,
    scenarioId: 'sc1',
    scenarioName: 'Resize',
    viewport: duo,
    startedAt: 1000,
    finishedAt: 1000 + results.reduce((n, r) => n + (r.durationMs ?? 0), 0),
    status,
    steps: steps.map((s, i) => ({ stepId: s.id, status: 'passed', durationMs: 100, ...results[i] }) as StepResult),
    issues: [],
    consoleErrors: [],
    ...extra,
  };
}

describe('reproduction steps', () => {
  it('numbers plain-language steps up to the first failure and states expected vs actual', () => {
    const r = run('r1', 'failed', [{}, {}, { status: 'failed', error: 'Expected textbox “Username” to be focused' }, { status: 'skipped' }]);
    const lines = buildReproSteps(scenario, r, { routeLabel: (p) => (p === '#/login' ? 'Sign in' : p) });
    expect(lines[0]).toBe('Open Sign in on Surface Duo (expanded, portrait, 1114×720 CSS px) from a fresh page load.');
    expect(lines[1]).toBe('Type the synthetic fixture value “username” into the textbox “Username”.');
    expect(lines[2]).toBe('Unfold the device to its expanded posture.');
    expect(lines[3]).toContain('Check that textbox “Username” has focus.');
    expect(lines[3]).toContain('Expected: Focus survives the unfold. Actual: Expected textbox “Username” to be focused.');
    expect(lines).toHaveLength(4);
  });

  it('includes every executed step for passing runs and never reveals secrets', () => {
    const lines = buildReproSteps(scenario, run('r2', 'passed', [{}, {}, {}, {}]));
    expect(lines).toHaveLength(5);
    expect(lines.join(' ')).not.toMatch(/demo\.borrower|Harbor/);
    expect(lines[4]).toBe('Click the button “Sign in”.');
  });

  it('describes double-clicks and keys', () => {
    expect(reproSentence({ type: 'click', locator: testIdLocator('x', { role: 'button', name: 'Retry payment' }), clickCount: 2 })).toBe('Double-click the button “Retry payment”.');
    expect(reproSentence({ type: 'press', key: 'Shift+Tab' })).toBe('Press Shift+Tab.');
  });
});

describe('run aggregation', () => {
  const runs: ScenarioRun[] = [
    run('a', 'passed', [{}, {}, {}, {}], { startedAt: 1000, finishedAt: 2000 }),
    run('b', 'failed', [{}, {}, { status: 'failed', error: 'x' }, { status: 'skipped' }], { startedAt: 3000, finishedAt: 4500, consoleErrors: ['boom'], issues: [{ id: 'i', rule: 'overflow', title: 'Overflow', severity: 'serious', message: '', selector: 'body', viewport: duo, evidence: {}, classification: 'regression' }] }),
    run('c', 'aborted', [{}, { status: 'skipped' }, { status: 'skipped' }, { status: 'skipped' }], { viewport: iphone, startedAt: 5000, finishedAt: 5200 }),
  ];

  it('summarises statuses, steps, issues and console errors', () => {
    const s = summarizeRuns(runs);
    expect(s).toMatchObject({ total: 3, passed: 1, failed: 1, aborted: 1, running: 0, issues: 1, consoleErrors: 1, scenarios: 1, viewports: 2, durationMs: 1000 + 1500 + 200 });
    expect(s.passRate).toBe(0.5);
    expect(s.steps).toEqual({ total: 12, passed: 7, failed: 1, skipped: 4 });
  });

  it('keeps only the latest run per scenario × viewport', () => {
    const map = latestRuns(runs);
    expect(map.size).toBe(2);
    expect(map.get(runCellKey('sc1', duo))?.id).toBe('b');
    expect(map.get(runCellKey('sc1', iphone))?.id).toBe('c');
  });

  it('handles an empty set', () => {
    expect(summarizeRuns([])).toMatchObject({ total: 0, passRate: null, durationMs: 0 });
  });

  it('computes step offsets from durations', () => {
    expect(stepOffsets([{ durationMs: 100 }, { durationMs: 250 }, { durationMs: 0 }])).toEqual([0, 100, 350]);
  });

  it('compares two runs step by step', () => {
    const a = run('a', 'failed', [{ durationMs: 100 }, { durationMs: 900 }, { status: 'failed', error: 'x', durationMs: 2000 }, { status: 'skipped', durationMs: 0 }]);
    const b = run('b', 'passed', [{ durationMs: 120 }, { durationMs: 700 }, { durationMs: 30 }, { durationMs: 80 }]);
    const cmp = compareRuns(a, b, scenario);
    expect(cmp.statusChanged).toBe(true);
    expect(cmp.steps.map((s) => s.change)).toEqual(['same', 'same', 'fixed', 'changed']);
    expect(cmp.steps[0].deltaMs).toBe(20);
    expect(cmp.steps[3].deltaMs).toBeNull();
    expect(cmp.durationDeltaMs).toBe(930 - 3000);
  });
});
