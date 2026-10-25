import {
  AlignCenter,
  BookmarkPlus,
  Trash2,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowRight,
  Columns3,
  EyeOff,
  Grid2x2,
  ImageUp,
  Link,
  Maximize2,
  Minimize2,
  MoveHorizontal,
  Plus,
  Square,
  WrapText,
} from 'lucide-react';
import { useRef } from 'react';
import { Badge, Button, Grid, IconButton, Row, Section, Segmented, Slider, TextField } from '@/ui';
import { studio, useStudio } from '@/store';
import { cancelPreview, isHidden, previewStyle, setAttribute, setStyle, setStyles, setText, toggleHidden } from '@/modules/change-manager/edit';
import { StyleColor, StyleNumber, StyleSelect } from './fields';
import { applyPreset, saveSelectionAsStyle } from './presets';
import s from './inspector.module.css';

export function EditScopeBar() {
  const info = useStudio((st) => st.selection.info);
  const target = useStudio((st) => st.editTarget);
  const vw = useStudio((st) => st.instances[st.selection.instanceId ?? 'primary']?.viewport?.width);
  if (!info) return null;
  const classSel = info.classes.length ? `${info.tag}.${info.classes.slice(0, 3).join('.')}` : null;
  return (
    <div className={s.scopeBar}>
      <div className={s.scopeRow}>
        <span>Apply to</span>
        <Segmented
          ariaLabel="Edit scope"
          value={target.scope}
          onChange={(scope) => studio().setEditTarget({ scope })}
          options={[
            { value: 'element', label: 'This element' },
            { value: 'selector', label: 'All matching', disabled: !classSel, title: classSel ? `Every element matching ${classSel}` : 'Element has no classes' },
          ]}
        />
      </div>
      <div className={s.scopeRow}>
        <span>Widths</span>
        <Segmented
          ariaLabel="Viewport scope"
          value={target.media}
          onChange={(media) => studio().setEditTarget({ media })}
          options={[
            { value: 'all', label: 'All' },
            { value: 'at-most', label: `≤ ${vw ?? '…'}px`, title: 'Wrap edits in @media (max-width: current width)' },
            { value: 'at-least', label: `≥ ${vw ?? '…'}px`, title: 'Wrap edits in @media (min-width: current width)' },
          ]}
        />
      </div>
      <div className={s.scopeHint} title={target.scope === 'selector' ? classSel ?? '' : info.selector}>
        {target.scope === 'selector' ? classSel : info.selector}
      </div>
    </div>
  );
}

function SizingMode({ axis }: { axis: 'width' | 'height' }) {
  const info = useStudio((st) => st.selection.info)!;
  const raw = info.computed[axis];
  const parentFlexRow = info.layout.isFlexItem && (info.layout.flexDirection ?? 'row').startsWith('row');
  const mainAxis = (axis === 'width' && parentFlexRow) || (axis === 'height' && info.layout.isFlexItem && !parentFlexRow);
  const mode = info.computed['flex-grow'] !== '0' && mainAxis ? 'fill' : raw === 'auto' || raw === 'fit-content' ? 'hug' : 'fixed';
  return (
    <Segmented
      ariaLabel={`${axis} sizing`}
      value={mode}
      onChange={(m) => {
        if (m === 'fill') {
          if (mainAxis) setStyles([{ property: 'flex', value: '1 1 0%' }]);
          else setStyles([{ property: axis, value: '100%' }]);
        } else if (m === 'hug') {
          if (mainAxis) setStyles([{ property: 'flex', value: '0 0 auto' }, { property: axis, value: 'fit-content' }]);
          else setStyle(axis, axis === 'width' ? 'fit-content' : 'auto');
        } else {
          const px = Math.round(axis === 'width' ? info.rect.width : info.rect.height);
          if (mainAxis) setStyles([{ property: 'flex', value: `0 0 ${px}px` }]);
          else setStyle(axis, `${px}px`);
        }
      }}
      options={[
        { value: 'fixed', icon: <Square size={11} />, title: 'Fixed size' },
        { value: 'hug', icon: <Minimize2 size={11} />, title: mainAxis ? 'Hug contents (flex: 0 0 auto)' : 'Hug contents (fit-content)' },
        { value: 'fill', icon: <Maximize2 size={11} />, title: mainAxis ? 'Fill container (flex: 1 1 0%)' : 'Fill container (100%)' },
      ]}
    />
  );
}

const JUSTIFY = ['flex-start', 'center', 'flex-end'];

function AlignmentGrid() {
  const info = useStudio((st) => st.selection.info)!;
  const c = info.computed;
  const row = (c['flex-direction'] ?? 'row').startsWith('row');
  const j = JUSTIFY.indexOf(c['justify-content'] === 'normal' || c['justify-content'] === 'start' ? 'flex-start' : c['justify-content'] === 'end' ? 'flex-end' : c['justify-content']);
  const a = JUSTIFY.indexOf(c['align-items'] === 'normal' || c['align-items'] === 'stretch' || c['align-items'] === 'start' ? 'flex-start' : c['align-items'] === 'end' ? 'flex-end' : c['align-items']);
  return (
    <div className={s.alignGrid} role="grid" aria-label="Alignment">
      {Array.from({ length: 9 }).map((_, i) => {
        const col = i % 3;
        const r = Math.floor(i / 3);
        const on = row ? col === j && r === a : r === j && col === a;
        return (
          <button
            key={i}
            className={s.alignCell}
            data-on={on ? 'true' : undefined}
            aria-label={`Align ${['top', 'middle', 'bottom'][r]} ${['left', 'center', 'right'][col]}`}
            onClick={() =>
              setStyles([
                { property: 'justify-content', value: JUSTIFY[row ? col : r] },
                { property: 'align-items', value: JUSTIFY[row ? r : col] },
              ])
            }
          />
        );
      })}
    </div>
  );
}

const WEIGHTS = ['100', '200', '300', '400', '500', '600', '700', '800', '900'].map((w) => ({ value: w, label: `${w} ${{ '100': 'Thin', '200': 'Extra Light', '300': 'Light', '400': 'Regular', '500': 'Medium', '600': 'Semibold', '700': 'Bold', '800': 'Extra Bold', '900': 'Black' }[w]}` }));

const SHADOWS = [
  { label: 'None', value: 'none' },
  { label: 'Soft', value: '0 1px 2px rgba(15, 23, 42, 0.08), 0 1px 3px rgba(15, 23, 42, 0.06)' },
  { label: 'Medium', value: '0 4px 12px rgba(15, 23, 42, 0.12), 0 2px 4px rgba(15, 23, 42, 0.06)' },
  { label: 'Large', value: '0 18px 40px -12px rgba(15, 23, 42, 0.28), 0 6px 14px rgba(15, 23, 42, 0.08)' },
];

function SavedStyles() {
  const presets = useStudio((st) => st.stylePresets);
  return (
    <Section
      title="Saved styles"
      id="design-presets"
      defaultOpen={presets.length > 0}
      actions={
        <IconButton size="sm" label="Save selection as a reusable style" onClick={() => saveSelectionAsStyle()}>
          <BookmarkPlus size={13} />
        </IconButton>
      }
    >
      {presets.length === 0 ? (
        <div className={s.muted}>Save an element's typography, colors, borders and effects as a reusable style, then apply it to any other element.</div>
      ) : (
        <div className={s.stack}>
          {presets.map((p) => {
            const get = (k: string) => p.declarations.find((d) => d.property === k)?.value;
            return (
              <div key={p.id} className={s.presetRow}>
                <span
                  className={s.presetSwatch}
                  style={{ background: get('background-color') ?? 'transparent', color: get('color'), fontWeight: Number(get('font-weight')) || 500, borderRadius: get('border-radius'), boxShadow: get('box-shadow') }}
                >
                  Aa
                </span>
                <TextField className={s.presetName} value={p.name} onCommit={(name) => name && studio().upsertStylePreset({ ...p, name })} />
                <Button size="sm" onClick={() => applyPreset(p)}>
                  Apply
                </Button>
                <IconButton size="sm" label="Delete style" onClick={() => studio().deleteStylePreset(p.id)}>
                  <Trash2 size={12} />
                </IconButton>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

export function DesignTab() {
  const info = useStudio((st) => st.selection.info)!;
  useStudio((st) => st.changes.length);
  const fileRef = useRef<HTMLInputElement>(null);
  const c = info.computed;
  const isFlex = c.display.includes('flex');
  const isGrid = c.display.includes('grid');
  const hidden = isHidden(info.selector);
  const hasText = info.editableText;
  const src = info.attrs.find(([k]) => k === 'src')?.[1];

  return (
    <>
      <EditScopeBar />

      {hasText && (
        <Section title="Content" id="design-content">
          <textarea
            className={s.textarea}
            defaultValue={info.text}
            key={`${info.id}-${info.text}`}
            onBlur={(e) => {
              if (e.target.value !== info.text) setText(info.selector, info.label, info.text ?? '', e.target.value);
            }}
            aria-label="Text content"
          />
          <div className={s.muted}>Double-click text on the canvas to edit it in place.</div>
        </Section>
      )}

      {info.isImage && (
        <Section title="Image" id="design-image">
          <div className={s.imagePreview}>
            {src && <img src={src} alt="" />}
            <div className={s.stack}>
              <Button size="sm" icon={<ImageUp size={12} />} onClick={() => fileRef.current?.click()}>
                Replace image…
              </Button>
              <span className={s.muted}>Replacement is a reversible override; the original file is untouched.</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = () => setAttribute('src', String(r.result), 'assets', 'asset');
                r.readAsDataURL(f);
                e.target.value = '';
              }}
            />
          </div>
          <Row label="Object fit">
            <StyleSelect property="object-fit" options={['fill', 'contain', 'cover', 'none', 'scale-down']} />
          </Row>
        </Section>
      )}

      <Section
        title="Size"
        id="design-size"
        actions={
          <Badge tone="outline" title="Rendered border-box size">
            {Math.round(info.rect.width)} × {Math.round(info.rect.height)}
          </Badge>
        }
      >
        <div className={s.stack}>
          <div className={s.sizing}>
            <StyleNumber property="width" label="W" />
            <StyleNumber property="height" label="H" />
            <SizingMode axis="width" />
            <SizingMode axis="height" />
          </div>
          <Grid>
            <StyleNumber property="min-width" label="Min" title="min-width" />
            <StyleNumber property="max-width" label="Max" title="max-width" />
          </Grid>
          {info.layout.isPositioned && (
            <Grid>
              <StyleNumber property="left" label="X" title="left" />
              <StyleNumber property="top" label="Y" title="top" />
            </Grid>
          )}
        </div>
      </Section>

      <Section
        title={isFlex ? 'Auto layout (flex)' : isGrid ? 'Grid layout' : 'Layout'}
        id="design-layout"
        actions={
          !isFlex && !isGrid ? (
            <IconButton size="sm" label="Add auto layout (display: flex)" onClick={() => setStyles([{ property: 'display', value: 'flex' }, { property: 'gap', value: '8px' }])}>
              <Plus size={13} />
            </IconButton>
          ) : undefined
        }
      >
        {isFlex ? (
          <div className={s.stack}>
            <div className={s.autoLayout}>
              <AlignmentGrid />
              <div className={s.stack} style={{ flex: 1 }}>
                <Segmented
                  ariaLabel="Direction"
                  value={c['flex-direction'].startsWith('column') ? 'column' : 'row'}
                  onChange={(v) => setStyle('flex-direction', v)}
                  options={[
                    { value: 'row', icon: <ArrowRight size={12} />, label: 'Row' },
                    { value: 'column', icon: <ArrowDown size={12} />, label: 'Column' },
                  ]}
                />
                <StyleNumber property="gap" label={<MoveHorizontal size={11} />} title="gap" />
                <Segmented
                  ariaLabel="Wrap"
                  value={c['flex-wrap'] === 'wrap' ? 'wrap' : 'nowrap'}
                  onChange={(v) => setStyle('flex-wrap', v)}
                  options={[
                    { value: 'nowrap', label: 'No wrap' },
                    { value: 'wrap', label: 'Wrap', icon: <WrapText size={11} /> },
                  ]}
                />
              </div>
            </div>
            <Row label="Distribute">
              <StyleSelect property="justify-content" options={['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']} />
            </Row>
          </div>
        ) : isGrid ? (
          <div className={s.stack}>
            <Row label="Columns">
              <span className={s.mono} title={c['grid-template-columns']}>
                {c['grid-template-columns'].split(' ').length} · {c['grid-template-columns'].length > 28 ? c['grid-template-columns'].slice(0, 27) + '…' : c['grid-template-columns']}
              </span>
            </Row>
            <Grid>
              <StyleNumber property="column-gap" label="Col" title="column-gap" />
              <StyleNumber property="row-gap" label="Row" title="row-gap" />
            </Grid>
          </div>
        ) : (
          <div className={s.stack}>
            <Row label="Display">
              <StyleSelect property="display" options={['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'none']} />
            </Row>
            <div className={s.muted}>
              <Columns3 size={11} style={{ verticalAlign: -2 }} /> Add auto layout to arrange children with flexbox, or <Grid2x2 size={11} style={{ verticalAlign: -2 }} /> switch display to grid.
            </div>
          </div>
        )}
      </Section>

      <Section title="Spacing" id="design-spacing">
        <div className={s.stack}>
          <div className={s.muted}>Padding</div>
          <Grid>
            <StyleNumber property="padding-top" label="T" />
            <StyleNumber property="padding-bottom" label="B" />
            <StyleNumber property="padding-left" label="L" />
            <StyleNumber property="padding-right" label="R" />
          </Grid>
          <div className={s.muted}>Margin</div>
          <Grid>
            <StyleNumber property="margin-top" label="T" />
            <StyleNumber property="margin-bottom" label="B" />
            <StyleNumber property="margin-left" label="L" />
            <StyleNumber property="margin-right" label="R" />
          </Grid>
        </div>
      </Section>

      <Section title="Typography" id="design-type">
        <div className={s.stack}>
          <Row label="Font">
            <span className={s.mono} title={c['font-family']} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c['font-family'].split(',')[0].replace(/["']/g, '')}
            </span>
          </Row>
          <Grid>
            <StyleNumber property="font-size" label="Size" />
            <StyleSelect property="font-weight" options={WEIGHTS} ariaLabel="Font weight" />
            <StyleNumber property="line-height" label="LH" keywords={['normal']} step={0.05} unit="" />
            <StyleNumber property="letter-spacing" label="LS" keywords={['normal']} step={0.1} />
          </Grid>
          <Segmented
            ariaLabel="Text align"
            value={['left', 'center', 'right', 'justify'].includes(c['text-align']) ? c['text-align'] : c['text-align'] === 'start' ? 'left' : 'left'}
            onChange={(v) => setStyle('text-align', v)}
            options={[
              { value: 'left', icon: <AlignLeft size={12} />, title: 'Left' },
              { value: 'center', icon: <AlignCenter size={12} />, title: 'Center' },
              { value: 'right', icon: <AlignRight size={12} />, title: 'Right' },
              { value: 'justify', icon: <AlignJustify size={12} />, title: 'Justify' },
            ]}
          />
          <Row label="Color">
            <StyleColor property="color" />
          </Row>
          <Row label="Transform">
            <StyleSelect property="text-transform" options={['none', 'uppercase', 'lowercase', 'capitalize']} />
          </Row>
        </div>
      </Section>

      <Section title="Fill" id="design-fill">
        <div className={s.stack}>
          <Row label="Background">
            <StyleColor property="background-color" />
          </Row>
          {c['background-image'] !== 'none' && (
            <Row label="Image">
              <span className={s.mono} title={c['background-image']}>
                {c['background-image'].slice(0, 30)}…
              </span>
            </Row>
          )}
          <Row label="Opacity">
            <Slider ariaLabel="Opacity" value={Number(c.opacity)} onChange={(v) => previewStyle('opacity', v.toFixed(2))} onCommit={(v) => (cancelPreview(), setStyle('opacity', v.toFixed(2)))} />
          </Row>
        </div>
      </Section>

      <Section title="Stroke & corners" id="design-stroke">
        <div className={s.stack}>
          <Grid>
            <StyleNumber property="border-top-width" label="W" title="border-width (top)" />
            <StyleSelect property="border-top-style" options={['none', 'solid', 'dashed', 'dotted', 'double']} ariaLabel="Border style" />
          </Grid>
          <Row label="Stroke">
            <StyleColor property="border-top-color" />
          </Row>
          <StyleNumber property="border-radius" label="R" title="border-radius" keywords={['0']} />
        </div>
      </Section>

      <Section title="Effects" id="design-effects">
        <div className={s.shadowPresets}>
          {SHADOWS.map((sh) => (
            <button key={sh.label} className={s.shadowPreset} style={{ boxShadow: sh.value === 'none' ? undefined : sh.value }} onClick={() => setStyle('box-shadow', sh.value)}>
              {sh.label}
            </button>
          ))}
        </div>
        {c['box-shadow'] !== 'none' && (
          <div className={s.muted} style={{ marginTop: 8 }} title={c['box-shadow']}>
            {c['box-shadow'].slice(0, 80)}
          </div>
        )}
      </Section>

      <SavedStyles />

      <Section title="Visibility" id="design-visibility">
        <div className={s.stack}>
          <Button size="sm" variant={hidden ? 'primary' : 'secondary'} icon={<EyeOff size={12} />} onClick={() => toggleHidden(info)}>
            {hidden ? 'Hidden in preview — show' : 'Hide in preview'}
          </Button>
          <div className={s.muted}>
            <Link size={10} style={{ verticalAlign: -1 }} /> Preview-only and reversible. Exported as <code>display: none</code> only if you keep it.
          </div>
        </div>
      </Section>
    </>
  );
}
