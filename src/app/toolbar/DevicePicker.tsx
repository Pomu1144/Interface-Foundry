import clsx from 'clsx';
import { Check, Settings2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DeviceCategory, DeviceProfile } from '@shared/types';
import { Badge, Popover, SearchInput } from '@/ui';
import { studio, useStudio } from '@/store';
import { BUILT_IN_DEVICES, RESPONSIVE_ID } from '@/modules/device-simulator/devices';
import { deviceArt } from '@/app/art';
import s from './picker.module.css';

const ORDER: { id: DeviceCategory; label: string }[] = [
  { id: 'foldable', label: 'Foldables' },
  { id: 'phone', label: 'Phones' },
  { id: 'tablet', label: 'Tablets' },
  { id: 'desktop', label: 'Desktop' },
  { id: 'custom', label: 'Custom' },
];

const PLATFORM: Record<string, string> = { ios: 'iOS', android: 'Android', windows: 'Windows', desktop: 'Desktop', generic: 'Web' };

export function DevicePicker({ trigger, onPick, value }: { trigger: React.ReactElement; onPick?: (id: string) => void; value?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = useStudio((st) => st.viewport.deviceId);
  const custom = useStudio((st) => st.customDevices);
  const selected = value ?? current;
  const devices = useMemo(() => [...BUILT_IN_DEVICES, ...custom], [custom]);
  const filtered = devices.filter((d) => !q || `${d.name} ${d.vendor ?? ''} ${d.platform} ${d.category}`.toLowerCase().includes(q.toLowerCase()));
  const pick = (id: string) => {
    if (onPick) onPick(id);
    else studio().setViewport({ deviceId: id });
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen} trigger={trigger} width={400} align="center">
      <div className={s.picker}>
        <div className={s.pickerHead}>
          <SearchInput value={q} onChange={setQ} placeholder="Search devices" autoFocus />
        </div>
        <div className={s.list}>
          <button className={clsx(s.item, selected === RESPONSIVE_ID && s.itemActive)} onClick={() => pick(RESPONSIVE_ID)}>
            <span className={s.itemArt} data-kind="responsive">
              ↔
            </span>
            <span className={s.itemText}>
              <span className={s.itemName}>Responsive</span>
              <span className={s.itemMeta}>Drag to any width · media-query bar</span>
            </span>
            {selected === RESPONSIVE_ID && <Check size={14} className={s.check} />}
          </button>
          {ORDER.map((cat) => {
            const list = filtered.filter((d) => d.category === cat.id);
            if (!list.length) return null;
            return (
              <div key={cat.id}>
                <div className={s.group}>
                  {deviceArt(cat.id) && <img src={deviceArt(cat.id)!} alt="" className={s.groupArt} />}
                  {cat.label}
                </div>
                {list.map((d) => (
                  <DeviceRow key={d.id} d={d} active={selected === d.id} onClick={() => pick(d.id)} />
                ))}
              </div>
            );
          })}
        </div>
        <button
          className={s.footer}
          onClick={() => {
            setOpen(false);
            studio().setDialog('deviceManager', true);
          }}
        >
          <Settings2 size={13} /> Device Manager…
        </button>
      </div>
    </Popover>
  );
}

function DeviceRow({ d, active, onClick }: { d: DeviceProfile; active: boolean; onClick: () => void }) {
  const g = d.folded;
  return (
    <button className={clsx(s.item, active && s.itemActive)} onClick={onClick}>
      <span className={s.itemArt}>
        <DeviceGlyph d={d} />
      </span>
      <span className={s.itemText}>
        <span className={s.itemName}>
          {d.name}
          <span className={s.platform}>{PLATFORM[d.platform]}</span>
        </span>
        <span className={s.itemMeta}>
          {g.viewport.width}×{g.viewport.height}
          {d.expanded && ` → ${d.expanded.viewport.width}×${d.expanded.viewport.height}`} · @{d.pixelRatio}x
        </span>
      </span>
      {d.verification.level === 'provisional' && (
        <Badge tone="warning" title={d.verification.source}>
          Provisional
        </Badge>
      )}
      {!d.builtIn && <Badge tone="violet">Custom</Badge>}
      {active && <Check size={14} className={s.check} />}
    </button>
  );
}

/** Tiny proportional silhouette of the device's viewport(s). */
export function DeviceGlyph({ d, size = 22 }: { d: DeviceProfile; size?: number }) {
  const g = d.expanded ?? d.folded;
  const k = size / Math.max(g.screen.width, g.screen.height);
  const w = Math.max(6, g.screen.width * k);
  const h = Math.max(6, g.screen.height * k);
  const fold = d.expanded?.fold;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <rect x={(size - w) / 2} y={(size - h) / 2} width={w} height={h} rx={Math.min(4, g.cornerRadius * k + 1)} fill="none" stroke="currentColor" strokeWidth="1.3" />
      {fold && <line x1={(size - w) / 2 + fold.offset * k} y1={(size - h) / 2} x2={(size - w) / 2 + fold.offset * k} y2={(size + h) / 2} stroke="currentColor" strokeWidth={fold.kind === 'hinge' ? 2 : 0.8} opacity="0.8" />}
    </svg>
  );
}
