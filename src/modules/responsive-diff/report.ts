import type { Rect, Size } from '@shared/types';
import type { CaptureRef } from '@/store';
import { sizeDelta } from './pixel';
import type { StructuralRow, StructuralSummary } from './structural';

export type PixelSummary = {
  percent: number;
  changed: number;
  compared: number;
  ignored: number;
  /** Changed regions in CSS px. */
  boxes: Rect[];
  threshold: number;
  overlap: Size;
  resampled: boolean;
  diffDataUrl?: string;
};

export type DiffReportInput = {
  a: CaptureRef;
  b: CaptureRef;
  pixel?: PixelSummary | null;
  structural?: { rows: StructuralRow[]; summary: StructuralSummary } | null;
  ignore?: Rect[];
  project?: string;
  route?: string;
};

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const engine = (c: CaptureRef) => (c.kind === 'chromium' ? 'Chromium (deterministic)' : 'DOM raster (approximate)');
const vpText = (c: CaptureRef) => `${c.viewport.deviceName}${c.viewport.posture === 'expanded' ? ' · expanded' : ''} · ${c.viewport.width}×${c.viewport.height}`;
const rectText = (r?: Rect) => (r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}` : '—');

function captureMeta(c: CaptureRef) {
  return {
    id: c.id,
    label: c.label,
    engine: engine(c),
    route: c.route,
    viewport: c.viewport,
    image: { width: c.width, height: c.height },
    createdAt: new Date(c.createdAt).toISOString(),
    changeCount: c.changeCount,
  };
}

/**
 * Self-contained diff report: HTML with embedded images and findings, plus a
 * JSON document with the same findings (without image data).
 */
export function buildDiffReport(input: DiffReportInput): { html: string; json: string } {
  const { a, b, pixel, structural } = input;
  const generatedAt = new Date().toISOString();
  const sameSize = a.viewport.width === b.viewport.width && a.viewport.height === b.viewport.height;
  const notes: string[] = [];
  if (!sameSize) notes.push(`Captures have different viewports (${sizeDelta(a.viewport, b.viewport)}); images are aligned top-left and the pixel diff covers only the overlapping ${pixel ? `${Math.round(pixel.overlap.width)}×${Math.round(pixel.overlap.height)}` : ''} region.`);
  if (pixel?.resampled) notes.push('The captures had different pixel densities; the denser image was resampled before comparing.');
  if (a.kind === 'raster' || b.kind === 'raster') notes.push('DOM raster captures re-render the page through SVG foreignObject; fonts, filters and some effects may differ from the browser. Use Chromium captures for pixel-exact baselines.');
  notes.push('Structural classification is heuristic: “suspicious” means a primary control was hidden, pushed off-screen, shrunk below the tap size or split by a hinge; review each finding.');

  const json = JSON.stringify(
    {
      tool: 'IFDY responsive diff',
      generatedAt,
      project: input.project,
      route: input.route ?? b.route,
      a: captureMeta(a),
      b: captureMeta(b),
      pixel: pixel
        ? { percentChanged: Number(pixel.percent.toFixed(3)), changedPixels: pixel.changed, comparedPixels: pixel.compared, ignoredPixels: pixel.ignored, threshold: pixel.threshold, overlap: pixel.overlap, regions: pixel.boxes, resampled: pixel.resampled }
        : null,
      ignoreRegions: input.ignore ?? [],
      structural: structural ? { summary: structural.summary, changes: structural.rows } : null,
      notes,
    },
    null,
    2,
  );

  const rows = structural?.rows ?? [];
  const tableRows = rows
    .map(
      (r) => `<tr class="${r.classification}">
  <td><span class="pill ${r.classification}">${r.classification}</span></td>
  <td>${esc(r.kinds.join(', '))}</td>
  <td><code>${esc(r.selector)}</code>${r.text ? `<div class="muted">${esc(r.text)}</div>` : ''}</td>
  <td class="mono">${esc(rectText(r.a))}</td>
  <td class="mono">${esc(rectText(r.b))}</td>
  <td>${r.reasons.map((x) => `<div>${esc(x)}</div>`).join('') || '<span class="muted">Responsive layout change</span>'}</td>
</tr>`,
    )
    .join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>IFDY responsive diff — ${esc(vpText(a))} vs ${esc(vpText(b))}</title>
<style>
:root{color-scheme:light;--ink:#14161b;--muted:#6a6e79;--line:#e3e5ea;--bg:#f6f7f9;--accent:#2f6bff;--danger:#d92d4b;--ok:#13804f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1200px;margin:0 auto;padding:32px 24px 64px}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:32px 0 10px}
.muted{color:var(--muted)}.mono,code{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:12px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:18px}
.card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card b{display:block;font-size:20px}
.imgs{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}figure{margin:0;background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px}
figure img{display:block;max-width:100%;height:auto;border-radius:4px;background:#fff}figcaption{margin-top:8px;font-size:12px;color:var(--muted)}
.notes{background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 14px}.notes li{margin:4px 0}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);background:#fafbfc}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600}.pill.suspicious{background:#fde8ec;color:var(--danger)}.pill.expected{background:#e6f4ec;color:var(--ok)}
footer{margin-top:40px;color:var(--muted);font-size:12px}
</style></head><body><main>
<h1>Responsive diff</h1>
<div class="muted">${esc(input.project ?? '')} ${esc(input.route ?? b.route ?? '')} · generated ${esc(new Date(generatedAt).toLocaleString())} by IFDY</div>
<div class="cards">
  <div class="card"><span class="muted">A</span><b>${esc(a.viewport.width)}×${esc(a.viewport.height)}</b>${esc(vpText(a))}<div class="muted">${esc(engine(a))}</div></div>
  <div class="card"><span class="muted">B</span><b>${esc(b.viewport.width)}×${esc(b.viewport.height)}</b>${esc(vpText(b))}<div class="muted">${esc(engine(b))}</div></div>
  <div class="card"><span class="muted">Pixels changed</span><b>${pixel ? `${pixel.percent.toFixed(2)}%` : '—'}</b>${pixel ? `${pixel.changed.toLocaleString()} px · ${pixel.boxes.length} region${pixel.boxes.length === 1 ? '' : 's'}` : 'not computed'}</div>
  <div class="card"><span class="muted">Structural changes</span><b>${structural ? structural.summary.total : '—'}</b>${structural ? `${structural.summary.suspicious} suspicious` : 'layout snapshots unavailable'}</div>
</div>
<h2>Captures</h2>
<div class="imgs">
  <figure><img src="${a.dataUrl}" alt="Capture A"><figcaption>A · ${esc(a.label)}</figcaption></figure>
  <figure><img src="${b.dataUrl}" alt="Capture B"><figcaption>B · ${esc(b.label)}</figcaption></figure>
  ${pixel?.diffDataUrl ? `<figure><img src="${pixel.diffDataUrl}" alt="Pixel diff"><figcaption>Pixel diff (threshold ${pixel.threshold}) over the ${Math.round(pixel.overlap.width)}×${Math.round(pixel.overlap.height)} overlap</figcaption></figure>` : ''}
</div>
<h2>Notes</h2><ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
<h2>Structural changes</h2>
${rows.length ? `<table><thead><tr><th>Class</th><th>Change</th><th>Element</th><th>A (x,y w×h)</th><th>B (x,y w×h)</th><th>Why</th></tr></thead><tbody>${tableRows}</tbody></table>` : '<p class="muted">No structural changes (or no layout snapshots were stored with these captures).</p>'}
<footer>Automated comparison. It cannot judge intent: confirm suspicious changes on the real page and real devices.</footer>
</main></body></html>`;
  return { html, json };
}
