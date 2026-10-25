import { ChevronRight, Copy, Download, FileJson, Layers, MoreHorizontal, Palette, Plus, Radar, RotateCcw, Ruler, Trash2, Upload, Wand2, X } from 'lucide-react';
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import type { DesignToken, TokenType } from '@shared/types';
import type { TokenUsage } from '@shared/protocol';
import { Badge, Button, ColorField, IconButton, Menu, NumberField, SearchInput, Select, Spinner, TextField, Tooltip } from '@/ui';
import { studio, useStudio } from '@/store';
import { previews } from '@/modules/preview-runtime/registry';
import { refreshSelection, watchOverlayIds } from '@/modules/preview-runtime/sync';
import { EmptyPanel } from '@/modules/export-engine/EmptyPanel';
import { downloadText, recordExport } from '@/modules/export-engine/engine';
import { TOKEN_TYPES, TOKEN_TYPE_LABEL, cssVarFromName, inferTokenType, isLengthValue, isValidCssVar, toCssVariables, toDtcg } from './dtcg';
import {
  applyTargets,
  applyTokenToSelection,
  cancelTokenPreview,
  commitTokenValue,
  createToken,
  definedOnPage,
  importDtcg,
  liveValue,
  onScanInfo,
  previewTokenValue,
  removeToken,
  resetToken,
  scanInfo,
  scanPageTokens,
  tokenUsageDetails,
  updateToken,
} from './tokens';
import s from './tokens.module.css';

type Filter = 'all' | TokenType;

const SHORT: Record<TokenType, string> = { color: 'Color', typography: 'Type', spacing: 'Space', radius: 'Radius', shadow: 'Shadow', breakpoint: 'Breakpoint', 'z-index': 'Z', other: 'Other' };

function useScanInfo() {
  useStudio((st) => st.project?.id);
  return useSyncExternalStore(onScanInfo, scanInfo);
}

export function TokensPanel() {
  const project = useStudio((st) => st.project);
  const tokens = useStudio((st) => st.tokens);
  const changes = useStudio((st) => st.changes);
  const transient = useStudio((st) => st.transient);
  const primaryReady = useStudio((st) => Object.values(st.instances).some((i) => i.role === 'primary' && i.status === 'ready'));
  const info = useScanInfo();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const values = useMemo(() => Object.fromEntries(tokens.map((t) => [t.cssVar, liveValue(t, changes, transient)])), [tokens, changes, transient]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tokens.length };
    for (const t of tokens) c[t.type] = (c[t.type] ?? 0) + 1;
    return c;
  }, [tokens]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tokens.filter((t) => (filter === 'all' || t.type === filter) && (!q || t.name.toLowerCase().includes(q) || t.cssVar.toLowerCase().includes(q) || values[t.cssVar]?.toLowerCase().includes(q)));
  }, [tokens, filter, query, values]);

  if (!project) return <EmptyPanel icon={Palette} title="No project">Open a project to manage its design tokens.</EmptyPanel>;

  const scan = async () => {
    setScanning(true);
    try {
      const r = await scanPageTokens();
      toast.success(`Scanned ${r.total} custom properties`, { description: `${r.added} new token(s), ${r.updated} updated. Types are inferred from names and values — adjust them if needed.` });
    } catch (err) {
      toast.error('Scan failed', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setScanning(false);
    }
  };

  const importFile = async (file: File) => {
    try {
      const json = JSON.parse(await file.text());
      const r = importDtcg(json);
      toast.success(`Imported ${r.added + r.updated} token(s)`, { description: `${r.added} new, ${r.updated} updated${r.warnings.length ? ` · ${r.warnings.length} warning(s): ${r.warnings.slice(0, 2).join(' ')}` : ''}` });
    } catch (err) {
      toast.error('Import failed', { description: err instanceof Error ? err.message : 'The file is not valid JSON.' });
    }
  };

  const exportJson = () => {
    downloadText('tokens.json', JSON.stringify(toDtcg(studio().tokens, values), null, 2) + '\n', 'application/json');
    recordExport({ kind: 'tokens', label: 'Downloaded tokens.json (DTCG)', changeCount: tokens.length });
  };
  const exportCss = () => {
    downloadText('tokens.css', toCssVariables(studio().tokens, values, { header: `Design tokens — ${project.name} (exported by IFDY)` }), 'text/css');
    recordExport({ kind: 'tokens', label: 'Downloaded tokens.css', changeCount: tokens.length });
  };
  const copyCss = async () => {
    try {
      await navigator.clipboard.writeText(toCssVariables(studio().tokens, values));
      toast.success('CSS variables copied');
    } catch {
      toast.error('Clipboard unavailable');
    }
  };

  const scanButton = (
    <Tooltip content={primaryReady ? 'Read :root custom properties and their usage from the page' : 'Connect a preview first'}>
      <span>
        <Button size="sm" icon={scanning ? <Spinner /> : <Radar size={12} />} disabled={!primaryReady || scanning} onClick={scan} data-testid="tokens-scan">
          Scan page
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <div className={s.wrap} data-testid="tokens-panel">
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0]).finally(() => (e.target.value = ''))} />
      <div className={s.toolbar}>
        {scanButton}
        <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => setCreating((c) => !c)} data-testid="tokens-new">
          New
        </Button>
        <span style={{ flex: 1 }} />
        <Menu
          align="end"
          trigger={
            <IconButton size="sm" label="Import / export">
              <MoreHorizontal size={14} />
            </IconButton>
          }
          items={[
            { label: 'Import DTCG JSON…', icon: <Upload size={13} />, onSelect: () => fileRef.current?.click() },
            { type: 'separator' },
            { label: 'Export DTCG JSON', icon: <FileJson size={13} />, disabled: !tokens.length, onSelect: exportJson },
            { label: 'Download tokens.css', icon: <Download size={13} />, disabled: !tokens.length, onSelect: exportCss },
            { label: 'Copy as CSS variables', icon: <Copy size={13} />, disabled: !tokens.length, onSelect: () => void copyCss() },
          ]}
        />
      </div>
      {creating && <NewToken onDone={() => setCreating(false)} />}
      {tokens.length > 0 && (
        <>
          <div className={s.search}>
            <SearchInput value={query} onChange={setQuery} placeholder="Filter by name, variable or value" />
          </div>
          <div className={s.filters} role="tablist" aria-label="Token type">
            {(['all', ...TOKEN_TYPES] as Filter[])
              .filter((f) => f === 'all' || counts[f])
              .map((f) => (
                <button key={f} role="tab" aria-selected={filter === f} className={s.filter} data-active={filter === f ? 'true' : undefined} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : SHORT[f]}
                  <span className={s.filterCount}>{counts[f] ?? 0}</span>
                </button>
              ))}
          </div>
        </>
      )}
      <div className={s.scroll}>
        {!tokens.length ? (
          <EmptyPanel
            icon={Palette}
            title="No design tokens yet"
            tone="molten"
            action={
              <>
                {scanButton}
                <Button size="sm" variant="ghost" icon={<Upload size={12} />} onClick={() => fileRef.current?.click()}>
                  Import JSON
                </Button>
              </>
            }
          >
            Scan the page to import its <code>:root</code> custom properties with usage counts, import a W3C DTCG file, or create tokens by hand.
          </EmptyPanel>
        ) : !visible.length ? (
          <EmptyPanel icon={Palette} title="No matching tokens" compact />
        ) : (
          TOKEN_TYPES.filter((type) => visible.some((t) => t.type === type)).map((type) => (
            <div key={type} className={s.group}>
              <div className={s.groupHead}>
                {TOKEN_TYPE_LABEL[type]}
                <span className={s.groupCount}>{visible.filter((t) => t.type === type).length}</span>
              </div>
              {visible
                .filter((t) => t.type === type)
                .map((t) => (
                  <TokenRow key={t.id} token={t} value={values[t.cssVar] ?? t.value} usage={info?.vars[t.cssVar]?.usage} open={openId === t.id} onToggle={() => setOpenId(openId === t.id ? null : t.id)} />
                ))}
            </div>
          ))
        )}
      </div>
      {info && tokens.length > 0 && <div className={s.foot}>Scanned {new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(info.at)} · {Object.keys(info.vars).length} variables on :root</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Preview({ token, value }: { token: DesignToken; value: string }) {
  switch (token.type) {
    case 'color':
      return (
        <span className={s.swatch}>
          <span style={{ background: value }} />
        </span>
      );
    case 'typography': {
      const family = /,|serif|sans|mono|["']/.test(value) && !/^\d/.test(value);
      const weight = /^(\d00|bold|normal)$/.test(value.trim());
      return (
        <span className={s.typo} style={{ fontFamily: family ? value : undefined, fontWeight: weight ? (value as never) : 600 }}>
          Aa
        </span>
      );
    }
    case 'spacing': {
      const px = toPx(value);
      return (
        <span className={s.spaceBox}>
          <span style={{ width: Math.max(2, Math.min(22, px ?? 4)) }} />
        </span>
      );
    }
    case 'radius':
      return <span className={s.radius} style={{ borderTopLeftRadius: Math.min(16, toPx(value) ?? 0) }} />;
    case 'shadow':
      return <span className={s.shadow} style={{ boxShadow: value }} />;
    case 'breakpoint':
      return (
        <span className={s.icon}>
          <Ruler size={12} />
        </span>
      );
    case 'z-index':
      return (
        <span className={s.icon}>
          <Layers size={12} />
        </span>
      );
    default:
      return <span className={s.icon}>{'{}'}</span>;
  }
}

function toPx(v: string): number | null {
  const m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(v.trim());
  if (!m) return null;
  return parseFloat(m[1]) * (m[2] === 'rem' || m[2] === 'em' ? 16 : 1);
}

function TokenRow({ token, value, usage, open, onToggle }: { token: DesignToken; value: string; usage?: number; open: boolean; onToggle: () => void }) {
  const edited = value !== token.value;
  return (
    <div className={s.item} data-open={open ? 'true' : undefined}>
      <button className={s.row} onClick={onToggle} data-testid="token-row" data-var={token.cssVar} aria-expanded={open}>
        <ChevronRight size={11} className={s.chev} />
        <Preview token={token} value={value} />
        <span className={s.names}>
          <span className={s.name}>{token.name}</span>
          {token.name !== token.cssVar.replace(/^--/, '') && <span className={s.var}>{token.cssVar}</span>}
        </span>
        <span className={s.value} title={value}>
          {value}
        </span>
        {edited && <span className={s.edited} title={`Edited · was ${token.value}`} />}
        {usage !== undefined && (
          <span className={s.usage} title={`Referenced by ${usage} declaration(s)`}>
            {usage}
          </span>
        )}
      </button>
      {open && <TokenEditor token={token} value={value} />}
    </div>
  );
}

function ValueField({ token, value }: { token: DesignToken; value: string }) {
  if (token.type === 'color')
    return <ColorField value={value} modified={value !== token.value} onChange={(v) => previewTokenValue(token, v)} onCommit={(v) => commitTokenValue(token, v)} />;
  if ((token.type === 'spacing' || token.type === 'radius' || token.type === 'breakpoint' || (token.type === 'typography' && isLengthValue(value))) && /^-?\d*\.?\d+[a-z%]*$/.test(value.trim()))
    return (
      <NumberField
        label={<Ruler size={11} />}
        value={value}
        step={/rem|em/.test(value) ? 0.125 : 1}
        unit={/^-?\d*\.?\d+([a-z%]*)$/.exec(value.trim())?.[1] || 'px'}
        modified={value !== token.value}
        onChange={(v) => previewTokenValue(token, v)}
        onCommit={(v) => (v ? commitTokenValue(token, v) : cancelTokenPreview())}
      />
    );
  if (token.type === 'z-index') return <NumberField value={value} unit="" label="z" onChange={(v) => previewTokenValue(token, v)} onCommit={(v) => v && commitTokenValue(token, v)} modified={value !== token.value} />;
  return <TextField value={value} mono modified={value !== token.value} onCommit={(v) => v.trim() && commitTokenValue(token, v.trim())} aria-label="Token value" />;
}

function TokenEditor({ token, value }: { token: DesignToken; value: string }) {
  const selection = useStudio((st) => st.selection.info);
  const scope = useStudio((st) => st.editTarget.scope);
  const [usage, setUsage] = useState<TokenUsage[] | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const pageDefined = definedOnPage(token.cssVar);
  const targets = applyTargets(token, value);

  const showUsage = async () => {
    setLoadingUsage(true);
    try {
      setUsage(await tokenUsageDetails(token.cssVar));
    } catch (err) {
      toast.error('Could not read usage', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoadingUsage(false);
    }
  };

  const selectUsage = async (u: TokenUsage) => {
    const conn = previews.primary();
    if (!conn?.ready) return;
    const id = await conn.call('dom.resolve', { selector: u.selector }).catch(() => null);
    if (!id) {
      toast(`No element currently matches ${u.selector}`);
      return;
    }
    studio().select(conn.id, id, null);
    void refreshSelection();
    watchOverlayIds();
    conn.tell('node.scrollIntoView', { id });
  };

  return (
    <div className={s.editor} data-testid="token-editor">
      <div className={s.field}>
        <span className={s.fieldLabel}>Value</span>
        <ValueField token={token} value={value} />
      </div>
      {value !== token.value && (
        <div className={s.editedLine}>
          <span>
            Edited · was <code>{token.value}</code>
          </span>
          <Button size="sm" variant="ghost" icon={<RotateCcw size={11} />} onClick={() => resetToken(token)}>
            Reset
          </Button>
        </div>
      )}
      <div className={s.field}>
        <span className={s.fieldLabel}>Name</span>
        <TextField value={token.name} onCommit={(name) => name.trim() && updateToken(token, { name: name.trim() })} aria-label="Token name" />
      </div>
      <div className={s.field}>
        <span className={s.fieldLabel}>Variable</span>
        {pageDefined ? (
          <Tooltip content="Defined by the page's CSS — renaming would need a source refactor">
            <span className={s.readonlyVar}>{token.cssVar}</span>
          </Tooltip>
        ) : (
          <TextField
            value={token.cssVar}
            mono
            aria-label="CSS variable"
            onCommit={(v) => {
              const next = v.trim().startsWith('--') ? v.trim() : `--${v.trim()}`;
              if (!isValidCssVar(next)) return toast.error('Not a valid custom property name');
              if (studio().tokens.some((x) => x.cssVar === next && x.id !== token.id)) return toast.error(`${next} already exists`);
              updateToken(token, { cssVar: next });
            }}
          />
        )}
      </div>
      <div className={s.field}>
        <span className={s.fieldLabel}>Type</span>
        <Select ariaLabel="Token type" value={token.type} options={TOKEN_TYPES.map((t) => ({ value: t, label: TOKEN_TYPE_LABEL[t] }))} onChange={(type) => updateToken(token, { type })} />
      </div>
      <div className={s.field}>
        <span className={s.fieldLabel}>Note</span>
        <TextField value={token.description ?? ''} placeholder="Description" onCommit={(d) => updateToken(token, { description: d.trim() || undefined })} aria-label="Description" />
      </div>

      <div className={s.sub}>
        Apply to selection
        {selection && <span className={s.subHint}>{scope === 'selector' ? 'all matches of' : ''} {selection.label}</span>}
      </div>
      {targets.length ? (
        <div className={s.applyRow}>
          {targets.map((tg) => (
            <Tooltip key={tg.id} content={selection ? `${tg.properties.join(', ')}: var(${token.cssVar})` : 'Select an element in the preview first'}>
              <span>
                <Button size="sm" icon={<Wand2 size={11} />} disabled={!selection} onClick={() => applyTokenToSelection(token, tg)} data-testid={`apply-${tg.id}`}>
                  {tg.label}
                </Button>
              </span>
            </Tooltip>
          ))}
        </div>
      ) : (
        <div className={s.hint}>{token.type === 'breakpoint' ? 'Custom properties cannot be used inside @media conditions; breakpoint tokens document widths for the media-query bar and exports.' : 'Use this token by referencing var(' + token.cssVar + ') in the Styles tab.'}</div>
      )}

      <div className={s.sub}>
        Usage
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" onClick={showUsage} disabled={loadingUsage} icon={loadingUsage ? <Spinner /> : undefined}>
          {usage ? 'Refresh' : 'Show where it is used'}
        </Button>
      </div>
      {usage &&
        (usage.length ? (
          <div className={s.usageList}>
            {usage.slice(0, 40).map((u, i) => (
              <button key={i} className={s.usageRow} onClick={() => void selectUsage(u)} title={`${u.selector} { ${u.property}: ${u.value} } — ${u.source}${u.media ? ` @media ${u.media}` : ''}`}>
                <span className={s.usageSel}>{u.selector}</span>
                <span className={s.usageProp}>{u.property}</span>
                <span className={s.usageSrc}>{u.source}</span>
                <Badge tone={u.matches ? 'neutral' : 'outline'}>{u.matches}</Badge>
              </button>
            ))}
            {usage.length > 40 && <div className={s.hint}>+{usage.length - 40} more</div>}
          </div>
        ) : (
          <div className={s.hint}>No rule on this page references {token.cssVar}.</div>
        ))}

      <div className={s.editorFoot}>
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash2 size={11} />}
          onClick={() => {
            removeToken(token);
            toast(`Deleted ${token.name}`, { description: pageDefined ? 'The page still defines this variable; only the library entry was removed.' : 'Its definition was removed from the preview.' });
          }}
        >
          Delete token
        </Button>
      </div>
    </div>
  );
}

function NewToken({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [type, setType] = useState<TokenType | 'auto'>('auto');
  const [cssVar, setCssVar] = useState('');
  const resolvedVar = cssVar || (name ? cssVarFromName(name) : '');
  const resolvedType = type === 'auto' ? inferTokenType(resolvedVar, value) : type;
  const exists = useStudio((st) => st.tokens.some((t) => t.cssVar === resolvedVar));
  const valid = name.trim() && value.trim() && isValidCssVar(resolvedVar) && !exists;
  const create = () => {
    if (!valid) return;
    const t = createToken({ name, type: resolvedType, value, cssVar: resolvedVar });
    toast.success(`Created ${t.cssVar}`, { description: definedOnPage(t.cssVar) ? undefined : 'Defined on :root in the preview so it can be used right away.' });
    onDone();
  };
  return (
    <div className={s.newToken} data-testid="new-token">
      <div className={s.newHead}>
        New token
        <IconButton size="sm" label="Cancel" onClick={onDone}>
          <X size={12} />
        </IconButton>
      </div>
      <TextField value={name} onCommit={setName} placeholder="Name (e.g. color.brand)" aria-label="New token name" autoFocus />
      <TextField value={value} onCommit={setValue} placeholder="Value (e.g. #0b2545, 16px)" mono aria-label="New token value" />
      <div className={s.newGrid}>
        <Select
          ariaLabel="New token type"
          value={type}
          onChange={setType}
          options={[{ value: 'auto' as const, label: `Auto · ${TOKEN_TYPE_LABEL[resolvedType]}` }, ...TOKEN_TYPES.map((t) => ({ value: t, label: TOKEN_TYPE_LABEL[t] }))]}
        />
        <TextField value={cssVar} onCommit={setCssVar} placeholder={resolvedVar || '--variable'} mono aria-label="New token CSS variable" />
      </div>
      {exists && <div className={s.error}>{resolvedVar} already exists.</div>}
      <Button size="sm" variant="primary" disabled={!valid} onClick={create} icon={<Plus size={12} />}>
        Create token
      </Button>
    </div>
  );
}
