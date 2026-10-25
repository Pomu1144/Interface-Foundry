import { describe, expect, it } from 'vitest';
import { isOpaque, maskDigits, newStats, redactAttrs, redactContext, redactText, redactUrl, restoreSelector, truncate } from '../../src/modules/ai-debugger/redact';
import { context, element } from './ai-fixtures';

describe('redaction', () => {
  it('masks digit runs of 6 or more (account, card and phone numbers)', () => {
    expect(maskDigits('Loan 12345678 due')).toBe('Loan •••••••• due');
    expect(maskDigits('card 4111 1111 1111 1111')).toBe('card •••• •••• •••• ••••');
    expect(maskDigits('call 555-123-4567')).toBe('call •••-•••-••••');
    expect(maskDigits('rate 5.875% for 30 years, 1114px')).toBe('rate 5.875% for 30 years, 1114px');
    expect(maskDigits('12345')).toBe('12345');
  });

  it('detects opaque tokens but not words', () => {
    expect(isOpaque('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc')).toBe(true);
    expect(isOpaque('3f2a9c1e5b7d4a6f8e0c2b4d6f8a0c2e')).toBe(true);
    expect(isOpaque('a1B2c3D4e5F6g7H8i9J0kLmN')).toBe(true);
    expect(isOpaque('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isOpaque('login-form__remember')).toBe(false);
    expect(isOpaque('Refinance rates from today')).toBe(false);
  });

  it('removes form values and reduces URLs to path + hash', () => {
    const stats = newStats();
    const out = redactAttrs(
      [
        ['value', 'Harbor!2026'],
        ['type', 'password'],
        ['href', 'https://bank.example/statement?acct=12345678&token=abc#/pay'],
        ['data-session', 'a1B2c3D4e5F6g7H8i9J0kLmN'],
        ['aria-label', 'Account 987654321'],
        ['data-testid', 'login-submit'],
      ],
      stats,
    );
    expect(out.find(([n]) => n === 'value')).toBeUndefined();
    expect(out).toContainEqual(['type', 'password']);
    expect(out).toContainEqual(['href', '/statement#/pay']);
    expect(out).toContainEqual(['data-session', '[opaque]']);
    expect(out).toContainEqual(['aria-label', 'Account •••••••••']);
    expect(out).toContainEqual(['data-testid', 'login-submit']);
    expect(stats).toMatchObject({ dropped: 1, opaque: 1 });
    expect(stats.masked).toBeGreaterThanOrEqual(1);
  });

  it('truncates long text', () => {
    expect(truncate('x'.repeat(300), 160)).toHaveLength(160);
    expect(redactText('  a   b  ')).toBe('a b');
    expect(redactUrl('http://user:pw@localhost:5188/demo/index.html?x=1#/login')).toBe('/demo/index.html#/login');
  });

  it('redacts a whole context and lets fixes map masked selectors back', () => {
    const ctx = context({
      element: element({ selector: '#acct-12345678 > button', classSelector: 'button.pay', text: 'Pay loan 1234567890 now '.repeat(10), attrs: [['value', 'secret'], ['name', 'amount']] }),
      console: [{ level: 'error', message: 'Failed for account 99887766', count: 1 }],
    });
    const { context: red, stats, selectorMap } = redactContext(ctx);
    expect(red.element.selector).toBe('#acct-•••••••• > button');
    expect(red.element.text!.length).toBeLessThanOrEqual(160);
    expect(red.element.text).not.toMatch(/1234567890/);
    expect(red.element.attrs.find(([n]) => n === 'value')).toBeUndefined();
    expect(red.console[0].message).toBe('Failed for account ••••••••');
    expect(JSON.stringify(red)).not.toMatch(/\d{6,}/);
    expect(stats.masked).toBeGreaterThan(0);
    expect(restoreSelector('#acct-•••••••• > button', selectorMap)).toBe('#acct-12345678 > button');
    // The original context object is not mutated.
    expect(ctx.element.selector).toBe('#acct-12345678 > button');
  });
});
