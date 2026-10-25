import { AlertTriangle, Blocks, CircleCheck, CircleDashed, Component, FileCode2, GitCompareArrows, Paintbrush, ShieldOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ComponentInfo } from '@shared/types';
import { Badge, Button, Notice, Spinner, Tooltip } from '@/ui';
import { bus } from '@/lib/events';
import { studio, useStudio } from '@/store';
import { runAction } from '@/app/actions';
import { previews } from '@/modules/preview-runtime/registry';
import { componentForest } from './ComponentsPanel';
import s from './components.module.css';

const FRAMEWORK: Record<ComponentInfo['framework'], string> = { react: 'React', annotated: 'Annotated', vue: 'Vue', svelte: 'Svelte', unknown: 'Unknown' };

function SourceLink({ file, line, column }: { file: string; line?: number; column?: number }) {
  const short = file.split('/').slice(-2).join('/');
  return (
    <Tooltip content={`Open ${file}${line ? `:${line}` : ''} in the code editor`}>
      <button className={s.sourceLink} onClick={() => bus.emit('reveal-in-editor', { file, line })} data-testid="component-source">
        <FileCode2 size={12} />
        <span>
          {short}
          {line ? `:${line}` : ''}
          {column ? `:${column}` : ''}
        </span>
      </button>
    </Tooltip>
  );
}

export function ComponentTab() {
  const info = useStudio((st) => st.selection.info);
  const dom = useStudio((st) => st.dom);
  const scope = useStudio((st) => st.editTarget.scope);
  const [comp, setComp] = useState<ComponentInfo | null | undefined>(info?.component);
  const [loading, setLoading] = useState(false);

  // NodeInfo already carries the mapping; re-query so React/Vue chains are current after re-renders.
  useEffect(() => {
    setComp(info?.component);
    if (!info) return;
    const conn = previews.get(studio().selection.instanceId) ?? previews.primary();
    if (!conn?.ready) return;
    let cancelled = false;
    setLoading(true);
    conn
      .call('node.component', { id: info.id })
      .then((c) => !cancelled && setComp(c))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [info?.id, info?.selector]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!info) return null;
  if (loading && comp === undefined)
    return (
      <div className={s.tabLoading}>
        <Spinner />
      </div>
    );

  if (!comp)
    return (
      <div className={s.tab} data-testid="component-tab">
        <div className={s.noMap}>
          <span className={s.noMapIcon}>
            <ShieldOff size={16} />
          </span>
          <div>
            <div className={s.cardTitle}>Only the rendered DOM is available</div>
            <div className={s.cardText}>
              No framework component or IFDY annotation was found for <code>{info.label}</code>, so IFDY cannot tell which source file renders it. Nothing is guessed.
            </div>
          </div>
        </div>
        <div className={s.sectionTitle}>What you can do</div>
        <div className={s.steps}>
          <div className={s.step}>
            <Paintbrush size={13} />
            <span>Edit visually with CSS overrides — they apply live and stay reversible.</span>
            <Button size="sm" onClick={() => studio().setRightTab('design')}>
              Design tab
            </Button>
          </div>
          <div className={s.step}>
            <GitCompareArrows size={13} />
            <span>Export them as reviewable patches: rules are matched in your stylesheets, the rest goes to an overrides file.</span>
            <Button size="sm" onClick={() => runAction('export.open')}>
              Review patches
            </Button>
          </div>
        </div>
        <div className={s.sectionTitle}>Get exact mapping</div>
        <div className={s.cardText}>
          Run a development build of React (with source info), Vue or Svelte, or annotate markup:
          <pre className={s.snippet}>{`<form data-ifdy-component="LoginForm"\n      data-ifdy-source="src/login-form.js:13">`}</pre>
        </div>
      </div>
    );

  const exact = comp.reliability === 'exact';
  // Instance count: the adapter reports it for annotations; otherwise count matching names in the snapshot.
  const domCount = componentForest(dom).all.filter((c) => c.name === comp.name).length;
  const instances = comp.instances || domCount;
  return (
    <div className={s.tab} data-testid="component-tab">
      <div className={s.card}>
        <div className={s.cardHead}>
          <span className={s.compIcon}>
            <Component size={15} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className={s.compName} data-testid="component-name">
              {comp.name}
            </div>
            <div className={s.badges}>
              <Badge tone="violet">{FRAMEWORK[comp.framework]}</Badge>
              <Tooltip content={exact ? 'The framework or an annotation reported the source location.' : 'Component name only — no source location was reported, so file mapping is a guess.'}>
                <span>
                  <Badge tone={exact ? 'success' : 'warning'}>
                    {exact ? <CircleCheck size={10} /> : <CircleDashed size={10} />}
                    {exact ? 'Exact' : 'Heuristic'}
                  </Badge>
                </span>
              </Tooltip>
            </div>
          </div>
        </div>
        {comp.source ? (
          <SourceLink {...comp.source} />
        ) : (
          <div className={s.cardText}>No source location reported{comp.framework === 'react' ? ' (production builds strip _debugSource)' : ''}.</div>
        )}
      </div>

      {instances > 1 ? (
        <Notice tone="warning" icon={<AlertTriangle size={14} />}>
          <span data-testid="component-impact">
            Editing <b>{comp.name}</b> affects {instances} instances on this page.
          </span>{' '}
          {scope === 'selector' ? 'Class-level style edits apply to every match too.' : 'Element-level overrides only touch this one; source edits change them all.'}
        </Notice>
      ) : (
        <div className={s.cardText}>{instances === 1 ? 'Single instance on this page.' : `Instance count is not available for ${FRAMEWORK[comp.framework]} components (mapped per element).`}</div>
      )}

      {comp.chain.length > 1 && (
        <>
          <div className={s.sectionTitle}>Owner chain</div>
          <div className={s.chain}>
            {comp.chain.map((c, i) => (
              <div key={i} className={s.chainRow} style={{ paddingLeft: 8 + i * 10 }}>
                <Blocks size={11} />
                <span className={s.chainName}>{c.name}</span>
                <span style={{ flex: 1 }} />
                {c.source && (
                  <button className={s.chainSrc} onClick={() => bus.emit('reveal-in-editor', { file: c.source!.file, line: c.source!.line })} title={c.source.file}>
                    {c.source.file.split('/').pop()}
                    {c.source.line ? `:${c.source.line}` : ''}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {comp.props && Object.keys(comp.props).length > 0 && (
        <>
          <div className={s.sectionTitle}>
            Props <span className={s.muted}>sanitized · sensitive keys redacted</span>
          </div>
          <div className={s.props}>
            {Object.entries(comp.props).map(([k, v]) => (
              <div key={k} className={s.prop}>
                <span className={s.propKey}>{k}</span>
                <span className={s.propVal} data-redacted={v === '[redacted]' ? 'true' : undefined}>
                  {v}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className={s.sectionTitle}>How edits map</div>
      <div className={s.cardText}>
        {exact
          ? 'Style edits export as patches against the stylesheets that define the matched rules; markup changes belong in the component source above.'
          : 'Without a source location IFDY maps edits through CSS rules only; review each hunk’s reliability label before applying.'}
      </div>
      <div className={s.footActions}>
        {comp.source && (
          <Button size="sm" icon={<FileCode2 size={12} />} onClick={() => bus.emit('reveal-in-editor', { file: comp.source!.file, line: comp.source!.line })}>
            Open source
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<GitCompareArrows size={12} />} onClick={() => runAction('export.open')}>
          Review patches
        </Button>
      </div>
    </div>
  );
}
