import { describe, expect, it } from 'vitest';
import { buttonName, ClickTracker, isComposingKey, isPasteShortcut, mapPoint, modifiersOf, normalizeWheel, quantize, screencastSize } from '@/modules/preview-runtime/remote/input';
import { decodeFrame, encodeFrame, isAllowedRemoteUrl, type FrameHeader } from '@/modules/preview-runtime/remote/protocol';
import { isSensitiveParam, redactText, redactUrl } from '../../server/browser/redact';
import { pngSize } from '../../server/browser/capture';

describe('input coordinate mapping', () => {
  it('maps through a scaled canvas (canvas zoom / wall tile scale)', () => {
    // 540×720 CSS viewport displayed at 50% at (100, 50).
    const box = { left: 100, top: 50, width: 270, height: 360 };
    expect(mapPoint(235, 230, box, { width: 540, height: 720 })).toEqual({ x: 270, y: 360, inside: true });
  });

  it('maps a zoomed-out mobile layout (980 CSS px shown in a 400px device viewport)', () => {
    const box = { left: 0, top: 0, width: 400, height: 800 };
    const p = mapPoint(224.5, 142.9, box, { width: 980, height: 1960 });
    expect(p.x).toBeCloseTo(550, 0);
    expect(p.y).toBeCloseTo(350, 0);
  });

  it('clamps outside points but reports them', () => {
    const p = mapPoint(-20, 900, { left: 0, top: 0, width: 100, height: 100 }, { width: 100, height: 100 });
    expect(p).toEqual({ x: 0, y: 100, inside: false });
  });

  it('applies visual viewport offsets', () => {
    expect(mapPoint(10, 10, { left: 0, top: 0, width: 100, height: 100 }, { width: 100, height: 100 }, { x: 5, y: 7 })).toMatchObject({ x: 15, y: 17 });
  });

  it('encodes modifiers and buttons the CDP way', () => {
    expect(modifiersOf({ altKey: true, ctrlKey: false, metaKey: true, shiftKey: true })).toBe(1 | 4 | 8);
    expect([0, 1, 2, 3, 4, 9].map(buttonName)).toEqual(['left', 'middle', 'right', 'back', 'forward', 'none']);
  });

  it('counts double and triple clicks within time and distance', () => {
    const c = new ClickTracker(500, 5);
    expect(c.down(10, 10, 0, 0)).toBe(1);
    expect(c.down(12, 11, 0, 200)).toBe(2);
    expect(c.down(12, 11, 0, 400)).toBe(3);
    expect(c.down(12, 11, 0, 600)).toBe(3);
    expect(c.down(40, 40, 0, 700)).toBe(1);
    expect(c.down(40, 40, 2, 750)).toBe(1);
    expect(c.down(40, 40, 2, 2000)).toBe(1);
  });

  it('normalises wheel deltas', () => {
    expect(normalizeWheel({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 800)).toEqual({ dx: 0, dy: 48 });
    expect(normalizeWheel({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 800)).toEqual({ dx: 0, dy: 720 });
    expect(normalizeWheel({ deltaX: 0, deltaY: 100, deltaMode: 0, shiftKey: true }, 800)).toEqual({ dx: 100, dy: 0 });
  });

  it('recognises paste and IME keys', () => {
    expect(isPasteShortcut({ key: 'v', ctrlKey: true, metaKey: false })).toBe(true);
    expect(isPasteShortcut({ key: 'v', ctrlKey: false, metaKey: false })).toBe(false);
    expect(isComposingKey({ keyCode: 229 })).toBe(true);
    expect(isComposingKey({ key: 'a', keyCode: 65 })).toBe(false);
  });
});

describe('screencast sizing', () => {
  it('requests displayed size × screen DPR, capped at the device resolution', () => {
    const small = screencastSize({ cssWidth: 540, cssHeight: 720, displayScale: 0.3, screenDpr: 2, deviceDpr: 2.5 });
    expect(small.scale).toBeGreaterThanOrEqual(0.6);
    expect(small.maxWidth).toBe(Math.round(540 * small.scale));
    const big = screencastSize({ cssWidth: 540, cssHeight: 720, displayScale: 2, screenDpr: 2, deviceDpr: 2.5 });
    expect(big.scale).toBe(2.5);
  });

  it('quantises to a 1.25x ladder so zooming does not restart the stream constantly', () => {
    expect(quantize(1)).toBe(1);
    expect(quantize(0.9)).toBe(1);
    expect(quantize(1.01)).toBe(1.25);
    expect(quantize(0.7)).toBe(0.8);
  });
});

describe('binary frame codec', () => {
  it('round-trips header and JPEG bytes', () => {
    const header: FrameHeader = { t: 'frame', pageId: 'wall-surface-duo-folded~ab', width: 540, height: 720, ts: 1.5, pageScale: 1, seq: 7 };
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const out = decodeFrame(encodeFrame(header, jpeg));
    expect(out?.header).toEqual(header);
    expect([...out!.image]).toEqual([...jpeg]);
  });

  it('rejects truncated or foreign payloads', () => {
    expect(decodeFrame(new Uint8Array([0, 0]))).toBeNull();
    expect(decodeFrame(new Uint8Array([0, 0, 0, 50, 1, 2]))).toBeNull();
    const bad = new TextEncoder().encode('{"t":"status"}');
    const buf = new Uint8Array(4 + bad.length);
    new DataView(buf.buffer).setUint32(0, bad.length);
    buf.set(bad, 4);
    expect(decodeFrame(buf)).toBeNull();
  });

  it('only allows http(s) and about:blank', () => {
    expect(isAllowedRemoteUrl('https://example.com')).toBe(true);
    expect(isAllowedRemoteUrl('about:blank')).toBe(true);
    expect(isAllowedRemoteUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedRemoteUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('network redaction', () => {
  it('redacts sensitive query and fragment parameters, keeps the rest', () => {
    const r = redactUrl('https://api.example.com/v1/loan?account=12345678&page=2&access_token=abc.def&ssn=123-45-6789');
    expect(r.redacted).toBe(true);
    expect(r.url).toContain('page=2');
    expect(r.url).not.toMatch(/12345678|abc\.def|123-45-6789/);
    const h = redactUrl('https://app.example.com/cb#access_token=xyz&state=1&tab=a');
    expect(h.url).not.toContain('xyz');
    expect(h.url).toContain('tab=a');
  });

  it('removes embedded credentials and shortens data URLs', () => {
    expect(redactUrl('https://user:pw@host.example/x').url).toBe('https://host.example/x');
    expect(redactUrl('data:image/png;base64,AAAA').url).toMatch(/^data:image\/png;… \(\d+ chars\)$/);
  });

  it('classifies parameter names', () => {
    for (const n of ['token', 'sessionId', 'API_KEY', 'password', 'account_number', 'key', 'ssn', 'sig']) expect(isSensitiveParam(n)).toBe(true);
    for (const n of ['page', 'q', 'lang', 'sort']) expect(isSensitiveParam(n)).toBe(false);
  });

  it('scrubs secrets from console text', () => {
    expect(redactText('login password=hunter22 ok')).toBe('login password=[redacted] ok');
    expect(redactText('Authorization: Bearer abc.def.ghi')).not.toContain('abc.def');
  });

  it('reads PNG dimensions', () => {
    const png = new Uint8Array(24);
    const dv = new DataView(png.buffer);
    dv.setUint32(16, 1206);
    dv.setUint32(20, 2622);
    expect(pngSize(png)).toEqual({ width: 1206, height: 2622 });
  });
});
