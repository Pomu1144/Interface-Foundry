import { Eye, EyeOff, Headphones } from 'lucide-react';
import { Slider as RSlider } from 'radix-ui';
import { memo, type CSSProperties } from 'react';
import { Button, Tooltip } from '@/ui';
import { depthT, isLevelVisible, type DepthFilter, type Tree } from './math';
import { engine } from './engine';
import { resetFilters, setView, useH3D } from './state';
import s from './hierarchy.module.css';

/** Slim left rail: depth range, per-level counts, solo / hide. */
export const DepthRail = memo(function DepthRail({ tree, filter, pathDepths, visibleCount }: { tree: Tree; filter: DepthFilter; pathDepths: ReadonlySet<number>; visibleCount: number }) {
  const hidden = useH3D((st) => st.hidden);
  const solo = useH3D((st) => st.solo);
  const isolate = useH3D((st) => st.isolate);
  const range = useH3D((st) => st.range);
  const maxCount = Math.max(1, ...tree.levels.map((l) => l.count));
  const filtered = range !== null || hidden.length > 0 || solo.length > 0 || isolate;
  const single = tree.minDepth === tree.maxDepth;

  const toggle = (list: number[], d: number) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d].sort((a, b) => a - b));

  return (
    <aside className={s.rail} aria-label="Depth levels">
      <div className={s.railHead}>
        <div className={s.railTitleRow}>
          <span className={s.railTitle}>Depth</span>
          <span className={s.railRange}>
            {filter.min}–{filter.max}
          </span>
        </div>
        <RSlider.Root
          className={s.rangeRoot}
          min={tree.minDepth}
          max={single ? tree.minDepth + 1 : tree.maxDepth}
          step={1}
          minStepsBetweenThumbs={0}
          disabled={single}
          value={[filter.min, Math.min(filter.max, single ? tree.minDepth + 1 : tree.maxDepth)]}
          onValueChange={([lo, hi]) =>
            setView({
              range: lo === tree.minDepth && hi === tree.maxDepth ? null : [lo, hi],
            })
          }
        >
          <RSlider.Track className={s.rangeTrack}>
            <RSlider.Range className={s.rangeFill} />
          </RSlider.Track>
          <RSlider.Thumb className={s.rangeThumb} aria-label="Minimum depth" />
          <RSlider.Thumb className={s.rangeThumb} aria-label="Maximum depth" />
        </RSlider.Root>
      </div>
      <div className={s.levels} onPointerLeave={() => engine.highlightDepth(null)}>
        {tree.levels.map((l) => {
          const on = isLevelVisible(l.depth, filter);
          const isHidden = hidden.includes(l.depth);
          const isSolo = solo.includes(l.depth);
          return (
            <div
              key={l.depth}
              className={s.level}
              data-off={on ? undefined : 'true'}
              data-path={pathDepths.has(l.depth) ? 'true' : undefined}
              style={
                {
                  '--t': depthT(l.depth, tree.minDepth, tree.maxDepth),
                } as CSSProperties
              }
              onPointerEnter={() => engine.highlightDepth(on ? l.depth : null)}
            >
              <span className={s.levelDepth}>{String(l.depth).padStart(2, '0')}</span>
              <span className={s.levelBar}>
                <span
                  className={s.levelFill}
                  style={{
                    width: `${Math.max(4, (l.count / maxCount) * 100)}%`,
                  }}
                />
              </span>
              <span className={s.levelCount}>{l.count}</span>
              <span className={s.levelActions}>
                <Tooltip content={isSolo ? 'Unsolo level' : 'Solo level (show only soloed levels)'} side="right">
                  <button
                    className={s.levelBtn}
                    data-on={isSolo ? 'true' : undefined}
                    aria-pressed={isSolo}
                    aria-label={`Solo depth ${l.depth}`}
                    onClick={() => setView({ solo: toggle(solo, l.depth) })}
                  >
                    <Headphones size={12} />
                  </button>
                </Tooltip>
                <Tooltip content={isHidden ? 'Show level' : 'Hide level'} side="right">
                  <button
                    className={s.levelBtn}
                    data-tone="warn"
                    data-on={isHidden ? 'true' : undefined}
                    aria-pressed={isHidden}
                    aria-label={`${isHidden ? 'Show' : 'Hide'} depth ${l.depth}`}
                    onClick={() => setView({ hidden: toggle(hidden, l.depth) })}
                  >
                    {isHidden ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </Tooltip>
              </span>
            </div>
          );
        })}
      </div>
      <div className={s.railFoot}>
        {filtered && (
          <Button size="sm" variant="ghost" onClick={resetFilters}>
            Show all levels
          </Button>
        )}
        <p className={s.railNote}>{visibleCount} boxes shown. Boxes from getBoundingClientRect; depth = DOM depth; base texture is a DOM raster (approximate).</p>
      </div>
    </aside>
  );
});
