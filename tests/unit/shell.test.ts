import { describe, expect, it } from 'vitest';
import type { NodeInfo } from '@shared/types';
import { matchesShortcut } from '@/app/actions';
import { planResize } from '@/modules/canvas/resize';
import { isEnvelope, decodeWindowName, encodeWindowName, ENVELOPE_TAG, PROTOCOL_VERSION } from '@shared/protocol';

const ctrl = navigator.platform.includes('Mac') ? { metaKey: true } : { ctrlKey: true };

describe('shortcuts', () => {
  it('matches modifier shortcuts precisely', () => {
    expect(matchesShortcut({ key: 'z', ...ctrl }, 'Mod+Z')).toBe(true);
    expect(matchesShortcut({ key: 'z', ...ctrl, shiftKey: true }, 'Mod+Z')).toBe(false);
    expect(matchesShortcut({ key: 'Z', ...ctrl, shiftKey: true }, 'Mod+Shift+Z')).toBe(true);
    expect(matchesShortcut({ key: 'f' }, 'F')).toBe(true);
    expect(matchesShortcut({ key: 'f', ...ctrl }, 'F')).toBe(false);
    expect(matchesShortcut({ key: '!', shiftKey: true }, 'Shift+1')).toBe(true);
    expect(matchesShortcut({ key: '+', ...ctrl }, 'Mod+=')).toBe(true);
  });
});

function info(partial: Partial<NodeInfo['layout']>, computed: Record<string, string> = {}): NodeInfo {
  return {
    id: 1,
    tag: 'div',
    label: 'div',
    selector: 'div',
    path: [],
    attrs: [],
    classes: [],
    rect: { x: 0, y: 0, width: 100, height: 40 },
    box: {
      content: { x: 0, y: 0, width: 80, height: 20 },
      padding: { top: 10, right: 10, bottom: 10, left: 10 },
      border: { top: 0, right: 0, bottom: 0, left: 0 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      borderBox: { x: 0, y: 0, width: 100, height: 40 },
      boxSizing: 'content-box',
      position: 'static',
      offsets: { top: NaN, right: NaN, bottom: NaN, left: NaN },
    },
    layout: { display: 'block', isFlexItem: false, isGridItem: false, isPositioned: false, overflowAncestors: [], ...partial },
    computed: { 'box-sizing': 'content-box', width: '80px', ...computed },
    a11y: { role: 'generic', name: '', focusable: false, tabIndex: null, hidden: false, states: [], aria: [] },
    editableText: false,
    isImage: false,
  };
}

describe('CSS-aware resizing', () => {
  it('sizes flex items on the main axis with flex-basis', () => {
    const plan = planResize(info({ isFlexItem: true, flexDirection: 'row' }), 'x', 200, 540);
    expect(plan).toEqual([
      { property: 'flex-basis', value: '180px', note: expect.any(String) },
      { property: 'flex-grow', value: '0' },
    ]);
  });
  it('subtracts padding for content-box elements and keeps px', () => {
    expect(planResize(info({}), 'x', 200, 540)).toEqual([{ property: 'width', value: '180px' }]);
  });
  it('keeps percentage widths relative', () => {
    expect(planResize(info({}, { width: '50%', 'box-sizing': 'border-box' }), 'x', 270, 540)).toEqual([{ property: 'width', value: '50%' }]);
  });
  it('sizes the cross axis normally', () => {
    expect(planResize(info({ isFlexItem: true, flexDirection: 'row' }, { 'box-sizing': 'border-box' }), 'y', 50, 540)).toEqual([{ property: 'height', value: '50px' }]);
  });
});

describe('protocol', () => {
  it('validates envelopes', () => {
    expect(isEnvelope({ [ENVELOPE_TAG]: PROTOCOL_VERSION, session: 's', kind: 'event' })).toBe(true);
    expect(isEnvelope({ [ENVELOPE_TAG]: 99, session: 's', kind: 'event' })).toBe(false);
    expect(isEnvelope({ session: 's', kind: 'event' })).toBe(false);
    expect(isEnvelope('nope')).toBe(false);
  });
  it('round-trips the window-name handshake', () => {
    const name = encodeWindowName('abc123', 'http://localhost:5173');
    expect(decodeWindowName(name)).toEqual({ session: 'abc123', studioOrigin: 'http://localhost:5173' });
    expect(decodeWindowName('other')).toBeNull();
  });
});
