import { Grid3x3 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { DeviceCategory, DeviceProfile, Posture, ViewportState } from '@shared/types';
import { Badge, Button, Dialog } from '@/ui';
import { useStudio } from '@/store';
import { DeviceGlyph } from '@/app/toolbar/DevicePicker';
import { RESPONSIVE_ID } from '@/modules/device-simulator/devices';
import { postureGeometry } from '@/modules/device-simulator/viewport';
import { DEFAULT_SUITE_MATRIX, dedupeMatrix, viewportKey } from './matrix';
import s from './matrix.module.css';

const GROUPS: { id: DeviceCategory; label: string }[] = [
  { id: 'foldable', label: 'Foldables' },
  { id: 'phone', label: 'Phones' },
  { id: 'tablet', label: 'Tablets' },
  { id: 'desktop', label: 'Laptops & desktops' },
  { id: 'custom', label: 'Custom' },
];

/** Pick device profiles + postures for sequential matrix runs. */
export function MatrixDialog({
  open,
  onOpenChange,
  initial,
  title = 'Device matrix',
  confirmLabel,
  onConfirm,
  runsPerViewport = 1,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: ViewportState[];
  title?: string;
  confirmLabel: (n: number) => string;
  onConfirm: (m: ViewportState[]) => void;
  runsPerViewport?: number;
}) {
  const custom = useStudio((st) => st.customDevices);
  const devices = useMemo(() => [...useStudio.getState().allDevices()].filter((d) => d.id !== RESPONSIVE_ID), [custom]);
  const [sel, setSel] = useState<ViewportState[]>(initial);
  useEffect(() => {
    if (open) setSel(dedupeMatrix(initial, devices));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const has = (d: DeviceProfile, p: Posture) => sel.some((v) => v.deviceId === d.id && v.posture === p && v.orientation === 'portrait');
  const toggle = (d: DeviceProfile, p: Posture) => {
    const entry: ViewportState = { deviceId: d.id, posture: p, orientation: 'portrait' };
    setSel((cur) => (cur.some((v) => viewportKey(v) === viewportKey(entry)) ? cur.filter((v) => viewportKey(v) !== viewportKey(entry)) : [...cur, entry]));
  };
  const preset = (list: ViewportState[]) => setSel(dedupeMatrix(list, devices));
  const n = sel.length;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description="Runs execute one after another on the canvas device, so you can watch each one. Device geometry is approximate; see each profile's verification note."
      icon={<Grid3x3 size={18} color="var(--accent)" />}
      width={640}
      footer={
        <>
          <span className={s.count}>
            {n} viewport{n === 1 ? '' : 's'}
            {runsPerViewport > 1 ? ` · ${n * runsPerViewport} runs` : ''}
          </span>
          <span style={{ flex: 1 }} />
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!n}
            onClick={() => {
              onConfirm(sel);
              onOpenChange(false);
            }}
          >
            {confirmLabel(n)}
          </Button>
        </>
      }
    >
      <div className={s.presets}>
        <span className={s.presetsLabel}>Presets</span>
        <Button size="sm" variant="secondary" onClick={() => preset(DEFAULT_SUITE_MATRIX)}>
          Reference matrix
        </Button>
        <Button size="sm" variant="ghost" onClick={() => preset(devices.filter((d) => d.expanded).flatMap((d) => (['folded', 'expanded'] as Posture[]).map((posture) => ({ deviceId: d.id, posture, orientation: 'portrait' as const }))))}>
          All foldable postures
        </Button>
        <Button size="sm" variant="ghost" onClick={() => preset(devices.filter((d) => d.category === 'phone').map((d) => ({ deviceId: d.id, posture: 'folded' as const, orientation: 'portrait' as const })))}>
          Phones
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSel([])}>
          Clear
        </Button>
      </div>
      <div className={s.list}>
        {GROUPS.map((g) => {
          const list = devices.filter((d) => d.category === g.id);
          if (!list.length) return null;
          return (
            <div key={g.id} className={s.group}>
              <div className={s.groupLabel}>{g.label}</div>
              {list.map((d) => {
                const postures: Posture[] = d.expanded ? ['folded', 'expanded'] : ['folded'];
                const any = postures.some((p) => has(d, p));
                return (
                  <div key={d.id} className={s.row} data-on={any ? 'true' : undefined}>
                    <span className={s.glyph}>
                      <DeviceGlyph d={d} size={20} />
                    </span>
                    <span className={s.name}>
                      {d.name}
                      {d.verification.level === 'provisional' && (
                        <Badge tone="warning" title={d.verification.note ?? d.verification.source}>
                          Provisional
                        </Badge>
                      )}
                    </span>
                    <span className={s.chips}>
                      {postures.map((p) => {
                        const g2 = postureGeometry(d, p).viewport;
                        const on = has(d, p);
                        return (
                          <button key={p} type="button" className={s.chip} aria-pressed={on} data-on={on ? 'true' : undefined} onClick={() => toggle(d, p)}>
                            {d.expanded ? <span className={s.chipPosture}>{p === 'expanded' ? 'Expanded' : 'Folded'}</span> : <span className={s.chipPosture}>Portrait</span>}
                            <span className={s.chipDims}>
                              {g2.width}×{g2.height}
                            </span>
                          </button>
                        );
                      })}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
