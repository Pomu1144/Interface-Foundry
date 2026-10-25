import { structuredPatch } from 'diff';
import type { Change, ChangeKind } from '@shared/types';
import { buildOverrideCss, describeChange, effectiveChanges, isNoop } from '@/modules/change-manager/changes';
import {
  appendEdit,
  applyEdits,
  disableDeclaration,
  editDeclaration,
  eolOf,
  findRules,
  indentUnit,
  insertDeclarations,
  insertIntoAtRule,
  normalizeMedia,
  normalizeSelector,
  parseCss,
  ruleBlock,
  type CssRule,
  type CssSheet,
  type TextEdit,
} from './css-source';

/**
 * Turns the live change set into reviewable source patches.
 *
 *  - 'rule' edits are located in the author stylesheet (file + selector + media)
 *  - selector-scoped style edits modify that selector's rule or append one
 *  - element-scoped overrides go to an appended `ifdy-overrides.css`
 *  - token edits update `:root` custom property declarations
 *  - text / attribute edits touch static sources only when the original is unique
 *
 * Every hunk carries a reliability label so a reviewer knows what was matched
 * exactly and what is a best-effort append. Nothing here writes files.
 */

export type Reliability = 'exact' | 'appended' | 'review' | 'unmapped';

export type SourceFile = { path: string; text: string };

export type MappedEdit = TextEdit & { changeIds: string[]; reliability: Reliability; label: string; detail?: string };

export type HunkLabel = { reliability: Reliability; label: string; detail?: string; changeIds: string[] };

export type PatchHunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[]; labels: HunkLabel[] };

export type FileLanguage = 'css' | 'html' | 'js' | 'json' | 'text';

export type FilePatch = {
  path: string;
  isNew: boolean;
  before: string;
  after: string;
  edits: MappedEdit[];
  hunks: PatchHunk[];
  additions: number;
  deletions: number;
  unified: string;
  language: FileLanguage;
};

export type UnmappedChange = { changeIds: string[]; kind: ChangeKind; label: string; reason: string };

export type SourcePatch = {
  files: FilePatch[];
  unmapped: UnmappedChange[];
  unified: string;
  /** Change ids that produced at least one edit. */
  mappedChangeIds: string[];
  /** Change id -> reliability of its mapping. */
  reliabilityById: Record<string, Reliability>;
  overridesPath: string;
  noSources: boolean;
  stats: { files: number; additions: number; deletions: number; exact: number; appended: number; review: number; unmapped: number };
};

export type PatchOptions = {
  changes: Change[];
  /** Text sources of the project, or null when the source is not accessible (proxy / URL). */
  files: SourceFile[] | null;
  /** Entry HTML file (relative path) used to link the overrides stylesheet. */
  entry?: string;
  overridesFile?: string;
  includeExperiments?: boolean;
  /** Timestamp used in generated comments (tests pass a fixed value). */
  now?: number;
};

export const OVERRIDES_FILE = 'ifdy-overrides.css';

export function languageOf(path: string): FileLanguage {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'css' || ext === 'scss' || ext === 'less') return 'css';
  if (ext === 'html' || ext === 'htm' || ext === 'vue' || ext === 'svelte' || ext === 'svg') return 'html';
  if (['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts'].includes(ext)) return 'js';
  if (ext === 'json' || ext === 'map') return 'json';
  return 'text';
}

const isCss = (p: string) => /\.css$/i.test(p);
const isHtml = (p: string) => /\.html?$/i.test(p);
const isScript = (p: string) => /\.(m?js|cjs|jsx|tsx?|vue|svelte)$/i.test(p);
const basename = (p: string) => p.split('/').pop() ?? p;
const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');

/** Relative href from an HTML file to a target file (both project-relative). */
export function relativeHref(fromFile: string, toFile: string): string {
  const from = dirname(fromFile).split('/').filter(Boolean);
  const to = toFile.split('/').filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/');
}

/* ------------------------------------------------------------------ */
/* Per-file working state                                              */
/* ------------------------------------------------------------------ */

type Region = { sheet: CssSheet; base: number; text: string };

type InsertReq = { rule: CssRule; region: Region; decls: [string, string, boolean][]; changeIds: string[]; label: string; reliability: Reliability };
type AppendReq = { selector: string; media?: string; decls: Map<string, string>; changeIds: string[]; reliability: Reliability; label: string };

class FileState {
  edits: MappedEdit[] = [];
  inserts = new Map<string, InsertReq>();
  appends = new Map<string, AppendReq>();
  private regions: Region[] | null = null;
  constructor(
    public path: string,
    public text: string,
    public isNew = false,
  ) {}

  /** CSS regions: the whole file for .css, each <style> block for HTML. */
  cssRegions(): Region[] {
    if (this.regions) return this.regions;
    if (isCss(this.path)) this.regions = [{ sheet: parseCss(this.text), base: 0, text: this.text }];
    else if (isHtml(this.path)) {
      this.regions = [];
      for (const m of this.text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
        const inner = m[1];
        const base = (m.index ?? 0) + m[0].indexOf(inner, m[0].indexOf('>') + 1);
        this.regions.push({ sheet: parseCss(inner), base, text: inner });
      }
    } else this.regions = [];
    return this.regions;
  }

  addEdit(e: MappedEdit, superseded: (ids: string[], why: string) => void): boolean {
    for (let i = 0; i < this.edits.length; i++) {
      const o = this.edits[i];
      const overlap = e.start < o.end && o.start < e.end;
      const sameZero = e.start === e.end && o.start === o.end && e.start === o.start;
      if (overlap && !sameZero) {
        // The later edit wins; report the earlier one.
        superseded(o.changeIds, 'superseded by a later edit to the same declaration');
        this.edits.splice(i, 1);
        i--;
      }
    }
    this.edits.push(e);
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

export function buildSourcePatch(opts: PatchOptions): SourcePatch {
  const now = opts.now ?? Date.now();
  const noSources = opts.files === null;
  const sources = (opts.files ?? []).filter((f) => typeof f.text === 'string');
  const entry = opts.entry && sources.some((f) => f.path === opts.entry) ? opts.entry : sources.find((f) => /(^|\/)index\.html?$/i.test(f.path))?.path ?? sources.find((f) => isHtml(f.path))?.path;
  const overridesPath = opts.overridesFile ?? `${entry ? dirname(entry) : ''}${OVERRIDES_FILE}`;

  const states = new Map<string, FileState>();
  for (const f of sources) states.set(f.path, new FileState(f.path, f.text));
  const state = (path: string) => states.get(path)!;
  const cssFiles = sources.filter((f) => isCss(f.path) && f.path !== overridesPath).map((f) => f.path);
  const htmlFiles = sources.filter((f) => isHtml(f.path)).map((f) => f.path);
  const scriptFiles = sources.filter((f) => isScript(f.path)).map((f) => f.path);

  const unmapped: UnmappedChange[] = [];
  const reliabilityById: Record<string, Reliability> = {};
  const mark = (ids: string[], r: Reliability) => {
    for (const id of ids) {
      const prev = reliabilityById[id];
      const rank = { exact: 0, appended: 1, review: 2, unmapped: 3 } as const;
      if (!prev || rank[r] > rank[prev]) reliabilityById[id] = r;
    }
  };
  const superseded = (ids: string[], why: string) => {
    unmapped.push({ changeIds: ids, kind: 'style', label: ids.join(', '), reason: why });
    for (const id of ids) delete reliabilityById[id];
  };
  const fail = (c: Change, reason: string) => {
    unmapped.push({ changeIds: [c.id], kind: c.kind, label: describeChange(c), reason });
    mark([c.id], 'unmapped');
  };

  const all = effectiveChanges(opts.changes).filter((c) => !isNoop(c) && c.exportStatus !== 'committed' && (opts.includeExperiments || !c.experiment));
  const overrideChanges: Change[] = [];
  const overrideTokens = new Map<string, { value: string; id: string }>();
  const overrideLabels: string[] = [];

  /* ------------ helpers over CSS regions ------------ */
  type Hit = { file: string; region: Region; rule: CssRule };
  const findSelector = (files: string[], selector: string, media: string[] | undefined): Hit[] => {
    const hits: Hit[] = [];
    for (const path of files) {
      for (const region of state(path).cssRegions()) {
        for (const rule of findRules(region.sheet, selector, media)) hits.push({ file: path, region, rule });
      }
    }
    return hits;
  };
  const lastDecl = (rule: CssRule, prop: string) => [...rule.declarations].reverse().find((d) => d.property === prop.toLowerCase() || d.property === prop);

  const editInRule = (hit: Hit, c: Change, property: string, value: string | null, label: string): boolean => {
    const fs = state(hit.file);
    const d = lastDecl(hit.rule, property);
    const off = hit.region.base;
    if (value === null) {
      if (!d) return false;
      const e = disableDeclaration(hit.region.text, d);
      fs.addEdit({ start: e.start + off, end: e.end + off, text: e.text, changeIds: [c.id], reliability: 'exact', label: `${label} · declaration disabled` }, superseded);
      mark([c.id], 'exact');
      return true;
    }
    if (d) {
      const e = editDeclaration(hit.region.text, d, value);
      fs.addEdit({ start: e.start + off, end: e.end + off, text: e.text, changeIds: [c.id], reliability: 'exact', label }, superseded);
    } else {
      const key = `${hit.region.base}:${hit.rule.selectorStart}`;
      const req = fs.inserts.get(key) ?? { rule: hit.rule, region: hit.region, decls: [], changeIds: [], label: `${label} · declaration added`, reliability: 'exact' as Reliability };
      req.decls = req.decls.filter(([p]) => p !== property);
      req.decls.push([property, value, false]);
      req.changeIds.push(c.id);
      fs.inserts.set(key, req);
    }
    mark([c.id], 'exact');
    return true;
  };

  const pickHit = (hits: Hit[], property: string, lineHint?: number): Hit | undefined => {
    if (!hits.length) return undefined;
    const withProp = hits.filter((h) => lastDecl(h.rule, property));
    const pool = withProp.length ? withProp : hits;
    if (lineHint) {
      return [...pool].sort((a, b) => Math.abs(a.rule.line - lineHint) - Math.abs(b.rule.line - lineHint))[0];
    }
    return pool[pool.length - 1]; // the last matching rule wins the cascade
  };

  /** Best stylesheet to append a new selector rule to (by shared class names, then BEM blocks). */
  const appendTarget = (selector: string): string | null => {
    const classes = [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
    if (!classes.length) return null;
    const weighted = new Map<string, number>();
    classes.forEach((cls, i) => {
      const own = i === classes.length - 1 ? 3 : 1;
      weighted.set(cls, Math.max(weighted.get(cls) ?? 0, own));
      const block = cls.split(/__|--/)[0];
      if (block && block !== cls) weighted.set(block, Math.max(weighted.get(block) ?? 0, 1));
    });
    let best: { file: string; score: number } | null = null;
    for (const f of cssFiles) {
      let score = 0;
      for (const r of state(f).cssRegions()[0]?.sheet.rules ?? []) {
        for (const [cls, w] of weighted) if (new RegExp(`\\.${cls.replace(/[-]/g, '\\-')}(?![\\w-])`).test(r.selector)) score += w;
      }
      if (score > 0 && (!best || score > best.score)) best = { file: f, score };
    }
    return best?.file ?? null;
  };

  const toOverride = (c: Change, why?: string) => {
    overrideChanges.push(c);
    if (why) overrideLabels.push(why);
    mark([c.id], 'appended');
  };

  /* ------------ map each change ------------ */
  for (const c of all) {
    switch (c.kind) {
      case 'rule': {
        const selector = c.target.ruleSelector ?? c.target.selector;
        const src = /^(.*?)(?::(\d+))?$/.exec(c.target.ruleSource ?? '') ?? [];
        const label = (src[1] ?? '').trim();
        const line = src[2] ? Number(src[2]) : undefined;
        const inline = !label || label.startsWith('<style>') || label === 'inline';
        const candidates = inline ? htmlFiles : cssFiles.filter((f) => basename(f) === label);
        if (noSources) {
          toOverrideRule(c);
          break;
        }
        if (!candidates.length && !inline) {
          if (c.after === null) fail(c, `${label || 'The stylesheet'} is not part of the project sources (external or generated), so the declaration cannot be disabled in source.`);
          else toOverrideRule(c, `${label} not found in sources`);
          break;
        }
        const hit = pickHit(findSelector(candidates, selector, c.target.ruleMedia), c.property, line);
        if (!hit) {
          if (c.after === null) fail(c, `rule “${selector}” not found in ${label || 'inline <style> blocks'}${c.target.ruleMedia?.length ? ` inside @media ${c.target.ruleMedia.join(' / ')}` : ''}`);
          else toOverrideRule(c, `rule “${selector}” not found in ${label}`);
          break;
        }
        const ok = editInRule(hit, c, c.property, c.after, `exact — rule matched (${basename(hit.file)}:${hit.rule.line})`);
        if (!ok) fail(c, `“${c.property}” is not declared in ${basename(hit.file)}:${hit.rule.line}; nothing to disable`);
        break;
      }
      case 'style':
      case 'visibility': {
        const value = c.kind === 'visibility' ? (c.after === 'hidden' ? 'none' : null) : c.after;
        const property = c.kind === 'visibility' ? 'display' : c.property;
        if (value === null || value === '') {
          if (c.kind === 'visibility') break; // shown again: nothing to export
          fail(c, 'clearing an inline override has no source equivalent');
          break;
        }
        if (c.scope === 'selector' && !noSources) {
          const media = c.media ? [c.media] : undefined;
          const hit = pickHit(findSelector([...cssFiles, ...htmlFiles], c.target.selector, media), property);
          if (hit) {
            editInRule(hit, c, property, value, `exact — selector rule matched (${basename(hit.file)}:${hit.rule.line})`);
            break;
          }
          const target = appendTarget(c.target.selector);
          if (target) {
            const fs = state(target);
            const key = `${normalizeSelector(c.target.selector)}\u0000${c.media ? normalizeMedia(c.media) : ''}`;
            const req: AppendReq = fs.appends.get(key) ?? { selector: c.target.selector, media: c.media, decls: new Map(), changeIds: [], reliability: 'appended', label: `appended rule to ${basename(target)}` };
            req.decls.set(property, value);
            req.changeIds.push(c.id);
            fs.appends.set(key, req);
            mark([c.id], 'appended');
            break;
          }
        }
        toOverride({ ...c, kind: 'style', property, after: value });
        break;
      }
      case 'token': {
        if (c.after === null) {
          fail(c, 'removing a token definition is not exported; delete the declaration manually');
          break;
        }
        if (noSources) {
          overrideTokens.set(c.property, { value: c.after, id: c.id });
          mark([c.id], 'appended');
          break;
        }
        let done = false;
        const hits: Hit[] = [];
        for (const path of [...cssFiles, ...htmlFiles]) {
          for (const region of state(path).cssRegions()) {
            for (const rule of region.sheet.rules) {
              if (rule.atBlock || rule.media.length) continue;
              if (!/(^|, )(:root|html)(, |$)/.test(rule.key)) continue;
              if (lastDecl(rule, c.property)) hits.push({ file: path, region, rule });
            }
          }
        }
        const hit = hits[hits.length - 1];
        if (hit) done = editInRule(hit, c, c.property, c.after, `exact — token declaration matched (${basename(hit.file)}:${lastDecl(hit.rule, c.property)?.line ?? hit.rule.line})`);
        if (!done) {
          // Append to the :root rule of the file that defines the most custom properties.
          let best: { file: string; region: Region; rule: CssRule; n: number } | null = null;
          for (const path of cssFiles) {
            for (const region of state(path).cssRegions()) {
              for (const rule of region.sheet.rules) {
                if (rule.atBlock || rule.media.length || !/(^|, )(:root|html)(, |$)/.test(rule.key)) continue;
                const n = rule.declarations.filter((d) => d.property.startsWith('--')).length;
                if (n && (!best || n > best.n)) best = { file: path, region, rule, n };
              }
            }
          }
          if (best) {
            const fs = state(best.file);
            const key = `${best.region.base}:${best.rule.selectorStart}`;
            const req = fs.inserts.get(key) ?? { rule: best.rule, region: best.region, decls: [], changeIds: [], label: `appended token to ${basename(best.file)}`, reliability: 'appended' as Reliability };
            req.decls.push([c.property, c.after, false]);
            req.changeIds.push(c.id);
            if (req.reliability === 'exact') req.label = `${req.label} · token appended`;
            fs.inserts.set(key, req);
            mark([c.id], 'appended');
          } else {
            overrideTokens.set(c.property, { value: c.after, id: c.id });
            mark([c.id], 'appended');
          }
        }
        break;
      }
      case 'text': {
        if (noSources) {
          fail(c, 'no source access for this project (rendered DOM only)');
          break;
        }
        mapText(c);
        break;
      }
      case 'attribute': {
        if (noSources) {
          fail(c, 'no source access for this project (rendered DOM only)');
          break;
        }
        mapAttribute(c);
        break;
      }
      case 'asset': {
        fail(c, `embedded asset (${c.property}): save the file into the project (e.g. assets/) and point ${c.property} at it — binary files are not part of text patches`);
        break;
      }
    }
  }

  function toOverrideRule(c: Change, why?: string) {
    const media = (c.target.ruleMedia ?? []).filter((m) => !m.startsWith('@container')).join(' and ') || undefined;
    if (c.after === null) {
      fail(c, why ? `${why}; a disabled declaration cannot be expressed as an override` : 'a disabled declaration cannot be expressed as an override');
      return;
    }
    toOverride({ ...c, kind: 'style', scope: 'selector', target: { ...c.target, selector: c.target.ruleSelector ?? c.target.selector }, media }, why);
  }

  function escapeHtml(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeRe(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  type Occ = { file: string; start: number; end: number };
  function occurrences(files: string[], re: RegExp): Occ[] {
    const out: Occ[] = [];
    for (const f of files) {
      const t = state(f).text;
      for (const m of t.matchAll(re)) out.push({ file: f, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
    }
    return out;
  }

  function mapText(c: Change) {
    const before = (c.before ?? '').trim();
    const after = c.after ?? '';
    if (!before) return fail(c, 'the original text is empty; IFDY cannot tell where it comes from');
    const loose = new RegExp(before.split(/\s+/).map(escapeRe).join('\\s+'), 'g');
    const looseHtml = new RegExp(escapeHtml(before).split(/\s+/).map(escapeRe).join('\\s+'), 'g');
    const inHtml = occurrences(htmlFiles, looseHtml);
    if (inHtml.length === 1) {
      const o = inHtml[0];
      state(o.file).addEdit({ start: o.start, end: o.end, text: escapeHtml(after.trim()), changeIds: [c.id], reliability: 'exact', label: `exact — unique text in ${basename(o.file)}` }, superseded);
      mark([c.id], 'exact');
      return;
    }
    const inScripts = occurrences(scriptFiles, loose);
    const total = inHtml.length + inScripts.length;
    if (total === 0) return fail(c, 'text not found in static sources — it is probably rendered from data or translations at runtime');
    if (total > 1) {
      const where = [...new Set([...inHtml, ...inScripts].map((o) => basename(o.file)))].slice(0, 4).join(', ');
      return fail(c, `the original text appears ${total}× (${where}); edit the intended occurrence manually`);
    }
    const o = inScripts[0];
    if (/[`'"\\<>{}$]/.test(after)) return fail(c, `found once in ${basename(o.file)}, but the new text contains characters that could break the script string; edit it manually`);
    state(o.file).addEdit({ start: o.start, end: o.end, text: after.trim(), changeIds: [c.id], reliability: 'review', label: `text match in ${basename(o.file)} (script template) — review` }, superseded);
    mark([c.id], 'review');
  }

  function mapAttribute(c: Change) {
    const name = c.property;
    if (c.before === null) return fail(c, `the ${name} attribute was added on the rendered DOM; add it in the markup or component that renders ${c.target.label}`);
    const re = new RegExp(`(\\s)${escapeRe(name)}\\s*=\\s*(?:"${escapeRe(c.before)}"|'${escapeRe(c.before)}')`, 'g');
    const occ = occurrences([...htmlFiles, ...scriptFiles], re);
    if (occ.length !== 1) {
      return fail(c, occ.length ? `${name}="${c.before}" appears ${occ.length}× in sources; edit the intended element manually` : `${name}="${c.before}" was not found in static sources`);
    }
    const o = occ[0];
    const lead = state(o.file).text[o.start];
    const replacement = c.after === null ? '' : `${lead}${name}="${c.after.replace(/"/g, '&quot;')}"`;
    const exact = isHtml(o.file);
    state(o.file).addEdit({ start: o.start, end: o.end, text: replacement, changeIds: [c.id], reliability: exact ? 'exact' : 'review', label: exact ? `exact — unique attribute in ${basename(o.file)}` : `attribute match in ${basename(o.file)} — review` }, superseded);
    mark([c.id], exact ? 'exact' : 'review');
  }

  /* ------------ overrides file ------------ */
  const overrideCss = [
    overrideTokens.size ? `:root {\n${[...overrideTokens].map(([k, v]) => `  ${k}: ${v.value};`).join('\n')}\n}` : '',
    buildOverrideCss(overrideChanges, false),
  ]
    .filter(Boolean)
    .join('\n\n');
  if (overrideCss) {
    const ids = [...overrideChanges.map((c) => c.id), ...[...overrideTokens.values()].map((v) => v.id)];
    const stamp = new Date(now).toISOString().replace('T', ' ').slice(0, 16);
    const why = [...new Set(overrideLabels)];
    const detail = why.length ? `fallback: ${why.join('; ')}` : `${ids.length} element-level edit${ids.length === 1 ? '' : 's'}`;
    let fs = states.get(overridesPath);
    if (fs) {
      const e = appendEdit(fs.text, `/* ── IFDY export ${stamp} ── */\n${overrideCss}`);
      fs.addEdit({ ...e, changeIds: ids, reliability: 'appended', label: 'appended override', detail }, superseded);
    } else {
      fs = new FileState(overridesPath, '', true);
      states.set(overridesPath, fs);
      const header = `/*\n * ${OVERRIDES_FILE} — exported by IFDY (Interface Foundry), ${stamp}.\n * Element-level overrides use unique selectors from the rendered DOM;\n * consider moving them into the owning component's styles.\n * Load this file after all other stylesheets.\n */\n\n`;
      fs.addEdit({ start: 0, end: 0, text: `${header}${overrideCss}\n`, changeIds: ids, reliability: 'appended', label: 'appended override', detail }, superseded);
      // Link it from HTML pages that load stylesheets.
      for (const html of htmlFiles) {
        const hs = state(html);
        if (hs.text.includes(OVERRIDES_FILE)) continue;
        const links = [...hs.text.matchAll(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi)];
        const href = relativeHref(html, overridesPath);
        const eol = eolOf(hs.text);
        if (links.length) {
          const last = links[links.length - 1];
          const at = (last.index ?? 0) + last[0].length;
          const lineStart = hs.text.lastIndexOf('\n', last.index ?? 0) + 1;
          const indent = /^[ \t]*/.exec(hs.text.slice(lineStart))?.[0] ?? '';
          const selfClose = /\/>$/.test(last[0]) ? ' />' : '>';
          hs.addEdit({ start: at, end: at, text: `${eol}${indent}<link rel="stylesheet" href="${href}"${selfClose}`, changeIds: ids, reliability: 'appended', label: 'appended override (stylesheet link)' }, superseded);
        } else if (html === entry) {
          const head = hs.text.search(/<\/head>/i);
          if (head >= 0) hs.addEdit({ start: head, end: head, text: `  <link rel="stylesheet" href="${href}">${eol}`, changeIds: ids, reliability: 'appended', label: 'appended override (stylesheet link)' }, superseded);
        }
      }
    }
  }

  /* ------------ finalize per file ------------ */
  const files: FilePatch[] = [];
  for (const fs of states.values()) {
    for (const req of fs.inserts.values()) {
      const e = insertDeclarations(req.region.text, req.rule, req.decls);
      fs.addEdit({ start: e.start + req.region.base, end: e.end + req.region.base, text: e.text, changeIds: req.changeIds, reliability: req.reliability, label: req.label }, superseded);
    }
    const eol = eolOf(fs.text);
    const unit = indentUnit(fs.text);
    for (const req of fs.appends.values()) {
      const decls = [...req.decls];
      const sheet = fs.cssRegions()[0]?.sheet;
      const mediaBlock = req.media && sheet ? sheet.atRules.filter((a) => a.name === 'media' && normalizeMedia(a.prelude) === normalizeMedia(req.media!)).pop() : undefined;
      let e: TextEdit | null = null;
      if (mediaBlock) e = insertIntoAtRule(fs.text, mediaBlock, ruleBlock(req.selector, decls, { indent: unit, eol }));
      if (!e) e = appendEdit(fs.text, ruleBlock(req.selector, decls, { media: req.media, indent: unit, eol }));
      fs.addEdit({ ...e, changeIds: req.changeIds, reliability: req.reliability, label: req.label }, superseded);
    }
    if (!fs.edits.length) continue;
    let after: string;
    try {
      after = applyEdits(fs.text, fs.edits);
    } catch {
      for (const e of fs.edits) superseded(e.changeIds, 'conflicting edits in the same region');
      continue;
    }
    files.push(finalizeFile(fs.path, fs.text, after, fs.edits, fs.isNew));
  }
  files.sort((a, b) => Number(a.isNew) - Number(b.isNew) || a.path.localeCompare(b.path));

  const mappedChangeIds = Object.entries(reliabilityById)
    .filter(([, r]) => r !== 'unmapped')
    .map(([id]) => id);
  const counts = { exact: 0, appended: 0, review: 0, unmapped: 0 };
  for (const r of Object.values(reliabilityById)) counts[r]++;
  counts.unmapped = unmapped.reduce((n, u) => n + u.changeIds.length, 0);
  return {
    files,
    unmapped,
    unified: files.map((f) => f.unified).join(''),
    mappedChangeIds,
    reliabilityById,
    overridesPath,
    noSources,
    stats: {
      files: files.length,
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
      ...counts,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Diff generation                                                     */
/* ------------------------------------------------------------------ */

function lineAt(text: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

export function finalizeFile(path: string, before: string, after: string, edits: MappedEdit[], isNew: boolean): FilePatch {
  // Where does each edit land in the new text?
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let delta = 0;
  const ranges = sorted.map((e) => {
    const newStart = e.start + delta;
    delta += e.text.length - (e.end - e.start);
    const from = lineAt(after, newStart);
    const to = Math.max(from, lineAt(after, newStart + Math.max(0, e.text.length - 1)));
    return { e, from, to, oldFrom: lineAt(before, e.start), oldTo: lineAt(before, Math.max(e.start, e.end - 1)) };
  });
  const sp = structuredPatch(`a/${path}`, `b/${path}`, before, after, '', '', { context: 3 });
  const hunks: PatchHunk[] = sp.hunks.map((h) => {
    const nFrom = h.newStart;
    const nTo = h.newStart + Math.max(0, h.newLines - 1);
    const oFrom = h.oldStart;
    const oTo = h.oldStart + Math.max(0, h.oldLines - 1);
    const labels: HunkLabel[] = [];
    for (const r of ranges) {
      const hitsNew = r.e.text.length > 0 && r.from <= nTo && r.to >= nFrom;
      const hitsOld = r.e.text.length === 0 && r.oldFrom <= oTo && r.oldTo >= oFrom;
      if (!hitsNew && !hitsOld) continue;
      if (labels.some((l) => l.label === r.e.label && l.reliability === r.e.reliability)) {
        const l = labels.find((x) => x.label === r.e.label && x.reliability === r.e.reliability)!;
        l.changeIds = [...new Set([...l.changeIds, ...r.e.changeIds])];
        continue;
      }
      labels.push({ reliability: r.e.reliability, label: r.e.label, detail: r.e.detail, changeIds: [...r.e.changeIds] });
    }
    if (!labels.length) labels.push({ reliability: 'review', label: 'formatting', changeIds: [] });
    return { oldStart: h.oldStart, oldLines: h.oldLines, newStart: h.newStart, newLines: h.newLines, lines: h.lines, labels };
  });
  let additions = 0;
  let deletions = 0;
  for (const h of hunks)
    for (const l of h.lines) {
      if (l.startsWith('+')) additions++;
      else if (l.startsWith('-')) deletions++;
    }
  return { path, isNew, before, after, edits, hunks, additions, deletions, unified: formatGitPatch(path, hunks, isNew), language: languageOf(path) };
}

/** Git-compatible unified diff (`git apply` / `patch -p1`). */
export function formatGitPatch(path: string, hunks: { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }[], isNew: boolean): string {
  if (!hunks.length) return '';
  const out = [`diff --git a/${path} b/${path}`];
  if (isNew) out.push('new file mode 100644');
  out.push(isNew ? '--- /dev/null' : `--- a/${path}`, `+++ b/${path}`);
  for (const h of hunks) {
    // Unified-diff convention: a zero-length range names the line *before* it.
    const os = h.oldLines === 0 ? Math.max(0, h.oldStart - 1) : h.oldStart;
    const ns = h.newLines === 0 ? Math.max(0, h.newStart - 1) : h.newStart;
    out.push(`@@ -${os}${h.oldLines === 1 ? '' : `,${h.oldLines}`} +${ns}${h.newLines === 1 ? '' : `,${h.newLines}`} @@`);
    out.push(...h.lines);
  }
  return out.join('\n') + '\n';
}

/** Unified diff for a single before/after pair (used by the editor and git review). */
export function diffFile(path: string, before: string, after: string, isNew = false): FilePatch {
  return finalizeFile(path, before, after, [], isNew);
}
