import { describe, expect, it } from 'vitest';
import { parsePatch, applyPatch } from 'diff';
import type { Change } from '@shared/types';
import { buildSourcePatch, diffFile, relativeHref } from '@/modules/export-engine/patch';

const vp = { deviceId: 'iphone', deviceName: 'iPhone 16 Pro', posture: 'folded', orientation: 'portrait', width: 402, height: 874 } as const;
let n = 0;
const ch = (p: Partial<Change> & Pick<Change, 'kind' | 'property' | 'after'>): Change =>
  ({
    id: `c${++n}`,
    before: null,
    scope: 'element',
    viewport: vp,
    timestamp: n,
    origin: 'inspector',
    exportStatus: 'pending',
    experiment: false,
    target: { selector: 'body', label: 'body' },
    ...p,
  }) as Change;

const FILES = [
  {
    path: 'index.html',
    text: '<!doctype html>\n<html>\n  <head>\n    <link rel="stylesheet" href="src/styles/base.css" />\n    <link rel="stylesheet" href="src/styles/login.css" />\n  </head>\n  <body>\n    <h1 class="title">Sign in to Harborline</h1>\n    <p>Welcome</p><p>Welcome</p>\n    <img src="assets/a.png" alt="Old alt">\n  </body>\n</html>\n',
  },
  { path: 'src/styles/base.css', text: ':root {\n  --hl-color-navy: #0b2545;\n  --hl-space-4: 16px;\n}\n\nbody {\n  margin: 0;\n}\n' },
  {
    path: 'src/styles/login.css',
    text: '.login-form {\n  display: grid;\n  gap: 12px;\n}\n\n.login-form .btn {\n  color: white;\n}\n\n@media (min-width: 700px) {\n  .login-form {\n    gap: 16px;\n  }\n}\n',
  },
  { path: 'src/components/login-page.js', text: 'export const view = () => html`<p class="lead">Manage your mortgage</p>`;\n' },
];

const applyAll = (unified: string, files = FILES) => {
  const out = new Map(files.map((f) => [f.path, f.text]));
  for (const p of parsePatch(unified)) {
    const path = (p.newFileName ?? '').replace(/^b\//, '');
    const before = p.oldFileName === '/dev/null' ? '' : out.get(path) ?? '';
    const next = applyPatch(before, p);
    expect(next).not.toBe(false);
    out.set(path, next as string);
  }
  return out;
};

describe('buildSourcePatch', () => {
  it('maps rule edits, disables and media-nested rules exactly', () => {
    const p = buildSourcePatch({
      now: 0,
      files: FILES,
      changes: [
        ch({ kind: 'rule', scope: 'selector', property: 'gap', before: '12px', after: '20px', target: { selector: 'form.login-form', label: 'form', ruleKey: '2:0', ruleSelector: '.login-form', ruleSource: 'login.css:1' } }),
        ch({ kind: 'rule', scope: 'selector', property: 'display', before: 'grid', after: null, target: { selector: 'form.login-form', label: 'form', ruleKey: '2:0', ruleSelector: '.login-form', ruleSource: 'login.css:1' } }),
        ch({ kind: 'rule', scope: 'selector', property: 'gap', before: '16px', after: '24px', target: { selector: 'form.login-form', label: 'form', ruleKey: '2:2.0', ruleSelector: '.login-form', ruleSource: 'login.css:11', ruleMedia: ['(min-width: 700px)'] } }),
      ],
    });
    expect(p.unmapped).toEqual([]);
    expect(p.files.map((f) => f.path)).toEqual(['src/styles/login.css']);
    const login = applyAll(p.unified).get('src/styles/login.css')!;
    expect(login).toContain('.login-form {\n  /* display: grid; */\n  gap: 20px;\n}');
    expect(login).toContain('@media (min-width: 700px) {\n  .login-form {\n    gap: 24px;\n  }\n}');
    expect(p.files[0].hunks.flatMap((h) => h.labels.map((l) => l.reliability))).toEqual(expect.arrayContaining(['exact']));
    expect(p.stats.exact).toBe(3);
  });

  it('modifies or appends selector-scoped style edits', () => {
    const p = buildSourcePatch({
      now: 0,
      files: FILES,
      changes: [
        ch({ kind: 'style', scope: 'selector', property: 'color', before: 'white', after: 'var(--hl-color-navy)', target: { selector: '.login-form .btn', label: 'button' } }),
        ch({ kind: 'style', scope: 'selector', property: 'padding', before: '0px', after: '8px', target: { selector: 'button.login-form__submit', label: 'button' } }),
        ch({ kind: 'style', scope: 'selector', property: 'border-radius', before: '0px', after: '8px', target: { selector: 'button.login-form__submit', label: 'button' } }),
        ch({ kind: 'style', scope: 'selector', property: 'gap', before: '12px', after: '4px', media: '(min-width: 700px)', target: { selector: 'form.login-form', label: 'form' } }),
      ],
    });
    const login = applyAll(p.unified).get('src/styles/login.css')!;
    expect(login).toContain('.login-form .btn {\n  color: var(--hl-color-navy);\n}');
    // Both declarations of the new selector land in one appended rule, in the file that owns `.login-form`.
    expect(login).toContain('button.login-form__submit {\n  padding: 8px;\n  border-radius: 8px;\n}');
    // Media-scoped edit is inserted into the existing @media block.
    expect(login).toMatch(/@media \(min-width: 700px\) \{\n {2}\.login-form \{\n {4}gap: 16px;\n {2}\}\n\n {2}form\.login-form \{\n {4}gap: 4px;\n {2}\}\n\}/);
    const labels = p.files.flatMap((f) => f.hunks.flatMap((h) => h.labels.map((l) => l.label)));
    expect(labels.some((l) => l.startsWith('exact — selector rule matched'))).toBe(true);
    expect(labels).toContain('appended rule to login.css');
  });

  it('puts element-scoped overrides into ifdy-overrides.css and links it', () => {
    const p = buildSourcePatch({
      now: 0,
      files: FILES,
      entry: 'index.html',
      changes: [
        ch({ kind: 'style', property: 'margin-top', before: '0px', after: '24px', target: { selector: 'main > h1.title', label: 'h1' } }),
        ch({ kind: 'visibility', property: 'display', before: 'visible', after: 'hidden', target: { selector: '#promo', label: 'div' } }),
      ],
    });
    const out = applyAll(p.unified);
    expect(out.get('ifdy-overrides.css')).toContain('main > h1.title {\n  margin-top: 24px;\n}');
    expect(out.get('ifdy-overrides.css')).toContain('#promo {\n  display: none;\n}');
    expect(out.get('index.html')).toContain('<link rel="stylesheet" href="src/styles/login.css" />\n    <link rel="stylesheet" href="ifdy-overrides.css" />');
    const overrides = p.files.find((f) => f.path === 'ifdy-overrides.css')!;
    expect(overrides.isNew).toBe(true);
    expect(overrides.unified).toMatch(/^diff --git a\/ifdy-overrides.css b\/ifdy-overrides.css\nnew file mode 100644\n--- \/dev\/null\n\+\+\+ b\/ifdy-overrides.css\n@@ -0,0 \+1,\d+ @@/);
    expect(overrides.hunks[0].labels[0]).toMatchObject({ reliability: 'appended', label: 'appended override' });
  });

  it('updates token declarations in :root and appends unknown tokens', () => {
    const p = buildSourcePatch({
      now: 0,
      files: FILES,
      changes: [
        ch({ kind: 'token', property: '--hl-color-navy', before: '#0b2545', after: '#123456', target: { selector: ':root', label: ':root' } }),
        ch({ kind: 'token', property: '--hl-brand-new', before: null, after: '4px', target: { selector: ':root', label: ':root' } }),
      ],
    });
    const base = applyAll(p.unified).get('src/styles/base.css')!;
    expect(base).toContain('--hl-color-navy: #123456;');
    expect(base).toContain('--hl-space-4: 16px;\n  --hl-brand-new: 4px;\n}');
    expect(p.reliabilityById).toMatchObject({ [p.mappedChangeIds[0]]: 'exact' });
  });

  it('edits unique text only and explains everything else', () => {
    const p = buildSourcePatch({
      now: 0,
      files: FILES,
      changes: [
        ch({ kind: 'text', property: 'textContent', before: 'Sign in to Harborline', after: 'Sign in & pay', target: { selector: 'h1', label: 'h1' } }),
        ch({ kind: 'text', property: 'textContent', before: 'Welcome', after: 'Hi', target: { selector: 'p', label: 'p' } }),
        ch({ kind: 'text', property: 'textContent', before: 'Manage your   mortgage', after: 'Manage your loan', target: { selector: 'p.lead', label: 'p' } }),
        ch({ kind: 'text', property: 'textContent', before: 'Rendered from JSON', after: 'x', target: { selector: 'p.x', label: 'p' } }),
        ch({ kind: 'attribute', property: 'alt', before: 'Old alt', after: 'Harborline home', target: { selector: 'img', label: 'img' } }),
        ch({ kind: 'asset', property: 'src', before: 'assets/a.png', after: 'data:image/png;base64,AAAA', target: { selector: 'img', label: 'img' } }),
      ],
    });
    const out = applyAll(p.unified);
    expect(out.get('index.html')).toContain('<h1 class="title">Sign in &amp; pay</h1>');
    expect(out.get('index.html')).toContain('alt="Harborline home"');
    expect(out.get('src/components/login-page.js')).toContain('Manage your loan');
    const reasons = p.unmapped.map((u) => u.reason);
    expect(reasons.some((r) => /appears 2×/.test(r))).toBe(true);
    expect(reasons.some((r) => /not found in static sources/.test(r))).toBe(true);
    expect(reasons.some((r) => /binary files are not part of text patches/.test(r))).toBe(true);
    const js = p.files.find((f) => f.path.endsWith('login-page.js'))!;
    expect(js.hunks[0].labels[0].reliability).toBe('review');
  });

  it('falls back to overrides when there is no source access', () => {
    const p = buildSourcePatch({
      now: 0,
      files: null,
      changes: [
        ch({ kind: 'rule', scope: 'selector', property: 'color', before: 'red', after: 'blue', target: { selector: 'a', label: 'a', ruleKey: '0:1', ruleSelector: '.nav a', ruleSource: 'app.css:4', ruleMedia: ['(max-width: 600px)'] } }),
        ch({ kind: 'token', property: '--x', before: '1px', after: '2px', target: { selector: ':root', label: ':root' } }),
        ch({ kind: 'text', property: 'textContent', before: 'a', after: 'b' }),
      ],
    });
    expect(p.noSources).toBe(true);
    expect(p.files.map((f) => f.path)).toEqual(['ifdy-overrides.css']);
    expect(p.files[0].after).toContain(':root {\n  --x: 2px;\n}');
    expect(p.files[0].after).toContain('@media (max-width: 600px) {\n  .nav a {\n    color: blue;\n  }\n}');
    expect(p.unmapped).toHaveLength(1);
  });

  it('skips experiments, no-ops and committed changes', () => {
    const p = buildSourcePatch({
      files: FILES,
      changes: [
        ch({ kind: 'style', property: 'color', before: 'red', after: 'blue', experiment: true }),
        ch({ kind: 'style', property: 'color', before: 'red', after: 'red', target: { selector: 'p', label: 'p' } }),
        ch({ kind: 'style', property: 'color', before: 'red', after: 'green', exportStatus: 'committed', target: { selector: 'a', label: 'a' } }),
      ],
    });
    expect(p.files).toEqual([]);
  });
});

describe('diff generation', () => {
  it('creates git-compatible unified diffs with correct hunk headers', () => {
    const before = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    const after = before.replace('line 6\n', 'line 6\ninserted\n').replace('line 12\n', 'line twelve\n');
    const f = diffFile('a.txt', before, after);
    expect(f.additions).toBe(2);
    expect(f.deletions).toBe(1);
    expect(f.unified.startsWith('diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -4,9 +4,10 @@')).toBe(true);
    expect(applyPatch(before, f.unified)).toBe(after);
  });

  it('computes relative hrefs', () => {
    expect(relativeHref('index.html', 'ifdy-overrides.css')).toBe('ifdy-overrides.css');
    expect(relativeHref('pages/a/b.html', 'ifdy-overrides.css')).toBe('../../ifdy-overrides.css');
    expect(relativeHref('pages/a.html', 'pages/x.css')).toBe('x.css');
  });
});

describe('idempotent re-export', () => {
  it('does not rewrite what the source already says or re-append existing overrides', () => {
    const changes = [
      ch({ kind: 'style', property: 'margin-top', before: '0px', after: '24px', target: { selector: 'main > h1.title', label: 'h1' } }),
      ch({ kind: 'token', property: '--hl-space-4', before: '16px', after: '20px', target: { selector: ':root', label: ':root' } }),
    ];
    const first = buildSourcePatch({ now: 0, files: FILES, entry: 'index.html', changes });
    const applied = [...applyAll(first.unified).entries()].map(([path, text]) => ({ path, text }));
    const second = buildSourcePatch({ now: 0, files: applied, entry: 'index.html', changes });
    expect(second.files).toEqual([]);
    expect(second.stats.inSource).toBe(2);
    expect(second.mappedChangeIds.sort()).toEqual(changes.map((c) => c.id).sort());
    // A changed value edits the existing override rule instead of appending a new block.
    const third = buildSourcePatch({ now: 0, files: applied, entry: 'index.html', changes: [{ ...changes[0], after: '32px' }] });
    expect(third.files.map((f) => f.path)).toEqual(['ifdy-overrides.css']);
    expect(third.files[0].after.match(/main > h1\.title/g)).toHaveLength(1);
    expect(third.files[0].after).toContain('margin-top: 32px;');
  });
});
