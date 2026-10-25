import { useState } from 'react';
import { Section } from '@/ui';
import { useStudio } from '@/store';
import { setStyle } from '@/modules/change-manager/edit';
import { RESPONSIVE_ID } from '@/modules/device-simulator/devices';
import { frameSize, resolveViewport } from '@/modules/device-simulator/viewport';
import s from './box.module.css';

type Side = 'top' | 'right' | 'bottom' | 'left';

function Cell({ property, value, side }: { property: string; value: number; side: Side }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const display = Number.isFinite(value) ? (Math.round(value * 100) / 100).toString() : '–';
  const commit = () => {
    setEditing(false);
    const t = draft.trim();
    if (!t || t === display) return;
    setStyle(property, /^-?\d*\.?\d+$/.test(t) ? `${t}px` : t, 'box-model');
  };
  return (
    <span className={s.cell} data-side={side} data-zero={value === 0 ? 'true' : undefined}>
      {editing ? (
        <input
          className={s.cellInput}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const n = (parseFloat(draft) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1);
              setDraft(String(n));
              setStyle(property, `${n}px`, 'box-model');
            }
          }}
          spellCheck={false}
          aria-label={property}
        />
      ) : (
        <button
          className={s.cellButton}
          onClick={() => {
            setDraft(display === '–' ? '' : display);
            setEditing(true);
          }}
          title={`${property} — click to edit`}
        >
          {display}
        </button>
      )}
    </span>
  );
}

export function BoxModelTab() {
  const info = useStudio((st) => st.selection.info)!;
  const instance = useStudio((st) => st.instances[st.selection.instanceId ?? 'primary']);
  const device = useStudio((st) => st.device());
  const viewport = useStudio((st) => st.viewport);
  useStudio((st) => st.changes.length);
  const { margin: m, border: b, padding: p, content, offsets, position } = info.box;
  const positioned = position !== 'static';
  const vp = instance?.viewport;
  const frame = device.id === RESPONSIVE_ID ? null : frameSize(resolveViewport(device, viewport.posture, viewport.orientation).geometry);
  return (
    <>
      <div className={s.wrap}>
        <div className={s.diagram}>
          {positioned && (
            <div className={s.position}>
              <span className={s.label}>position</span>
              <Cell property="top" side="top" value={offsets.top} />
              <Cell property="right" side="right" value={offsets.right} />
              <Cell property="bottom" side="bottom" value={offsets.bottom} />
              <Cell property="left" side="left" value={offsets.left} />
            </div>
          )}
          <div className={s.margin}>
            <span className={s.label}>margin</span>
            <Cell property="margin-top" side="top" value={m.top} />
            <Cell property="margin-right" side="right" value={m.right} />
            <Cell property="margin-bottom" side="bottom" value={m.bottom} />
            <Cell property="margin-left" side="left" value={m.left} />
            <div className={s.border}>
              <span className={s.label}>border</span>
              <Cell property="border-top-width" side="top" value={b.top} />
              <Cell property="border-right-width" side="right" value={b.right} />
              <Cell property="border-bottom-width" side="bottom" value={b.bottom} />
              <Cell property="border-left-width" side="left" value={b.left} />
              <div className={s.padding}>
                <span className={s.label}>padding</span>
                <Cell property="padding-top" side="top" value={p.top} />
                <Cell property="padding-right" side="right" value={p.right} />
                <Cell property="padding-bottom" side="bottom" value={p.bottom} />
                <Cell property="padding-left" side="left" value={p.left} />
                <div className={s.content}>
                  {Math.round(content.width * 100) / 100} × {Math.round(content.height * 100) / 100}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className={s.hint}>Click any value to edit · ↑↓ to nudge · Shift ×10 · box-sizing: {info.box.boxSizing}</div>
      </div>
      <Section title="Dimensions" id="box-dims">
        <dl className={s.dims}>
          <dt>Element (border box)</dt>
          <dd>
            {Math.round(info.rect.width * 100) / 100} × {Math.round(info.rect.height * 100) / 100} CSS px
          </dd>
          <dt>Content box</dt>
          <dd>
            {Math.round(content.width * 100) / 100} × {Math.round(content.height * 100) / 100} CSS px
          </dd>
          <dt>Position in viewport</dt>
          <dd>
            x {Math.round(info.rect.x)}, y {Math.round(info.rect.y)}
          </dd>
          <dt>Viewport</dt>
          <dd>{vp ? `${vp.width} × ${vp.height} CSS px` : '—'}</dd>
          <dt>Device frame</dt>
          <dd>{frame ? `${Math.round(frame.width)} × ${Math.round(frame.height)} (incl. bezel)` : 'No frame (responsive)'}</dd>
          <dt>Pixel ratio</dt>
          <dd>
            {device.pixelRatio}× → element is {Math.round(info.rect.width * device.pixelRatio)} × {Math.round(info.rect.height * device.pixelRatio)} device px
          </dd>
        </dl>
      </Section>
    </>
  );
}
