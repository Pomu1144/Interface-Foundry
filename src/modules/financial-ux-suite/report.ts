/**
 * Test report export: Markdown, JSON and a self-contained HTML page (inline
 * CSS, screenshots as data URLs, no scripts) from a set of scenario runs.
 */
import type { Scenario, ScenarioRun } from '@shared/types';
import {
  buildReproSteps,
  formatMs,
  issueSeverity,
  issueTarget,
  issueTitle,
  latestRuns,
  runCellKey,
  runDuration,
  summarizeRuns,
  type RunSummary,
} from '@/modules/interaction-replayer/summary';
import { viewportKey } from '@/modules/interaction-replayer/matrix';

export const SCOPE_NOTE = 'Evaluates UI and interaction behaviour only. It does not certify financial correctness or transaction security.';

export type ReportOptions = {
  scenarios?: Scenario[];
  projectName?: string;
  generatedAt?: number;
  routeLabel?: (route: string) => string;
  deviceName?: (id: string) => string;
  /** Use only the latest run per scenario × viewport (default true). */
  latestOnly?: boolean;
};

export type TestReport = { markdown: string; json: string; html: string; summary: RunSummary; runs: ScenarioRun[] };

type Column = { key: string; label: string };

const vpLabel = (r: ScenarioRun) => `${r.viewport.deviceName}${r.viewport.posture === 'expanded' ? ' · expanded' : ''}${r.viewport.orientation === 'landscape' ? ' · landscape' : ''} (${r.viewport.width}×${r.viewport.height})`;

const statusWord: Record<ScenarioRun['status'], string> = { passed: 'Passed', failed: 'Failed', aborted: 'Aborted', running: 'Running' };

function prepare(runsIn: ScenarioRun[], opts: ReportOptions) {
  const runs = (opts.latestOnly ?? true ? [...latestRuns(runsIn).values()] : [...runsIn]).sort((a, b) => a.startedAt - b.startedAt);
  const columns: Column[] = [];
  for (const r of runs) {
    const key = viewportKey(r.viewport);
    if (!columns.some((c) => c.key === key)) columns.push({ key, label: vpLabel(r) });
  }
  const byId = new Map((opts.scenarios ?? []).map((s) => [s.id, s]));
  const scenarioOrder: { id: string; name: string; suite: string }[] = [];
  for (const sc of opts.scenarios ?? []) if (runs.some((r) => r.scenarioId === sc.id)) scenarioOrder.push({ id: sc.id, name: sc.name, suite: sc.suite ?? 'Scenarios' });
  for (const r of runs) if (!scenarioOrder.some((x) => x.id === r.scenarioId)) scenarioOrder.push({ id: r.scenarioId, name: r.scenarioName, suite: byId.get(r.scenarioId)?.suite ?? 'Scenarios' });
  const cells = latestRuns(runs);
  return { runs, columns, scenarioOrder, byId, cells, summary: summarizeRuns(runs) };
}

function stepDescriptions(sc: Scenario | undefined) {
  return new Map(sc?.steps.map((s, i) => [s.id, { index: i + 1, text: s.description }]) ?? []);
}

/* ------------------------------------------------------------------ */
/* Markdown                                                            */
/* ------------------------------------------------------------------ */

const mdEscape = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function cellText(r: ScenarioRun | undefined): string {
  if (!r) return '—';
  const mark = r.status === 'passed' ? '✅' : r.status === 'failed' ? '❌' : r.status === 'aborted' ? '⏹' : '…';
  const failed = r.steps.filter((s) => s.status === 'failed').length;
  return `${mark} ${formatMs(runDuration(r))}${failed ? ` · ${failed} failed` : ''}${r.issues.length ? ` · ${r.issues.length} issues` : ''}`;
}

function markdown(p: ReturnType<typeof prepare>, opts: ReportOptions, generatedAt: number): string {
  const { summary: s, columns, scenarioOrder, cells, runs, byId } = p;
  const lines: string[] = [];
  lines.push(`# Financial UX test report${opts.projectName ? ` — ${opts.projectName}` : ''}`, '');
  lines.push(`> **Scope:** ${SCOPE_NOTE}`, '');
  lines.push(`Generated ${new Date(generatedAt).toISOString()} by IFDY (Interface Foundry). Runs replay recorded or built-in scenarios in a simulated viewport; device geometry is approximate.`, '');
  lines.push('## Summary', '');
  lines.push('| Runs | Passed | Failed | Aborted | Pass rate | Duration | Issues | Console errors |', '|---|---|---|---|---|---|---|---|');
  lines.push(`| ${s.total} | ${s.passed} | ${s.failed} | ${s.aborted} | ${s.passRate === null ? '—' : `${Math.round(s.passRate * 100)}%`} | ${formatMs(s.durationMs)} | ${s.issues} | ${s.consoleErrors} |`, '');
  if (columns.length) {
    lines.push('## Results', '');
    lines.push(`| Scenario | ${columns.map((c) => mdEscape(c.label)).join(' | ')} |`, `|---|${columns.map(() => '---').join('|')}|`);
    let suite = '';
    for (const sc of scenarioOrder) {
      if (sc.suite !== suite) {
        suite = sc.suite;
        lines.push(`| **${mdEscape(suite)}** |${columns.map(() => ' ').join('|')}|`);
      }
      lines.push(`| ${mdEscape(sc.name)} | ${columns.map((c) => cellText(cells.get(`${sc.id}::${c.key}`))).join(' | ')} |`);
    }
    lines.push('');
  }
  const failed = runs.filter((r) => r.status === 'failed');
  if (failed.length) {
    lines.push('## Failures', '');
    for (const r of failed) {
      const sc = byId.get(r.scenarioId);
      const desc = stepDescriptions(sc);
      lines.push(`### ${r.scenarioName} — ${vpLabel(r)}`, '');
      if (sc) {
        lines.push('**Steps to reproduce**', '');
        buildReproSteps(sc, r, { routeLabel: opts.routeLabel, deviceName: opts.deviceName }).forEach((l, i) => lines.push(`${i + 1}. ${l}`));
        lines.push('');
      }
      lines.push('**Failed steps**', '');
      for (const st of r.steps.filter((x) => x.status === 'failed')) {
        const d = desc.get(st.stepId);
        lines.push(`- Step ${d?.index ?? '?'} — ${d?.text ?? st.stepId}: ${st.error ?? 'failed'}${st.usedLocator ? ` _(located by ${st.usedLocator})_` : ''}`);
      }
      lines.push('');
      if (r.consoleErrors.length) {
        lines.push('**Console errors**', '', '```', ...r.consoleErrors, '```', '');
      }
      if (r.issues.length) {
        lines.push(`**Detected issues (${r.issues.length})**`, '');
        for (const i of r.issues.slice(0, 15)) lines.push(`- ${issueSeverity(i)} · ${issueTitle(i)}${issueTarget(i) ? ` — \`${issueTarget(i)}\`` : ''}`);
        if (r.issues.length > 15) lines.push(`- …and ${r.issues.length - 15} more`);
        lines.push('');
      }
    }
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* JSON                                                                */
/* ------------------------------------------------------------------ */

function json(p: ReturnType<typeof prepare>, opts: ReportOptions, generatedAt: number): string {
  return JSON.stringify(
    {
      format: 'ifdy.test-report',
      version: 1,
      generatedAt: new Date(generatedAt).toISOString(),
      project: opts.projectName ?? null,
      scope: SCOPE_NOTE,
      summary: p.summary,
      viewports: p.columns.map((c) => c.label),
      runs: p.runs.map((r) => {
        const sc = p.byId.get(r.scenarioId);
        const desc = stepDescriptions(sc);
        return {
          id: r.id,
          scenarioId: r.scenarioId,
          scenarioName: r.scenarioName,
          suite: sc?.suite ?? null,
          viewport: r.viewport,
          status: r.status,
          startedAt: new Date(r.startedAt).toISOString(),
          durationMs: runDuration(r),
          steps: r.steps.map((s) => ({ ...s, screenshot: s.screenshot ? '(in HTML report)' : undefined, description: desc.get(s.stepId)?.text })),
          reproduction: sc ? buildReproSteps(sc, r, { routeLabel: opts.routeLabel, deviceName: opts.deviceName }) : [],
          consoleErrors: r.consoleErrors,
          issues: r.issues,
        };
      }),
    },
    null,
    2,
  );
}

/* ------------------------------------------------------------------ */
/* HTML                                                                */
/* ------------------------------------------------------------------ */

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const safeImg = (src: string | undefined) => (src && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src) ? src : null);

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--line:#e3e5ea;--text:#14161b;--muted:#6a6e79;--ok:#11875a;--okbg:#e5f6ee;--bad:#c9283a;--badbg:#fdecee;--warn:#9a6700;--warnbg:#fff4d6;--accent:#2f6bff}
@media (prefers-color-scheme:dark){:root{--bg:#0b0c0f;--card:#15161a;--line:#2a2c33;--text:#eceef2;--muted:#9a9ea8;--ok:#3dd68c;--okbg:rgba(61,214,140,.12);--bad:#ff5c6c;--badbg:rgba(255,92,108,.12);--warn:#f5b544;--warnbg:rgba(245,181,68,.12)}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:32px 24px 64px}h1{font-size:24px;margin:0 0 4px;letter-spacing:-.015em}h2{font-size:17px;margin:32px 0 12px}h3{font-size:15px;margin:0}
.meta{color:var(--muted);font-size:12.5px}.scope{margin:16px 0;padding:10px 14px;border-radius:10px;background:var(--warnbg);color:var(--warn);font-weight:500}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.card b{display:block;font-size:22px;letter-spacing:-.02em}.card span{color:var(--muted);font-size:12px}
table{border-collapse:separate;border-spacing:0;width:100%;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:13px}th{font-size:12px;color:var(--muted);font-weight:600}
tr:last-child td{border-bottom:0}.suite td{background:var(--bg);font-weight:600;font-size:12px;color:var(--muted)}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}.passed{background:var(--okbg);color:var(--ok)}.failed{background:var(--badbg);color:var(--bad)}.aborted,.none{background:var(--bg);color:var(--muted)}
.run{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0}.run header{display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:16px}@media (max-width:760px){.grid{grid-template-columns:1fr}}
ol{margin:6px 0 0;padding-left:22px}li{margin:3px 0}.err{color:var(--bad)}pre{white-space:pre-wrap;background:var(--bg);border-radius:8px;padding:10px;font:12px/1.5 ui-monospace,Menlo,monospace;margin:6px 0 0}
img{max-width:100%;border-radius:8px;border:1px solid var(--line);display:block}figure{margin:0}figcaption{color:var(--muted);font-size:12px;margin-top:4px}
.k{color:var(--muted);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-top:12px}code{font:12px ui-monospace,Menlo,monospace}`;

function html(p: ReturnType<typeof prepare>, opts: ReportOptions, generatedAt: number): string {
  const { summary: s, columns, scenarioOrder, cells, runs, byId } = p;
  const e = escapeHtml;
  const card = (n: string | number, label: string) => `<div class="card"><b>${e(String(n))}</b><span>${e(label)}</span></div>`;
  const pill = (r?: ScenarioRun) =>
    r ? `<span class="pill ${r.status}">${e(statusWord[r.status])} · ${e(formatMs(runDuration(r)))}${r.issues.length ? ` · ${r.issues.length} issues` : ''}</span>` : '<span class="pill none">—</span>';
  let suite = '';
  const rows = scenarioOrder
    .map((sc) => {
      let head = '';
      if (sc.suite !== suite) {
        suite = sc.suite;
        head = `<tr class="suite"><td colspan="${columns.length + 1}">${e(suite)}</td></tr>`;
      }
      return `${head}<tr><td>${e(sc.name)}</td>${columns.map((c) => `<td>${pill(cells.get(runCellKey(sc.id, parseKey(c.key))))}</td>`).join('')}</tr>`;
    })
    .join('');
  const failed = runs.filter((r) => r.status === 'failed');
  const failures = failed
    .map((r) => {
      const sc = byId.get(r.scenarioId);
      const desc = stepDescriptions(sc);
      const repro = sc ? buildReproSteps(sc, r, { routeLabel: opts.routeLabel, deviceName: opts.deviceName }) : [];
      const shots = r.steps
        .map((st) => ({ st, src: safeImg(st.screenshot) }))
        .filter((x) => x.src)
        .map(({ st, src }) => `<figure><img src="${src}" alt=""><figcaption>Step ${desc.get(st.stepId)?.index ?? '?'} · ${e(desc.get(st.stepId)?.text ?? '')}</figcaption></figure>`);
      const final = safeImg(r.finalScreenshot);
      return `<section class="run"><header><span class="pill failed">Failed</span><h3>${e(r.scenarioName)}</h3><span class="meta">${e(vpLabel(r))} · ${e(formatMs(runDuration(r)))}</span></header>
<div class="grid"><div>
${repro.length ? `<div class="k">Steps to reproduce</div><ol>${repro.map((l) => `<li>${e(l)}</li>`).join('')}</ol>` : ''}
<div class="k">Failed steps</div><ol>${r.steps
        .filter((x) => x.status === 'failed')
        .map((st) => `<li><b>Step ${desc.get(st.stepId)?.index ?? '?'}</b> — ${e(desc.get(st.stepId)?.text ?? st.stepId)}<br><span class="err">${e(st.error ?? 'failed')}</span>${st.usedLocator ? ` <span class="meta">(located by ${e(st.usedLocator)})</span>` : ''}</li>`)
        .join('')}</ol>
${r.consoleErrors.length ? `<div class="k">Console errors</div><pre>${e(r.consoleErrors.join('\n'))}</pre>` : ''}
${r.issues.length ? `<div class="k">Detected issues (${r.issues.length})</div><ol>${r.issues.slice(0, 20).map((i) => `<li>${e(String(issueSeverity(i)))} · ${e(issueTitle(i))}${issueTarget(i) ? ` <code>${e(issueTarget(i))}</code>` : ''}</li>`).join('')}</ol>` : ''}
</div><div>${shots.join('')}${final && !shots.length ? `<figure><img src="${final}" alt=""><figcaption>End state</figcaption></figure>` : ''}</div></div></section>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>Financial UX test report${opts.projectName ? ` · ${e(opts.projectName)}` : ''}</title><style>${CSS}</style></head>
<body><main>
<h1>Financial UX test report${opts.projectName ? ` — ${e(opts.projectName)}` : ''}</h1>
<div class="meta">Generated ${e(new Date(generatedAt).toLocaleString())} by IFDY (Interface Foundry) · ${s.scenarios} scenarios × ${s.viewports} viewports · simulated viewports, approximate device geometry</div>
<div class="scope">${e(SCOPE_NOTE)}</div>
<div class="cards">${card(s.total, 'runs')}${card(s.passed, 'passed')}${card(s.failed, 'failed')}${card(s.passRate === null ? '—' : `${Math.round(s.passRate * 100)}%`, 'pass rate')}${card(formatMs(s.durationMs), 'total duration')}${card(s.issues, 'detected issues')}${card(s.consoleErrors, 'console errors')}</div>
<h2>Results</h2>
<table><thead><tr><th>Scenario</th>${columns.map((c) => `<th>${e(c.label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
${failed.length ? `<h2>Failures (${failed.length})</h2>${failures}` : '<h2>No failures</h2><p class="meta">Every run passed. Passing runs do not certify accessibility, financial correctness or security.</p>'}
</main></body></html>`;
}

function parseKey(key: string) {
  const [deviceId, posture, orientation] = key.split('|');
  return { deviceId, posture: posture as 'folded' | 'expanded', orientation: orientation as 'portrait' | 'landscape' };
}

export function buildTestReport(runs: ScenarioRun[], opts: ReportOptions = {}): TestReport {
  const generatedAt = opts.generatedAt ?? Date.now();
  const p = prepare(
    runs.filter((r) => r.status !== 'running'),
    opts,
  );
  return { markdown: markdown(p, opts, generatedAt), json: json(p, opts, generatedAt), html: html(p, opts, generatedAt), summary: p.summary, runs: p.runs };
}

/** Trigger a browser download of a text file. */
export function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
