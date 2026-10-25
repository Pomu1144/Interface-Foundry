import type { A11yIssue, Change, IssueSeverity, ResponsiveIssue, ScenarioRun, ViewportContext } from '@shared/types';
import type { CaptureRef, StudioState } from '@/store';
import { describeChange, effectiveChanges, isNoop } from '@/modules/change-manager/changes';
import { describeSource } from '@/modules/project-adapter/source';

/**
 * Responsive QA report: a self-contained HTML document (inline CSS, images as
 * data URLs, no scripts). The in-app view renders exactly this document.
 */

export type ReportOptions = { captures: boolean; passedRuns: boolean; maxCaptures?: number };

export type ReportModel = {
  project: string;
  source: string;
  generatedAt: number;
  device: string;
  changes: Change[];
  responsive: ResponsiveIssue[];
  a11y: A11yIssue[];
  runs: ScenarioRun[];
  captures: CaptureRef[];
  viewports: { key: string; v: ViewportContext; changes: number; issues: number; runs: number; captures: number }[];
};

export function collectReport(s: Pick<StudioState, 'project' | 'source' | 'changes' | 'responsiveIssues' | 'a11yIssues' | 'runs' | 'captures'> & { deviceName?: string }, opts: ReportOptions): ReportModel {
  const changes = effectiveChanges(s.changes).filter((c) => !isNoop(c));
  const runs = opts.passedRuns ? s.runs : s.runs.filter((r) => r.status !== 'passed');
  const captures = opts.captures ? s.captures.slice(0, opts.maxCaptures ?? 24) : [];
  const vpKey = (v: ViewportContext) => `${v.deviceName}|${v.width}x${v.height}|${v.posture}|${v.orientation}`;
  const vps = new Map<string, ReportModel['viewports'][number]>();
  const bump = (v: ViewportContext | undefined, field: 'changes' | 'issues' | 'runs' | 'captures') => {
    if (!v) return;
    const k = vpKey(v);
    const e = vps.get(k) ?? { key: k, v, changes: 0, issues: 0, runs: 0, captures: 0 };
    e[field]++;
    vps.set(k, e);
  };
  changes.forEach((c) => bump(c.viewport, 'changes'));
  s.responsiveIssues.forEach((i) => bump(i.viewport, 'issues'));
  s.a11yIssues.forEach((i) => bump(i.viewport, 'issues'));
  runs.forEach((r) => bump(r.viewport, 'runs'));
  s.captures.forEach((c) => bump(c.viewport, 'captures'));
  return {
    project: s.project?.name ?? 'Untitled project',
    source: describeSource(s.source),
    generatedAt: Date.now(),
    device: s.deviceName ?? '',
    changes,
    responsive: s.responsiveIssues,
    a11y: s.a11yIssues,
    runs,
    captures,
    viewports: [...vps.values()].sort((a, b) => a.v.width - b.v.width),
  };
}

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const SEVERITY_ORDER: IssueSeverity[] = ['critical', 'serious', 'moderate', 'minor', 'info'];
const vpText = (v: ViewportContext) => `${v.deviceName} · ${v.width}×${v.height}${v.posture === 'expanded' ? ' · expanded' : ''}${v.orientation === 'landscape' ? ' · landscape' : ''}`;
const fmtDate = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const safeImg = (u: string) => (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(u) ? u : '');
const safeUrl = (u: string) => (/^https:\/\//.test(u) ? u : '#');

const CSS = `
:root{--ink:#14161b;--ink-2:#3d414b;--ink-3:#6a6e79;--line:#e3e5ea;--paper:#fff;--soft:#f6f7f9;--accent:#2f6bff;--molten:#e8622c;--ok:#0f8a52;--warn:#a86400;--bad:#c4283a;--violet:#6d4fd1}
*{box-sizing:border-box}
html{background:#eceef2}
body{margin:0;padding:32px 16px 64px;font:13px/1.55 "Geist","Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
.page{max-width:920px;margin:0 auto;background:var(--paper);border-radius:14px;box-shadow:0 1px 2px rgba(20,24,33,.06),0 18px 50px -18px rgba(20,24,33,.25);overflow:hidden}
header{padding:36px 44px 28px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#fbfbfc,#fff)}
.brand{display:flex;align-items:center;gap:8px;color:var(--ink-3);font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.brand i{display:inline-block;width:10px;height:10px;border-radius:3px;background:linear-gradient(135deg,#ff6a3d,#ffb547)}
h1{margin:14px 0 4px;font-size:26px;line-height:1.2;letter-spacing:-.02em}
.sub{color:var(--ink-3);font-size:13px}
.meta{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:16px;color:var(--ink-2);font-size:12px}
.meta b{color:var(--ink);font-weight:600}
main{padding:8px 44px 36px}
section{padding:24px 0 6px;border-top:1px solid var(--line)}
section:first-child{border-top:0}
h2{display:flex;align-items:center;gap:8px;margin:0 0 12px;font-size:15px;letter-spacing:-.01em}
h2 .n{color:var(--ink-3);font-weight:500;font-size:13px}
.tiles{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:20px}
.tile{padding:12px 14px;border:1px solid var(--line);border-radius:10px}
.tile .v{font-size:22px;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.tile .l{color:var(--ink-3);font-size:11px}
.tile .d{margin-top:4px;color:var(--ink-2);font-size:11px}
.note{margin:18px 0 0;padding:10px 12px;border-radius:8px;background:var(--soft);color:var(--ink-2);font-size:12px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{padding:7px 8px;border-bottom:1px solid var(--line);color:var(--ink-3);font-size:10.5px;font-weight:600;letter-spacing:.04em;text-align:left;text-transform:uppercase}
td{padding:8px;border-bottom:1px solid #f0f1f4;vertical-align:top}
tr:last-child td{border-bottom:0}
code{padding:1px 5px;border-radius:4px;background:var(--soft);font:11px/1.5 "Geist Mono",ui-monospace,"SF Mono",Menlo,monospace;color:#444a57;word-break:break-word}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:10.5px;font-weight:600;white-space:nowrap;background:var(--soft);color:var(--ink-2)}
.critical,.serious,.failed,.regression{background:#fde8eb;color:var(--bad)}
.moderate,.suspicious,.aborted,.pending{background:#fff3dc;color:var(--warn)}
.minor,.info,.expected,.exported{background:#e8f0ff;color:var(--accent)}
.passed,.committed{background:#e3f6ec;color:var(--ok)}
.running{background:#efeafc;color:var(--violet)}
.issue{padding:12px 0;border-bottom:1px solid #f0f1f4}
.issue:last-child{border-bottom:0}
.issue .t{display:flex;align-items:center;gap:8px;font-weight:600}
.issue p{margin:4px 0 0;color:var(--ink-2)}
.issue .s{margin-top:6px;color:var(--ink-3);font-size:11.5px}
.empty{padding:10px 0;color:var(--ink-3);font-size:12px}
.shots{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
figure{margin:0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--soft)}
figure img{display:block;width:100%;height:220px;object-fit:contain;object-position:top;background:#fff}
figcaption{padding:8px 10px;font-size:11px;color:var(--ink-2)}
figcaption b{display:block;color:var(--ink);font-size:11.5px}
footer{padding:18px 44px 28px;border-top:1px solid var(--line);color:var(--ink-3);font-size:11px}
a{color:var(--accent)}
@media print{html{background:#fff}body{padding:0}.page{box-shadow:none;border-radius:0;max-width:none}section{break-inside:avoid-page}figure{break-inside:avoid}}
@media (max-width:720px){header,main,footer{padding-left:20px;padding-right:20px}.tiles{grid-template-columns:repeat(2,1fr)}.shots{grid-template-columns:1fr 1fr}}
`;

export function buildReportHtml(m: ReportModel): string {
  const bySeverity = (list: { severity?: IssueSeverity; impact?: IssueSeverity }[]) => {
    const out: Record<string, number> = {};
    for (const i of list) {
      const k = i.severity ?? i.impact ?? 'info';
      out[k] = (out[k] ?? 0) + 1;
    }
    return SEVERITY_ORDER.filter((k) => out[k]).map((k) => `${out[k]} ${k}`).join(' · ') || 'none';
  };
  const changeStatus = { pending: 0, exported: 0, committed: 0 } as Record<string, number>;
  m.changes.forEach((c) => (changeStatus[c.exportStatus] = (changeStatus[c.exportStatus] ?? 0) + 1));
  const passed = m.runs.filter((r) => r.status === 'passed').length;
  const failed = m.runs.filter((r) => r.status === 'failed').length;

  const tiles = [
    { v: m.changes.length, l: 'Changes', d: `${changeStatus.pending} pending · ${changeStatus.committed} committed` },
    { v: m.responsive.length, l: 'Responsive issues', d: bySeverity(m.responsive) },
    { v: m.a11y.length, l: 'Accessibility findings', d: bySeverity(m.a11y) },
    { v: m.runs.length, l: 'Test runs', d: `${passed} passed · ${failed} failed` },
    { v: m.captures.length, l: 'Screenshots', d: 'included below' },
  ];

  const viewports = m.viewports.length
    ? `<table><thead><tr><th>Device</th><th>Viewport</th><th>Posture</th><th>Changes</th><th>Issues</th><th>Runs</th><th>Captures</th></tr></thead><tbody>${m.viewports
        .map((e) => `<tr><td><b>${esc(e.v.deviceName)}</b></td><td>${e.v.width}×${e.v.height}</td><td>${esc(e.v.posture)} · ${esc(e.v.orientation)}</td><td>${e.changes}</td><td>${e.issues}</td><td>${e.runs}</td><td>${e.captures}</td></tr>`)
        .join('')}</tbody></table>`
    : '<div class="empty">No viewport-specific data yet.</div>';

  const changes = m.changes.length
    ? `<table><thead><tr><th>#</th><th>Change</th><th>Origin</th><th>Viewport</th><th>Status</th></tr></thead><tbody>${m.changes
        .map((c, i) => `<tr><td>${i + 1}</td><td>${esc(describeChange(c).replace(/data:[^\s)"']{40,}/g, 'data:…'))}${c.experiment ? ' <span class="pill running">experiment</span>' : ''}</td><td>${esc(c.origin)}</td><td>${esc(vpText(c.viewport))}</td><td><span class="pill ${esc(c.exportStatus)}">${esc(c.exportStatus)}</span></td></tr>`)
        .join('')}</tbody></table>`
    : '<div class="empty">No changes were made.</div>';

  const responsive = m.responsive.length
    ? [...m.responsive]
        .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
        .map(
          (i) =>
            `<div class="issue"><div class="t"><span class="pill ${esc(i.severity)}">${esc(i.severity)}</span>${esc(i.title)} <span class="pill ${esc(i.classification)}">${esc(i.classification)}</span></div><p>${esc(i.message)}</p><div class="s"><code>${esc(i.selector)}</code> · ${esc(vpText(i.viewport))}${i.suggestion ? ` · Suggestion: ${esc(i.suggestion)}` : ''}</div></div>`,
        )
        .join('')
    : '<div class="empty">No responsive audit findings (or the audit has not been run).</div>';

  const a11y = m.a11y.length
    ? [...m.a11y]
        .sort((a, b) => SEVERITY_ORDER.indexOf(a.impact) - SEVERITY_ORDER.indexOf(b.impact))
        .map(
          (i) =>
            `<div class="issue"><div class="t"><span class="pill ${esc(i.impact)}">${esc(i.impact)}</span>${esc(i.help)} <code>${esc(i.ruleId)}</code></div><p>${esc(i.description)}</p><div class="s">${i.nodes.length} element${i.nodes.length === 1 ? '' : 's'}${i.nodes[0] ? ` · e.g. <code>${esc(i.nodes[0].selector)}</code>` : ''}${i.viewport ? ` · ${esc(vpText(i.viewport))}` : ''} · <a href="${esc(safeUrl(i.helpUrl))}">rule details</a></div></div>`,
        )
        .join('')
    : '<div class="empty">No accessibility findings (or the audit has not been run).</div>';

  const runs = m.runs.length
    ? `<table><thead><tr><th>Scenario</th><th>Status</th><th>Viewport</th><th>Steps</th><th>Duration</th><th>Notes</th></tr></thead><tbody>${m.runs
        .map((r) => {
          const ok = r.steps.filter((x) => x.status === 'passed').length;
          const bad = r.steps.find((x) => x.status === 'failed');
          const dur = r.finishedAt ? `${((r.finishedAt - r.startedAt) / 1000).toFixed(1)} s` : '—';
          return `<tr><td><b>${esc(r.scenarioName)}</b><div class="s" style="color:#6a6e79">${esc(fmtDate(r.startedAt))}</div></td><td><span class="pill ${esc(r.status)}">${esc(r.status)}</span></td><td>${esc(vpText(r.viewport))}</td><td>${ok}/${r.steps.length}</td><td>${dur}</td><td>${bad?.error ? esc(bad.error.slice(0, 160)) : ''}${r.consoleErrors.length ? ` ${r.consoleErrors.length} console error(s)` : ''}${r.issues.length ? ` ${r.issues.length} issue(s)` : ''}</td></tr>`;
        })
        .join('')}</tbody></table>`
    : '<div class="empty">No test runs recorded.</div>';

  const shots = m.captures.length
    ? `<div class="shots">${m.captures
        .map((c) => {
          const src = safeImg(c.dataUrl);
          return `<figure>${src ? `<img src="${src}" alt="${esc(c.label)}">` : ''}<figcaption><b>${esc(c.label || 'Screenshot')}</b>${esc(vpText(c.viewport))} · ${c.kind === 'raster' ? 'DOM raster (approximate)' : 'Chromium screenshot'}</figcaption></figure>`;
        })
        .join('')}</div>`
    : '<div class="empty">No screenshots included.</div>';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="IFDY (Interface Foundry)">
<title>${esc(m.project)} — Responsive QA report</title>
<style>${CSS}</style></head>
<body><div class="page">
<header>
<div class="brand"><i></i>IFDY · Interface Foundry</div>
<h1>Responsive QA report</h1>
<div class="sub">${esc(m.project)}</div>
<div class="meta"><span>Source <b>${esc(m.source)}</b></span><span>Generated <b>${esc(fmtDate(m.generatedAt))}</b></span>${m.device ? `<span>Current device <b>${esc(m.device)}</b></span>` : ''}<span>Viewport profiles <b>${m.viewports.length}</b></span></div>
<div class="tiles">${tiles.map((t) => `<div class="tile"><div class="v">${t.v}</div><div class="l">${esc(t.l)}</div><div class="d">${esc(t.d)}</div></div>`).join('')}</div>
<p class="note">Automated checks find common problems; they never certify accessibility, financial correctness or security. Review findings with real users and assistive technology.</p>
</header>
<main>
<section><h2>Viewport profiles <span class="n">${m.viewports.length}</span></h2>${viewports}</section>
<section><h2>Changes <span class="n">${m.changes.length}</span></h2>${changes}</section>
<section><h2>Responsive issues <span class="n">${m.responsive.length}</span></h2>${responsive}</section>
<section><h2>Accessibility findings <span class="n">${m.a11y.length}</span></h2>${a11y}</section>
<section><h2>Test runs <span class="n">${m.runs.length}</span></h2>${runs}</section>
<section><h2>Screenshots <span class="n">${m.captures.length}</span></h2>${shots}</section>
</main>
<footer>Generated by IFDY (Interface Foundry) on ${esc(fmtDate(m.generatedAt))}. Screenshots marked “DOM raster” are approximate renderings. This document contains no scripts.</footer>
</div></body></html>`;
}
