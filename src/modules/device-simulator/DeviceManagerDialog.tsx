import { Copy, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DeviceProfile, FoldGeometry, PostureGeometry } from '@shared/types';
import { ArtIcon, Badge, Button, Dialog, Grid, NumberField, Notice, Select, Switch, TextField } from '@/ui';
import { studio, useStudio } from '@/store';
import { deviceArt } from '@/app/art';
import { DeviceGlyph } from '@/app/toolbar/DevicePicker';
import { BUILT_IN_DEVICES, makeGeometry, makeInsets } from './devices';
import s from './devicemanager.module.css';

/**
 * Android Studio-style Device Manager: browse, duplicate and author device
 * profiles (folded/expanded geometry, safe areas, hinge, DPR, UA).
 */
export function DeviceManagerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const custom = useStudio((st) => st.customDevices);
  const current = useStudio((st) => st.viewport.deviceId);
  const all = useMemo(() => [...BUILT_IN_DEVICES, ...custom], [custom]);
  const [selectedId, setSelectedId] = useState<string>(current);
  const selected = all.find((d) => d.id === selectedId) ?? all[0];
  const [draft, setDraft] = useState<DeviceProfile | null>(null);
  const editing = draft && draft.id === selected.id ? draft : null;
  const d = editing ?? selected;

  const duplicate = () => {
    const copy: DeviceProfile = JSON.parse(JSON.stringify(selected));
    copy.id = `custom-${Math.random().toString(36).slice(2, 8)}`;
    copy.name = `${selected.name} (custom)`;
    copy.builtIn = false;
    copy.verification = { level: 'custom', source: `Duplicated from ${selected.name}. ${selected.verification.source}` };
    studio().saveDevice(copy);
    setSelectedId(copy.id);
    setDraft(copy);
  };
  const create = () => {
    const dev: DeviceProfile = {
      id: `custom-${Math.random().toString(36).slice(2, 8)}`,
      name: 'New device',
      platform: 'generic',
      category: 'custom',
      pixelRatio: 2,
      touch: true,
      frameStyle: 'android-punch',
      folded: makeGeometry(400, 860, { safe: makeInsets(24, 0, 24, 0), radius: 32, bezel: makeInsets(11) }),
      verification: { level: 'custom', source: 'User-defined profile.' },
      builtIn: false,
    };
    studio().saveDevice(dev);
    setSelectedId(dev.id);
    setDraft(dev);
  };
  const update = (patch: Partial<DeviceProfile>) => setDraft({ ...(editing ?? selected), ...patch });
  const updateGeom = (posture: 'folded' | 'expanded', g: Partial<PostureGeometry>) => {
    const base = editing ?? selected;
    const cur = posture === 'folded' ? base.folded : base.expanded ?? base.folded;
    const next = { ...cur, ...g };
    next.viewport = {
      width: next.screen.width - next.safeArea.left - next.safeArea.right,
      height: next.screen.height - next.safeArea.top - next.safeArea.bottom - next.browserChrome.top - next.browserChrome.bottom,
    };
    setDraft({ ...base, [posture]: next });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Device Manager" description="Profiles used by the simulator, comparisons, the device wall and test runs." width={940}>
      <div className={s.layout}>
        <div className={s.list}>
          <div className={s.listActions}>
            <Button size="sm" icon={<Plus size={12} />} onClick={create}>
              New
            </Button>
            <Button size="sm" variant="ghost" icon={<Copy size={12} />} onClick={duplicate}>
              Duplicate
            </Button>
          </div>
          {all.map((dev) => (
            <button key={dev.id} className={s.item} data-active={dev.id === selected.id ? 'true' : undefined} onClick={() => { setSelectedId(dev.id); setDraft(null); }}>
              <span className={s.glyph}>
                <DeviceGlyph d={dev} size={22} />
              </span>
              <span className={s.itemText}>
                <span className={s.itemName}>{dev.name}</span>
                <span className={s.itemMeta}>
                  {dev.folded.viewport.width}×{dev.folded.viewport.height}
                  {dev.expanded ? ` / ${dev.expanded.viewport.width}×${dev.expanded.viewport.height}` : ''}
                </span>
              </span>
              {!dev.builtIn && <Badge tone="violet">Custom</Badge>}
            </button>
          ))}
        </div>
        <div className={s.detail}>
          <div className={s.hero}>
            {deviceArt(d.category) && (
              <span className={s.heroArt}>
                <ArtIcon src={deviceArt(d.category)!} size={30} />
              </span>
            )}
            <div style={{ minWidth: 0 }}>
              <div className={s.heroName}>{d.name}</div>
              <div className={s.heroMeta}>
                {d.vendor ?? 'Generic'} · {d.platform} · {d.category} · @{d.pixelRatio}x
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <Badge tone={d.verification.level === 'reference' ? 'success' : d.verification.level === 'provisional' ? 'warning' : 'violet'}>{d.verification.level}</Badge>
                {d.expanded && <Badge tone="molten">Foldable</Badge>}
                {d.touch && <Badge tone="outline">Touch</Badge>}
              </div>
            </div>
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="primary" onClick={() => { studio().setViewport({ deviceId: d.id }); onOpenChange(false); }}>
              Use device
            </Button>
          </div>
          <Notice tone={d.verification.level === 'provisional' ? 'warning' : 'info'}>
            <b>Source:</b> {d.verification.source} {d.verification.note}
          </Notice>
          {d.builtIn ? (
            <div className={s.readonly}>
              <Spec label="Folded / single" g={d.folded} />
              {d.expanded && <Spec label="Expanded" g={d.expanded} />}
              <div className={s.help}>Built-in profiles are read-only. Duplicate to customize.</div>
            </div>
          ) : (
            <div className={s.form}>
              <Grid>
                <TextField label="Name" value={d.name} onCommit={(name) => update({ name })} />
                <NumberField label="DPR" value={String(d.pixelRatio)} unit="" step={0.125} onCommit={(v) => update({ pixelRatio: Number(v) || 1 })} />
              </Grid>
              <Grid>
                <Select
                  ariaLabel="Frame"
                  value={d.frameStyle}
                  onChange={(frameStyle) => update({ frameStyle })}
                  options={['iphone-island', 'iphone-home', 'android-punch', 'foldable-book', 'dual-screen', 'ipad', 'android-tablet', 'laptop', 'monitor', 'bare'].map((v) => ({ value: v as DeviceProfile['frameStyle'], label: v }))}
                />
                <Select
                  ariaLabel="Platform"
                  value={d.platform}
                  onChange={(platform) => update({ platform })}
                  options={(['ios', 'android', 'windows', 'desktop', 'generic'] as const).map((v) => ({ value: v, label: v }))}
                />
              </Grid>
              <TextField label="UA" value={d.userAgent ?? ''} placeholder="User agent (used by the controlled browser)" onCommit={(userAgent) => update({ userAgent: userAgent || undefined })} />
              <GeomEditor label="Folded / single screen" g={d.folded} onChange={(g) => updateGeom('folded', g)} />
              <div className={s.foldToggle}>
                <span>Foldable (has an expanded posture)</span>
                <Switch
                  ariaLabel="Foldable"
                  checked={Boolean(d.expanded)}
                  onChange={(on) => {
                    const base = editing ?? selected;
                    if (on) {
                      const w = base.folded.screen.width * 2;
                      const fold: FoldGeometry = { axis: 'vertical', offset: base.folded.screen.width, maskLength: 0, kind: 'crease' };
                      setDraft({ ...base, category: 'foldable', expanded: { ...base.folded, screen: { ...base.folded.screen, width: w }, viewport: { ...base.folded.viewport, width: w - base.folded.safeArea.left - base.folded.safeArea.right }, fold } });
                    } else setDraft({ ...base, expanded: undefined });
                  }}
                />
              </div>
              {d.expanded && <GeomEditor label="Expanded" g={d.expanded} onChange={(g) => updateGeom('expanded', g)} fold />}
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="primary" size="sm" disabled={!editing} onClick={() => { if (editing) { studio().saveDevice(editing); setDraft(null); } }}>
                  Save profile
                </Button>
                <Button variant="danger" size="sm" icon={<Trash2 size={12} />} onClick={() => { studio().deleteDevice(d.id); setSelectedId(BUILT_IN_DEVICES[0].id); setDraft(null); }}>
                  Delete
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function Spec({ label, g }: { label: string; g: PostureGeometry }) {
  return (
    <div className={s.spec}>
      <div className={s.specTitle}>{label}</div>
      <dl className={s.specGrid}>
        <dt>Screen</dt>
        <dd>
          {g.screen.width}×{g.screen.height}
        </dd>
        <dt>Viewport</dt>
        <dd>
          {g.viewport.width}×{g.viewport.height}
        </dd>
        <dt>Safe area</dt>
        <dd>
          {g.safeArea.top} / {g.safeArea.right} / {g.safeArea.bottom} / {g.safeArea.left}
        </dd>
        <dt>Corner radius</dt>
        <dd>{g.cornerRadius}px</dd>
        {g.fold && (
          <>
            <dt>Fold</dt>
            <dd>
              {g.fold.kind} · {g.fold.axis} at {g.fold.offset}px{g.fold.maskLength ? ` · ${g.fold.maskLength}px mask` : ''}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

function GeomEditor({ label, g, onChange, fold }: { label: string; g: PostureGeometry; onChange: (g: Partial<PostureGeometry>) => void; fold?: boolean }) {
  return (
    <div className={s.spec}>
      <div className={s.specTitle}>
        {label} <span className={s.help}>→ viewport {g.viewport.width}×{g.viewport.height}</span>
      </div>
      <Grid cols={3}>
        <NumberField label="W" value={`${g.screen.width}px`} onCommit={(v) => onChange({ screen: { ...g.screen, width: parseInt(v) || g.screen.width } })} />
        <NumberField label="H" value={`${g.screen.height}px`} onCommit={(v) => onChange({ screen: { ...g.screen, height: parseInt(v) || g.screen.height } })} />
        <NumberField label="R" value={`${g.cornerRadius}px`} onCommit={(v) => onChange({ cornerRadius: parseInt(v) || 0 })} />
        <NumberField label="Top" value={`${g.safeArea.top}px`} onCommit={(v) => onChange({ safeArea: { ...g.safeArea, top: parseInt(v) || 0 } })} />
        <NumberField label="Bot" value={`${g.safeArea.bottom}px`} onCommit={(v) => onChange({ safeArea: { ...g.safeArea, bottom: parseInt(v) || 0 } })} />
        <NumberField label="Bzl" value={`${g.bezel.left}px`} onCommit={(v) => onChange({ bezel: makeInsets(parseInt(v) || 0) })} />
      </Grid>
      {fold && g.fold && (
        <Grid cols={3} style={{ marginTop: 6 }}>
          <NumberField label="At" value={`${g.fold.offset}px`} onCommit={(v) => onChange({ fold: { ...g.fold!, offset: parseInt(v) || 0 } })} />
          <NumberField label="Gap" value={`${g.fold.maskLength}px`} onCommit={(v) => onChange({ fold: { ...g.fold!, maskLength: parseInt(v) || 0, kind: parseInt(v) > 0 ? 'hinge' : 'crease' } })} />
          <Select ariaLabel="Fold axis" value={g.fold.axis} onChange={(axis) => onChange({ fold: { ...g.fold!, axis } })} options={[{ value: 'vertical', label: 'Vertical' }, { value: 'horizontal', label: 'Horizontal' }]} />
        </Grid>
      )}
    </div>
  );
}
