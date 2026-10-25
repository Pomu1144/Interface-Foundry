import clsx from 'clsx';
import { diffWordsWithSpace } from 'diff';
import { CircleCheck, CirclePlus, Eye, FileDiff, FilePlus2, Info } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { Badge, Tooltip } from '@/ui';
import { highlightLines, languageFor, segmentsFor, type Span } from '@/modules/code-editor/syntax';
import type { FilePatch, HunkLabel, PatchHunk, Reliability } from './patch';
import s from './diff.module.css';

/**
 * Review-grade diff viewer: inline or side-by-side, full-document syntax
 * highlighting, intraline change marks and per-hunk reliability labels.
 */

type Row =
  | { kind: 'hunk'; hunk: PatchHunk; index: number }
  | { kind: 'line'; type: 'ctx' | 'add' | 'del'; oldNo?: number; newNo?: number; text: string; marks?: { from: number; to: number }[] }
  | { kind: 'meta'; text: string };

type SplitRow =
  | { kind: 'hunk'; hunk: PatchHunk; index: number }
  | { kind: 'pair'; left?: Extract<Row, { kind: 'line' }>; right?: Extract<Row, { kind: 'line' }> }
  | { kind: 'meta'; text: string };

function intraline(a: string, b: string) {
  if (a.length + b.length > 600) return { left: [], right: [] };
  const parts = diffWordsWithSpace(a, b);
  const left: { from: number; to: number }[] = [];
  const right: { from: number; to: number }[] = [];
  let li = 0;
  let ri = 0;
  let changed = 0;
  for (const p of parts) {
    if (p.added) {
      right.push({ from: ri, to: ri + p.value.length });
      ri += p.value.length;
      changed += p.value.length;
    } else if (p.removed) {
      left.push({ from: li, to: li + p.value.length });
      li += p.value.length;
      changed += p.value.length;
    } else {
      li += p.value.length;
      ri += p.value.length;
    }
  }
  // Mostly-rewritten lines read better without marks.
  if (changed > (a.length + b.length) * 0.7) return { left: [], right: [] };
  return { left, right };
}

function buildRows(hunks: PatchHunk[]): Row[] {
  const rows: Row[] = [];
  hunks.forEach((hunk, index) => {
    rows.push({ kind: 'hunk', hunk, index });
    let o = hunk.oldStart;
    let n = hunk.newStart;
    let dels: Extract<Row, { kind: 'line' }>[] = [];
    let adds: Extract<Row, { kind: 'line' }>[] = [];
    const flush = () => {
      const pairs = Math.min(dels.length, adds.length);
      for (let i = 0; i < pairs; i++) {
        const m = intraline(dels[i].text, adds[i].text);
        dels[i].marks = m.left;
        adds[i].marks = m.right;
      }
      rows.push(...dels, ...adds);
      dels = [];
      adds = [];
    };
    for (const raw of hunk.lines) {
      const sign = raw[0];
      const text = raw.slice(1);
      if (sign === '-') dels.push({ kind: 'line', type: 'del', oldNo: o++, text });
      else if (sign === '+') adds.push({ kind: 'line', type: 'add', newNo: n++, text });
      else if (sign === '\\') {
        flush();
        rows.push({ kind: 'meta', text: raw.slice(2) });
      } else {
        flush();
        rows.push({ kind: 'line', type: 'ctx', oldNo: o++, newNo: n++, text });
      }
    }
    flush();
  });
  return rows;
}

function toSplit(rows: Row[]): SplitRow[] {
  const out: SplitRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    if (r.kind !== 'line') {
      out.push(r);
      i++;
      continue;
    }
    if (r.type === 'ctx') {
      out.push({ kind: 'pair', left: r, right: r });
      i++;
      continue;
    }
    const dels: Extract<Row, { kind: 'line' }>[] = [];
    const adds: Extract<Row, { kind: 'line' }>[] = [];
    while (i < rows.length && rows[i].kind === 'line' && (rows[i] as Extract<Row, { kind: 'line' }>).type === 'del') dels.push(rows[i++] as Extract<Row, { kind: 'line' }>);
    while (i < rows.length && rows[i].kind === 'line' && (rows[i] as Extract<Row, { kind: 'line' }>).type === 'add') adds.push(rows[i++] as Extract<Row, { kind: 'line' }>);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push({ kind: 'pair', left: dels[k], right: adds[k] });
  }
  return out;
}

const SYN_CLASSES: Record<string, string> = {
  'syn-comment': s.synComment,
  'syn-keyword': s.synKeyword,
  'syn-tag': s.synTag,
  'syn-attr': s.synAttr,
  'syn-string': s.synString,
  'syn-number': s.synNumber,
  'syn-property': s.synProperty,
  'syn-fn': s.synFn,
  'syn-punct': s.synPunct,
  'syn-invalid': s.synInvalid,
};

export const RELIABILITY_META: Record<Reliability, { tone: 'success' | 'accent' | 'warning' | 'danger'; icon: typeof CircleCheck; short: string }> = {
  exact: { tone: 'success', icon: CircleCheck, short: 'Exact' },
  appended: { tone: 'accent', icon: CirclePlus, short: 'Appended' },
  review: { tone: 'warning', icon: Eye, short: 'Review' },
  unmapped: { tone: 'danger', icon: Info, short: 'Not mapped' },
};

export function ReliabilityBadge({ label }: { label: HunkLabel }) {
  const meta = RELIABILITY_META[label.reliability];
  const Icon = meta.icon;
  const body = (
    <span>
      <Badge tone={meta.tone}>
        <Icon size={10} />
        {label.label}
      </Badge>
    </span>
  );
  return label.detail ? <Tooltip content={label.detail}>{body}</Tooltip> : body;
}

function Code({ text, spans, marks, markCls }: { text: string; spans: Span[]; marks?: { from: number; to: number }[]; markCls: string }) {
  const segs = segmentsFor(text, spans, marks);
  return (
    <span className={s.code}>
      {segs.length ? segs.map((g, i) => <span key={i} className={clsx(g.cls, g.mark && markCls)}>{g.text}</span>) : '​'}
    </span>
  );
}

export const DiffView = memo(function DiffView({
  file,
  mode = 'inline',
  labels = true,
  maxRows = 3000,
  collapsible = true,
  defaultOpen = true,
  dense,
}: {
  file: FilePatch;
  mode?: 'inline' | 'split';
  labels?: boolean;
  maxRows?: number;
  collapsible?: boolean;
  defaultOpen?: boolean;
  dense?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [limit, setLimit] = useState(maxRows);
  const lang = languageFor(file.path);
  const before = useMemo(() => highlightLines(file.before, lang, SYN_CLASSES), [file.before, lang]);
  const after = useMemo(() => highlightLines(file.after, lang, SYN_CLASSES), [file.after, lang]);
  const rows = useMemo(() => buildRows(file.hunks), [file.hunks]);
  const split = useMemo(() => (mode === 'split' ? toSplit(rows) : null), [rows, mode]);
  const spansFor = (r: Extract<Row, { kind: 'line' }>) => (r.type === 'add' ? after.spans[(r.newNo ?? 1) - 1] : before.spans[(r.oldNo ?? 1) - 1]) ?? [];

  const hunkHeader = (hunk: PatchHunk, index: number) => (
    <div className={s.hunk} key={`h${index}`}>
      <span className={s.hunkRange}>
        @@ −{hunk.oldLines === 0 ? Math.max(0, hunk.oldStart - 1) : hunk.oldStart},{hunk.oldLines} +{hunk.newLines === 0 ? Math.max(0, hunk.newStart - 1) : hunk.newStart},{hunk.newLines} @@
      </span>
      {labels && (
        <span className={s.hunkLabels}>
          {hunk.labels.map((l, i) => (
            <ReliabilityBadge key={i} label={l} />
          ))}
        </span>
      )}
    </div>
  );

  const total = split ? split.length : rows.length;
  return (
    <div className={clsx(s.file, dense && s.dense)} data-testid="diff-file" data-path={file.path}>
      <div className={s.fileHeader} onClick={collapsible ? () => setOpen((o) => !o) : undefined} data-clickable={collapsible ? 'true' : undefined}>
        {file.isNew ? <FilePlus2 size={13} className={s.newIcon} /> : <FileDiff size={13} className={s.fileIcon} />}
        <span className={s.path}>{file.path}</span>
        {file.isNew && <Badge tone="accent">new file</Badge>}
        <span style={{ flex: 1 }} />
        <span className={s.adds}>+{file.additions}</span>
        <span className={s.dels}>−{file.deletions}</span>
      </div>
      {open && (
        <div className={s.body}>
          {split ? (
            <div className={s.table} data-mode="split">
              {split.slice(0, limit).map((r, i) => {
                if (r.kind === 'hunk') return hunkHeader(r.hunk, r.index);
                if (r.kind === 'meta')
                  return (
                    <div key={i} className={s.meta}>
                      {r.text}
                    </div>
                  );
                return (
                  <div key={i} className={s.splitRow}>
                    <span className={clsx(s.no, r.left?.type === 'del' && s.noDel)}>{r.left?.oldNo ?? ''}</span>
                    <span className={clsx(s.cell, r.left?.type === 'del' && s.del, !r.left && s.empty)}>
                      {r.left && <Code text={r.left.text} spans={spansFor(r.left)} marks={r.left.type === 'del' ? r.left.marks : undefined} markCls={s.markDel} />}
                    </span>
                    <span className={clsx(s.no, r.right?.type === 'add' && s.noAdd)}>{r.right?.newNo ?? ''}</span>
                    <span className={clsx(s.cell, r.right?.type === 'add' && s.add, !r.right && s.empty)}>
                      {r.right && <Code text={r.right.text} spans={spansFor(r.right)} marks={r.right.type === 'add' ? r.right.marks : undefined} markCls={s.markAdd} />}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={s.table} data-mode="inline">
              {rows.slice(0, limit).map((r, i) => {
                if (r.kind === 'hunk') return hunkHeader(r.hunk, r.index);
                if (r.kind === 'meta')
                  return (
                    <div key={i} className={s.meta}>
                      {r.text}
                    </div>
                  );
                return (
                  <div key={i} className={clsx(s.inlineRow, r.type === 'add' && s.add, r.type === 'del' && s.del)}>
                    <span className={clsx(s.no, r.type === 'del' && s.noDel)}>{r.oldNo ?? ''}</span>
                    <span className={clsx(s.no, r.type === 'add' && s.noAdd)}>{r.newNo ?? ''}</span>
                    <span className={s.sign}>{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ''}</span>
                    <Code text={r.text} spans={spansFor(r)} marks={r.marks} markCls={r.type === 'add' ? s.markAdd : s.markDel} />
                  </div>
                );
              })}
            </div>
          )}
          {total > limit && (
            <button className={s.more} onClick={() => setLimit((l) => l + maxRows)}>
              Show {Math.min(maxRows, total - limit)} more lines
            </button>
          )}
        </div>
      )}
    </div>
  );
});

/** Parse a git unified diff (as returned by `git diff`) into FilePatch-like objects for display. */
export function parseUnifiedDiff(text: string): FilePatch[] {
  const files: FilePatch[] = [];
  const chunks = text.split(/^diff --git /m).filter((c) => c.trim());
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const head = /^a\/(.+?) b\/(.+)$/.exec(lines[0] ?? '');
    let path = head?.[2] ?? lines[0];
    const isNew = lines.some((l) => l.startsWith('new file mode'));
    const hunks: PatchHunk[] = [];
    let cur: PatchHunk | null = null;
    let additions = 0;
    let deletions = 0;
    for (const l of lines.slice(1)) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
      if (m) {
        cur = { oldStart: Number(m[1]), oldLines: m[2] === undefined ? 1 : Number(m[2]), newStart: Number(m[3]), newLines: m[4] === undefined ? 1 : Number(m[4]), lines: [], labels: [] };
        hunks.push(cur);
        continue;
      }
      if (l.startsWith('+++ ')) {
        const p = l.slice(4).replace(/^b\//, '');
        if (p !== '/dev/null') path = p;
        continue;
      }
      if (!cur || l.startsWith('--- ') || l.startsWith('index ') || l.startsWith('similarity') || l.startsWith('rename ')) continue;
      if (l.startsWith('+')) additions++;
      else if (l.startsWith('-')) deletions++;
      if (/^[ +\-\\]/.test(l)) cur.lines.push(l);
    }
    // Reconstruct partial before/after texts for highlighting (hunk-local).
    const before: string[] = [];
    const after: string[] = [];
    for (const h of hunks) {
      let o = h.oldStart - 1;
      let n = h.newStart - 1;
      for (const l of h.lines) {
        if (l[0] === '-' || l[0] === ' ') before[o++] = l.slice(1);
        if (l[0] === '+' || l[0] === ' ') after[n++] = l.slice(1);
      }
    }
    const fill = (a: string[]) => Array.from({ length: a.length }, (_, i) => a[i] ?? '').join('\n');
    files.push({ path, isNew, before: fill(before), after: fill(after), edits: [], hunks, additions, deletions, unified: `diff --git ${chunk}`, language: 'text' });
  }
  return files;
}
