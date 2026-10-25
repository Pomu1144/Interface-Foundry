import { CornerDownRight } from 'lucide-react';
import type { NodeInfo } from '@shared/types';
import { Grid, Row, Section } from '@/ui';
import { studio, useStudio } from '@/store';
import { refreshSelection, watchOverlayIds } from '@/modules/preview-runtime/sync';
import { StyleNumber, StyleSelect } from './fields';
import s from './inspector.module.css';

/** Plain-language explanation of why the element is sized and placed the way it is. */
export function explainLayout(info: NodeInfo): string[] {
  const c = info.computed;
  const L = info.layout;
  const out: string[] = [];
  if (c.display === 'none') return ['This element is not rendered (display: none).'];
  if (L.isFlexItem) {
    const dir = L.flexDirection ?? 'row';
    const main = dir.startsWith('row') ? 'width' : 'height';
    out.push(
      `It is a <b>flex item</b> in a ${dir} flex container. Its ${main} starts from <b>flex-basis ${c['flex-basis']}</b>, ${c['flex-grow'] !== '0' ? `grows to fill space (flex-grow ${c['flex-grow']})` : 'does not grow'}, and ${c['flex-shrink'] !== '0' ? `can shrink (flex-shrink ${c['flex-shrink']})` : '<b>cannot shrink</b> (flex-shrink 0)'}.`,
    );
    if (c['min-width'] === 'auto' && main === 'width') out.push('Its min-width is <b>auto</b>, so it will not shrink below its content’s minimum width — a common cause of overflow with long words or fixed-width children.');
  } else if (L.isGridItem) {
    out.push(`It is a <b>grid item</b> placed at column <b>${c['grid-column']}</b>, row <b>${c['grid-row']}</b>.`);
  } else if (/^(block|flow-root|list-item)$/.test(c.display)) {
    out.push(`It is a <b>block</b> in normal flow: ${c.width === 'auto' ? 'its width fills the containing block' : `its width is <b>${c.width}</b>`}${c['max-width'] !== 'none' ? `, capped by max-width <b>${c['max-width']}</b>` : ''}${c['min-width'] !== 'auto' && c['min-width'] !== '0px' ? `, at least <b>${c['min-width']}</b>` : ''}.`);
  } else if (c.display.startsWith('inline')) {
    out.push(`It is <b>${c.display}</b>, sized by its content and line box.`);
  }
  if (c.display.includes('flex')) out.push(`It lays out its own children with flexbox (${c['flex-direction']}, gap ${c.gap}).`);
  if (c.display.includes('grid')) out.push(`It lays out its own children on a grid: columns <b>${c['grid-template-columns']}</b>.`);
  if (L.isPositioned) {
    out.push(
      c.position === 'fixed' || c.position === 'sticky'
        ? `It is <b>${c.position}</b>; its position depends on the viewport${c.position === 'sticky' ? ' while scrolling' : ''}.`
        : `It is <b>${c.position}</b> positioned (top ${c.top}, left ${c.left}).`,
    );
  }
  const vpw = studio().instances[studio().selection.instanceId ?? 'primary']?.viewport?.width;
  if (vpw && info.rect.x + info.rect.width > vpw + 1) out.push(`<b>It extends ${Math.round(info.rect.x + info.rect.width - vpw)}px past the right edge of the ${vpw}px viewport.</b>`);
  if (L.overflowAncestors.length) out.push(`It is clipped by ${L.overflowAncestors.length} ancestor${L.overflowAncestors.length > 1 ? 's' : ''} with overflow other than visible.`);
  return out;
}

export function LayoutTab() {
  const info = useStudio((st) => st.selection.info)!;
  useStudio((st) => st.changes.length);
  const c = info.computed;
  const L = info.layout;
  const select = (id: number) => {
    const st = studio();
    st.select(st.selection.instanceId, id, null);
    void refreshSelection();
    watchOverlayIds();
  };
  return (
    <>
      <Section title="Why it looks like this" id="layout-explain">
        <div className={s.explain}>
          {explainLayout(info).map((line, i) => (
            <p key={i} style={{ margin: i ? '6px 0 0' : 0 }} dangerouslySetInnerHTML={{ __html: line }} />
          ))}
        </div>
      </Section>
      <Section title="Layout context" id="layout-context">
        <dl className={s.kv}>
          <dt>display</dt>
          <dd>{c.display}</dd>
          <dt>parent display</dt>
          <dd>{L.parentDisplay ?? '—'}</dd>
          <dt>position</dt>
          <dd>{c.position}</dd>
          <dt>box-sizing</dt>
          <dd>{c['box-sizing']}</dd>
          <dt>overflow</dt>
          <dd>
            {c['overflow-x']} / {c['overflow-y']}
          </dd>
          <dt>z-index</dt>
          <dd>{c['z-index']}</dd>
        </dl>
      </Section>
      {L.isFlexItem && (
        <Section title="Flex item" id="layout-flexitem">
          <Grid cols={3}>
            <StyleNumber property="flex-grow" label="G" unit="" title="flex-grow" />
            <StyleNumber property="flex-shrink" label="S" unit="" title="flex-shrink" />
            <StyleNumber property="flex-basis" label="B" title="flex-basis" />
          </Grid>
          <div style={{ marginTop: 6 }}>
            <Row label="align-self">
              <StyleSelect property="align-self" options={['auto', 'flex-start', 'center', 'flex-end', 'stretch', 'baseline']} />
            </Row>
            <Row label="order">
              <StyleNumber property="order" unit="" />
            </Row>
          </div>
        </Section>
      )}
      {L.isGridItem && (
        <Section title="Grid item" id="layout-griditem">
          <dl className={s.kv}>
            <dt>grid-column</dt>
            <dd>{c['grid-column']}</dd>
            <dt>grid-row</dt>
            <dd>{c['grid-row']}</dd>
            <dt>justify-self</dt>
            <dd>{c['justify-self']}</dd>
            <dt>align-self</dt>
            <dd>{c['align-self']}</dd>
          </dl>
        </Section>
      )}
      <Section title="Position" id="layout-position">
        <div className={s.stack}>
          <Row label="position">
            <StyleSelect property="position" options={['static', 'relative', 'absolute', 'fixed', 'sticky']} />
          </Row>
          {L.isPositioned && (
            <Grid>
              <StyleNumber property="top" label="T" />
              <StyleNumber property="right" label="R" />
              <StyleNumber property="bottom" label="B" />
              <StyleNumber property="left" label="L" />
            </Grid>
          )}
          <Row label="z-index">
            <StyleNumber property="z-index" unit="" keywords={['auto']} />
          </Row>
          <Row label="overflow">
            <StyleSelect property="overflow-x" options={['visible', 'hidden', 'auto', 'scroll', 'clip']} />
          </Row>
        </div>
      </Section>
      <Section title="Overflow ancestors" id="layout-ancestors" defaultOpen={L.overflowAncestors.length > 0}>
        {L.overflowAncestors.length ? (
          L.overflowAncestors.map((a) => (
            <button key={a.id} className={s.linkRow} onClick={() => select(a.id)}>
              <CornerDownRight size={11} />
              {a.label}
              <span className={s.linkMeta}>{a.overflow}</span>
            </button>
          ))
        ) : (
          <div className={s.muted}>No ancestor clips this element.</div>
        )}
      </Section>
      <Section title="Ancestor chain" id="layout-path" defaultOpen={false}>
        {info.path.slice(0, -1).map((p) => (
          <button key={p.id} className={s.linkRow} onClick={() => select(p.id)}>
            {p.label}
          </button>
        ))}
      </Section>
    </>
  );
}
