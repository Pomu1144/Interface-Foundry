import { Pause, Play, Repeat, RotateCcw, SlidersHorizontal, Smartphone, TabletSmartphone } from 'lucide-react';
import { IconButton, Popover, Segmented, Slider } from '@/ui';
import { studio, useStudio } from '@/store';
import { scrubTransition } from '@/modules/device-simulator/useTransitionDriver';
import s from './canvas.module.css';

const DURATIONS = [
  { value: '500', label: '0.5s' },
  { value: '1100', label: '1.1s' },
  { value: '2000', label: '2s' },
  { value: '4000', label: '4s' },
  { value: '8000', label: '8s' },
];

/**
 * Floating fold/unfold transport: posture switch, play/pause, scrubber, loop,
 * and a settings popover for duration, motion style and reflow mode.
 */
export function FoldDock() {
  const t = useStudio((st) => st.transition);
  const posture = useStudio((st) => st.viewport.posture);
  const device = useStudio((st) => st.device());
  const reduced = useStudio((st) => st.settings.reducedMotion);
  if (!device.expanded) return null;
  const target = t.playing ? (t.direction === 1 ? 'expanded' : 'folded') : posture;
  return (
    <div className={s.dock} onPointerDown={(e) => e.stopPropagation()} data-testid="fold-dock">
      <Segmented
        ariaLabel="Posture"
        value={target}
        onChange={(v) => studio().foldTo(v)}
        options={[
          { value: 'folded', label: 'Folded', icon: <Smartphone size={12} /> },
          { value: 'expanded', label: 'Expanded', icon: <TabletSmartphone size={12} /> },
        ]}
      />
      <span className={s.dockDivider} />
      <IconButton
        label={t.playing ? 'Pause' : posture === 'expanded' ? 'Play fold' : 'Play unfold'}
        shortcut="F"
        size="sm"
        tooltipSide="top"
        onClick={() => {
          if (t.playing) studio().setTransition({ playing: false });
          else if (t.progress > 0 && t.progress < 1) studio().setTransition({ playing: true });
          else studio().toggleFold();
        }}
      >
        {t.playing ? <Pause size={13} /> : <Play size={13} />}
      </IconButton>
      <div className={s.scrubber}>
        <Slider ariaLabel="Transition progress" value={t.progress} onChange={(v) => scrubTransition(v)} />
      </div>
      <span className={s.dockValue}>{Math.round(t.progress * 100)}%</span>
      <IconButton label="Reset to folded" size="sm" tooltipSide="top" onClick={() => scrubTransition(0)}>
        <RotateCcw size={12} />
      </IconButton>
      <IconButton label="Loop" size="sm" tooltipSide="top" active={t.loop} onClick={() => studio().setTransition({ loop: !t.loop })}>
        <Repeat size={12} />
      </IconButton>
      <Popover
        side="top"
        width={300}
        trigger={
          <span>
            <IconButton label="Transition settings" size="sm" tooltipSide="top">
              <SlidersHorizontal size={12} />
            </IconButton>
          </span>
        }
      >
        <div className={s.dockSettings}>
          <div className={s.dockSettingRow}>
            <span>Duration</span>
            <Segmented ariaLabel="Duration" value={String(t.duration)} onChange={(v) => studio().setTransition({ duration: Number(v) })} options={DURATIONS} />
          </div>
          <div className={s.dockSettingRow}>
            <span>Motion</span>
            <Segmented
              ariaLabel="Animation style"
              value={t.style}
              onChange={(v) => studio().setTransition({ style: v })}
              options={[
                { value: 'hinge', label: 'Hinge 3D' },
                { value: 'reflow', label: 'Flat' },
              ]}
            />
          </div>
          <div className={s.dockSettingRow}>
            <span>Viewport</span>
            <Segmented
              ariaLabel="Viewport mode"
              value={t.mode}
              onChange={(v) => studio().setTransition({ mode: v })}
              options={[
                { value: 'continuous', label: 'Continuous reflow' },
                { value: 'midpoint', label: 'Snap at midpoint' },
              ]}
            />
          </div>
          <p className={s.dockHelp}>
            {t.mode === 'continuous'
              ? 'The real page reflows at every frame as the viewport width interpolates.'
              : 'The viewport switches once at 50%, like a hardware posture change; the frame still animates.'}
            {reduced && ' Reduced motion is on: posture changes jump without animation.'}
          </p>
        </div>
      </Popover>
    </div>
  );
}
