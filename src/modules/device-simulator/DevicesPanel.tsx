import { Columns2, Settings2 } from 'lucide-react';
import type { DeviceCategory } from '@shared/types';
import { Badge, Button, Row, Section, Segmented, Select, Switch } from '@/ui';
import { studio, useStudio } from '@/store';
import { deviceArt } from '@/app/art';
import { DeviceGlyph } from '@/app/toolbar/DevicePicker';
import { runAction } from '@/app/actions';
import { BUILT_IN_DEVICES, RESPONSIVE_ID } from './devices';
import s from './devicespanel.module.css';

const CATS: { id: DeviceCategory; label: string }[] = [
  { id: 'foldable', label: 'Foldables' },
  { id: 'phone', label: 'Phones' },
  { id: 'tablet', label: 'Tablets' },
  { id: 'desktop', label: 'Desktop' },
  { id: 'custom', label: 'Custom' },
];

/** Android Studio-style device navigator plus simulation environment controls. */
export function DevicesPanel() {
  const viewport = useStudio((st) => st.viewport);
  const custom = useStudio((st) => st.customDevices);
  const settings = useStudio((st) => st.settings);
  const colorScheme = useStudio((st) => st.colorScheme);
  const fontScale = useStudio((st) => st.fontScale);
  const compare = useStudio((st) => st.compare);
  const all = [...BUILT_IN_DEVICES, ...custom];
  const current = all.find((d) => d.id === viewport.deviceId);
  return (
    <div className={s.root}>
      <Section title="Simulation" id="devices-sim">
        <div className={s.stack}>
          {current?.expanded && (
            <Row label="Posture">
              <Segmented
                ariaLabel="Posture"
                value={viewport.posture}
                onChange={(p) => studio().foldTo(p)}
                options={[
                  { value: 'folded', label: 'Folded' },
                  { value: 'expanded', label: 'Expanded' },
                ]}
              />
            </Row>
          )}
          <Row label="Orientation">
            <Segmented
              ariaLabel="Orientation"
              value={viewport.orientation}
              onChange={(orientation) => studio().setViewport({ orientation })}
              options={[
                { value: 'portrait', label: 'Portrait' },
                { value: 'landscape', label: 'Landscape' },
              ]}
            />
          </Row>
          <Row label="Color scheme">
            <Select
              ariaLabel="Color scheme"
              value={colorScheme ?? 'system'}
              onChange={(v) => studio().setColorScheme(v === 'system' ? null : (v as 'light' | 'dark'))}
              options={[
                { value: 'system', label: 'Follow system' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </Row>
          <Row label="Font scale">
            <Select
              ariaLabel="Font scale"
              value={String(fontScale)}
              onChange={(v) => studio().setFontScale(Number(v))}
              options={[0.85, 1, 1.15, 1.3, 1.6, 2].map((f) => ({ value: String(f), label: `${Math.round(f * 100)}%` }))}
            />
          </Row>
          <Row label="System UI">
            <Switch ariaLabel="System UI" checked={settings.showSystemUI} onChange={(showSystemUI) => studio().updateSettings({ showSystemUI })} />
          </Row>
          <Row label="Hinge">
            <Switch ariaLabel="Hinge" checked={settings.showHinge} onChange={(showHinge) => studio().updateSettings({ showHinge })} />
          </Row>
          <Button size="sm" variant={compare.enabled ? 'primary' : 'secondary'} icon={<Columns2 size={12} />} onClick={() => runAction('view.compare')}>
            {compare.enabled ? 'Comparing side by side' : 'Compare side by side'}
          </Button>
          <div className={s.note}>Font scale approximates Dynamic Type / Android font size by scaling the root font size; it only affects rem/em-based styles.</div>
        </div>
      </Section>
      <div className={s.list}>
        <button className={s.item} data-active={viewport.deviceId === RESPONSIVE_ID ? 'true' : undefined} onClick={() => studio().setViewport({ deviceId: RESPONSIVE_ID })}>
          <span className={s.glyph}>↔</span>
          <span className={s.name}>Responsive</span>
          <span className={s.meta}>drag to resize</span>
        </button>
        {CATS.map((c) => {
          const list = all.filter((d) => d.category === c.id);
          if (!list.length) return null;
          return (
            <div key={c.id}>
              <div className={s.group}>
                {deviceArt(c.id) && <img src={deviceArt(c.id)!} alt="" />}
                {c.label}
              </div>
              {list.map((d) => (
                <button key={d.id} className={s.item} data-active={d.id === viewport.deviceId ? 'true' : undefined} onClick={() => studio().setViewport({ deviceId: d.id })}>
                  <span className={s.glyph}>
                    <DeviceGlyph d={d} size={18} />
                  </span>
                  <span className={s.name}>{d.name}</span>
                  {d.verification.level === 'provisional' && <Badge tone="warning">P</Badge>}
                  <span className={s.meta}>
                    {d.folded.viewport.width}×{d.folded.viewport.height}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <div className={s.footer}>
        <Button size="sm" variant="ghost" icon={<Settings2 size={12} />} onClick={() => studio().setDialog('deviceManager', true)}>
          Device Manager…
        </Button>
      </div>
    </div>
  );
}
