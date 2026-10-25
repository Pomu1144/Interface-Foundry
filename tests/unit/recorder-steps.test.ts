import { describe, expect, it } from 'vitest';
import type { Scenario, StepAction } from '@shared/types';
import {
  actionHasSecret,
  describeAction,
  duplicateScenario,
  makeStep,
  maskValue,
  moveStep,
  parseScenario,
  redactSecrets,
  resolveActionSecrets,
  resolveSecrets,
  secretNames,
  serializeScenario,
  stepValue,
  testIdLocator,
} from '@/modules/interaction-recorder/steps';

const fixtures = { username: 'demo.borrower', password: 'Harbor!2026' };

function sample(): Scenario {
  return {
    id: 'sc_test',
    name: 'Sign in',
    description: 'Recorded sign-in',
    suite: 'Recorded',
    route: '#/login',
    createdAt: 1_700_000_000_000,
    builtIn: false,
    tags: ['recorded'],
    steps: [
      makeStep({ type: 'fill', locator: testIdLocator('login-username', { role: 'textbox', name: 'Username' }), value: '{{secret:username}}', masked: true }),
      makeStep({ type: 'fill', locator: testIdLocator('login-password'), value: '{{secret:password}}', masked: true }),
      makeStep({ type: 'click', locator: testIdLocator('login-submit', { role: 'button', name: 'Sign in' }), clickCount: 2 }),
      makeStep({ type: 'fold', posture: 'expanded' }, undefined, { expect: 'Value survives', timeout: 6000 }),
      makeStep({ type: 'viewport', state: { deviceId: 'surface-duo', posture: 'expanded', orientation: 'portrait' } }),
      makeStep({ type: 'wait', condition: { kind: 'url', includes: '#/dashboard' }, timeout: 5000 }),
      makeStep({ type: 'assert', assertion: { kind: 'value', locator: testIdLocator('login-username'), value: '{{secret:username}}' } }),
      makeStep({ type: 'assert', assertion: { kind: 'no-horizontal-overflow' } }),
      makeStep({ type: 'screenshot', label: 'Dashboard' }),
    ],
  };
}

describe('step serialisation', () => {
  it('round-trips a scenario through JSON without losing steps', () => {
    const sc = sample();
    const back = parseScenario(serializeScenario(sc));
    expect(back).toEqual({ ...sc, builtIn: false });
    expect(back.steps.map((s) => s.action.type)).toEqual(['fill', 'fill', 'click', 'fold', 'viewport', 'wait', 'assert', 'assert', 'screenshot']);
  });

  it('never marks imported scenarios as built-in', () => {
    const sc = { ...sample(), builtIn: true };
    expect(parseScenario(serializeScenario(sc)).builtIn).toBe(false);
  });

  it('accepts a bare scenario object and fills defaults', () => {
    const { id: _id, createdAt: _c, ...rest } = sample();
    const back = parseScenario(JSON.stringify({ ...rest, steps: rest.steps.map(({ timeout: _t, ...s }) => s) }));
    expect(back.id).toMatch(/^sc_/);
    expect(back.steps.every((s) => s.timeout === 5000)).toBe(true);
  });

  it('rejects malformed input with a readable error', () => {
    expect(() => parseScenario('not json')).toThrow(/valid JSON/);
    expect(() => parseScenario(JSON.stringify({ name: 'x' }))).toThrow(/steps/);
    expect(() => parseScenario(JSON.stringify({ name: 'x', steps: [{ id: 'a', action: { type: 'teleport' } }] }))).toThrow(/unknown action/);
    expect(() => parseScenario(JSON.stringify({ name: 'x', steps: [{ id: 'a', action: { type: 'click', locator: {} } }] }))).toThrow(/css selector/);
    expect(() => parseScenario(JSON.stringify({ format: 'ifdy.scenario', version: 99, scenario: sample() }))).toThrow(/newer/);
  });

  it('serialised scenarios keep secrets as placeholders', () => {
    const json = serializeScenario(sample());
    expect(json).toContain('{{secret:password}}');
    expect(json).not.toContain('Harbor!2026');
  });

  it('duplicates with fresh ids and an editable copy of built-ins', () => {
    const sc = { ...sample(), builtIn: true, tags: ['built-in'] };
    const copy = duplicateScenario(sc);
    expect(copy.builtIn).toBe(false);
    expect(copy.id).not.toBe(sc.id);
    expect(copy.steps.map((s) => s.id)).not.toEqual(sc.steps.map((s) => s.id));
    expect(copy.tags).not.toContain('built-in');
  });

  it('reorders steps', () => {
    expect(moveStep(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveStep(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveStep(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});

describe('secret masking and resolution', () => {
  it('finds placeholder names', () => {
    expect(secretNames('{{secret:username}} and {{secret:pin-code}}')).toEqual(['username', 'pin-code']);
    expect(secretNames('plain')).toEqual([]);
  });

  it('masks placeholders for display', () => {
    expect(maskValue('{{secret:password}}')).toBe('•••• (password)');
    expect(maskValue('user {{secret:username}}!')).toBe('user •••• (username)!');
  });

  it('resolves from fixtures and reports missing ones without guessing', () => {
    expect(resolveSecrets('{{secret:username}}', fixtures)).toEqual({ value: 'demo.borrower', missing: [], used: { username: 'demo.borrower' } });
    const r = resolveSecrets('{{secret:otp}}', fixtures);
    expect(r.missing).toEqual(['otp']);
    expect(r.value).toBe('{{secret:otp}}');
  });

  it('deep-resolves fill values and assertion values', () => {
    const a: StepAction = { type: 'assert', assertion: { kind: 'value', locator: testIdLocator('x'), value: '{{secret:password}}' } };
    const r = resolveActionSecrets(a, fixtures);
    expect(r.action).toEqual({ type: 'assert', assertion: { kind: 'value', locator: testIdLocator('x'), value: 'Harbor!2026' } });
    expect(r.used).toEqual({ password: 'Harbor!2026' });
    // The original action is untouched.
    expect((a as { assertion: { value: string } }).assertion.value).toBe('{{secret:password}}');
  });

  it('redacts resolved values from errors and console text', () => {
    const msg = 'Expected value “Harbor!2026”, got “Harbor!2026x” for demo.borrower';
    expect(redactSecrets(msg, fixtures)).toBe('Expected value “{{secret:password}}”, got “{{secret:password}}x” for {{secret:username}}');
  });

  it('describes masked steps without the value', () => {
    const fill: StepAction = { type: 'fill', locator: testIdLocator('login-password'), value: '{{secret:password}}', masked: true };
    expect(describeAction(fill)).not.toContain('secret');
    expect(describeAction(fill)).toContain('•••••');
    expect(stepValue(fill)).toBe('•••• (password)');
    expect(actionHasSecret(fill)).toBe(true);
    expect(describeAction({ type: 'click', locator: testIdLocator('s', { role: 'button', name: 'Submit payment' }), clickCount: 2 })).toBe('Double-click button “Submit payment”');
  });
});
