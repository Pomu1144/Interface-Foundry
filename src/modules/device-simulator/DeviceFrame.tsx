import clsx from 'clsx';
import type { CSSProperties, ReactNode } from 'react';
import type { DeviceProfile, Orientation, Posture, PostureGeometry } from '@shared/types';
import { fold3dLayout, type Fold3DLayout, type Rect } from './fold3d';
import s from './DeviceFrame.module.css';

export type FrameVisual = {
  /** 0 = folded, 1 = expanded (only meaningful for foldables). */
  progress: number;
  animating: boolean;
  style: 'hinge' | 'reflow';
};

type FrameProps = {
  device: DeviceProfile;
  /** Geometry of the live content (the posture the page is currently laid out for). */
  geometry: PostureGeometry;
  orientation: Orientation;
  visual: FrameVisual;
  showSystemUI: boolean;
  showHinge: boolean;
  colorScheme?: 'light' | 'dark' | null;
  children: ReactNode;
  viewportOverlay?: ReactNode;
  /** Both postures of a foldable, for the 3D hinge frame. */
  fold3d?: { folded: PostureGeometry; expanded: PostureGeometry; posture: Posture };
};

/**
 * Hardware-styled frame around a live viewport. All geometry is CSS px at
 * zoom 1; the canvas scales the whole frame. The viewport slot receives the
 * real preview, sized exactly to `geometry.viewport`.
 *
 * Foldables in the 3D hinge style render as two panels driven by CSS
 * variables from the motion engine (see motion.ts); everything else renders
 * as a single slab.
 */
export function DeviceFrame(props: FrameProps) {
  if (props.fold3d && props.visual.style === 'hinge' && props.device.frameStyle !== 'bare') {
    const layout = fold3dLayout(props.device, props.fold3d.folded, props.fold3d.expanded);
    if (layout) return <FoldableFrame3D {...props} layout={layout} posture={props.fold3d.posture} />;
  }
  return <FlatFrame {...props} />;
}

function FlatFrame({ device, geometry, orientation, visual, showSystemUI, showHinge, colorScheme, children, viewportOverlay }: FrameProps) {
  const g = geometry;
  const bare = device.frameStyle === 'bare';
  const bezel = bare ? { top: 0, right: 0, bottom: 0, left: 0 } : g.bezel;
  const frameW = g.screen.width + bezel.left + bezel.right;
  const frameH = g.screen.height + bezel.top + bezel.bottom;
  const p = visual.progress;
  const landscape = orientation === 'landscape';
  const fold = g.fold && showHinge ? g.fold : undefined;
  const showDualSlabs = device.frameStyle === 'dual-screen' && fold && fold.kind === 'hinge' && p > 0.02;

  const deviceStyle: CSSProperties = {
    width: frameW,
    height: frameH,
    ['--radius' as string]: `${g.cornerRadius + Math.min(bezel.left, bezel.top)}px`,
    ['--screen-radius' as string]: `${g.cornerRadius}px`,
  };

  return (
    <div className={clsx(s.device, s[device.frameStyle], landscape && s.landscape, visual.animating && s.animating)} style={deviceStyle} data-frame={device.frameStyle}>
      {!bare && <div className={s.body} />}
      {!bare && <SideButtons style={device.frameStyle} landscape={landscape} />}
      {showDualSlabs && fold && <DualSlabSeam fold={fold} bezel={bezel} screenH={g.screen.height} screenW={g.screen.width} />}
      <div
        className={clsx(s.screen, bare && s.screenBare)}
        style={{ left: bezel.left, top: bezel.top, width: g.screen.width, height: g.screen.height, borderRadius: g.cornerRadius }}
      >
        <ScreenContents device={device} g={g} landscape={landscape} showSystemUI={showSystemUI} fold={fold} progress={p} colorScheme={colorScheme} overlay={viewportOverlay}>
          {children}
        </ScreenContents>
      </div>
      {device.frameStyle === 'laptop' && <div className={s.laptopBase} style={{ width: frameW * 1.16, left: -frameW * 0.08 }} />}
      {device.frameStyle === 'monitor' && <MonitorStand width={frameW} />}
    </div>
  );
}

/** Everything drawn inside the glass: system bars, browser chrome, the live viewport and its fold mask. */
function ScreenContents({
  device,
  g,
  landscape,
  showSystemUI,
  fold,
  progress,
  colorScheme,
  overlay,
  children,
}: {
  device: DeviceProfile;
  g: PostureGeometry;
  landscape: boolean;
  showSystemUI: boolean;
  fold?: PostureGeometry['fold'];
  progress: number;
  colorScheme?: 'light' | 'dark' | null;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const bare = device.frameStyle === 'bare';
  const dark = colorScheme === 'dark';
  const vpTop = g.safeArea.top + g.browserChrome.top;
  const vpLeft = g.safeArea.left;
  return (
    <>
      {showSystemUI && g.safeArea.top > 0 && !landscape && <StatusBar platform={device.platform} height={g.safeArea.top} dark={dark} style={device.frameStyle} />}
      {showSystemUI && g.safeArea.left > 0 && landscape && <div className={s.sideSafe} style={{ width: g.safeArea.left, background: dark ? '#000' : '#fff' }} />}
      {g.browserChrome.top > 0 && <BrowserBar top={g.safeArea.top} height={g.browserChrome.top} />}
      <div className={s.viewport} style={{ left: vpLeft, top: vpTop, width: g.viewport.width, height: g.viewport.height }}>
        {children}
        {fold && <FoldMask fold={{ ...fold, offset: fold.axis === 'vertical' ? fold.offset - vpLeft : fold.offset - vpTop }} progress={progress} />}
        {overlay}
      </div>
      {showSystemUI && g.safeArea.bottom > 0 && !landscape && <HomeIndicator platform={device.platform} height={g.safeArea.bottom} dark={dark} />}
      {showSystemUI && g.safeArea.right > 0 && landscape && <div className={s.sideSafe} style={{ right: 0, left: 'auto', width: g.safeArea.right, background: dark ? '#000' : '#fff' }} />}
      {!bare && <Cutout style={device.frameStyle} screenW={g.screen.width} landscape={landscape} fold={fold} />}
      {!bare && <div className={s.glare} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 3D hinge frame                                                      */
/* ------------------------------------------------------------------ */

const px = (r: Rect): CSSProperties => ({ left: r.x, top: r.y, width: r.width, height: r.height });

/** Border radius with the hinge-side corners tightened. */
function panelRadius(axis: 'vertical' | 'horizontal', hingeSide: 'start' | 'end' | 'none', outer: number, inner = 3): string {
  if (hingeSide === 'none') return `${outer}px`;
  const [tl, tr, br, bl] =
    axis === 'vertical'
      ? hingeSide === 'end'
        ? [outer, inner, inner, outer]
        : [inner, outer, outer, inner]
      : hingeSide === 'end'
        ? [outer, outer, inner, inner]
        : [inner, inner, outer, outer];
  return `${tl}px ${tr}px ${br}px ${bl}px`;
}

function FoldableFrame3D({
  device,
  geometry,
  orientation,
  showSystemUI,
  showHinge,
  colorScheme,
  children,
  viewportOverlay,
  layout: L,
  posture,
  fold3d,
}: FrameProps & { layout: Fold3DLayout; posture: Posture }) {
  const landscape = orientation === 'landscape';
  const vertical = L.axis === 'vertical';
  const after = L.moving === 'after';
  const g = geometry;
  const sc = L.screen[posture];
  const sp = L.staticPanel[posture];
  const E = fold3d!.expanded;
  const outer = E.cornerRadius + Math.min(E.bezel.left, E.bezel.top);
  // Hinge side of each panel, along the fold axis.
  const staticHinge = posture === 'folded' && device.frameStyle !== 'dual-screen' ? 'none' : after ? 'end' : 'start';
  const movingHinge = after ? 'start' : 'end';
  const swing = vertical ? `rotateY(calc(var(--fold-angle) * ${after ? 1 : -1}))` : `rotateX(calc(var(--fold-angle) * ${after ? -1 : 1}))`;
  const origin = vertical ? (after ? '0% 50%' : '100% 50%') : after ? '50% 0%' : '50% 100%';
  const backFlip = vertical ? 'rotateY(180deg)' : 'rotateX(180deg)';
  const lean = after ? 1 : -1;
  const containerTransform = [
    `translate(calc((1 - var(--fold-open)) * ${L.foldedShift.x}px), calc((1 - var(--fold-open)) * ${L.foldedShift.y}px))`,
    vertical ? `rotateX(calc(var(--fold-lift) * 7deg)) rotateY(calc(var(--fold-lift) * ${-13 * lean}deg))` : `rotateX(calc(var(--fold-lift) * ${11 * lean}deg)) rotateY(calc(var(--fold-lift) * -7deg))`,
  ].join(' ');
  const fold = g.fold && showHinge ? g.fold : undefined;
  const coverSlide = vertical ? `translateX(calc(var(--fold-slide) * ${after ? 100 : -100}%))` : `translateY(calc(var(--fold-slide) * ${after ? 100 : -100}%))`;

  return (
    <div
      className={clsx(s.fold3d, s[device.frameStyle], landscape && s.landscape)}
      style={{
        width: L.container.width,
        height: L.container.height,
        transform: containerTransform,
        ['--radius' as string]: `${outer}px`,
        ['--screen-radius' as string]: `${g.cornerRadius}px`,
      }}
      data-frame={device.frameStyle}
      data-fold3d={posture}
    >
      <div className={s.floorShadow} />
      <div className={clsx(s.panel, s.panelStatic)} style={{ ...px(sp), borderRadius: panelRadius(L.axis, staticHinge, outer) }}>
        <div className={s.body} style={{ borderRadius: 'inherit' }} />
      </div>
      <div className={clsx(s.panel, s.panelMoving)} style={{ ...px(L.movingPanel), transformOrigin: origin, transform: swing }}>
        <div className={s.face} style={{ borderRadius: panelRadius(L.axis, movingHinge, outer) }}>
          <div className={s.body} style={{ borderRadius: 'inherit' }} />
          <div className={s.screenOff} style={{ ...px(L.movingScreen), borderRadius: g.cornerRadius }} />
          <div className={s.faceShade} style={{ borderRadius: 'inherit' }} />
        </div>
        <div className={clsx(s.face, s.faceBack)} style={{ transform: backFlip, borderRadius: panelRadius(L.axis, movingHinge === 'start' ? 'end' : 'start', outer) }}>
          <div className={s.backBody} />
        </div>
      </div>
      {L.hinge && <div className={clsx(s.hinge3d, !vertical && s.hinge3dH)} style={px(L.hinge)} />}
      <div className={clsx(s.screen, s.screen3d)} style={{ ...px(sc), borderRadius: g.cornerRadius }}>
        <ScreenContents device={device} g={g} landscape={landscape} showSystemUI={showSystemUI} fold={fold} progress={posture === 'expanded' ? 1 : 0} colorScheme={colorScheme} overlay={viewportOverlay}>
          {children}
        </ScreenContents>
        {posture === 'expanded' && (
          <div className={s.revealWindow} style={px(L.reveal)}>
            <div className={clsx(s.revealCover, !vertical && s.revealCoverH)} data-edge={after ? 'start' : 'end'} style={{ transform: coverSlide }} />
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBar({ platform, height, dark, style }: { platform: string; height: number; dark: boolean; style: DeviceProfile['frameStyle'] }) {
  const ios = platform === 'ios';
  const island = style === 'iphone-island';
  return (
    <div className={clsx(s.statusBar, ios ? s.statusIos : s.statusAndroid, dark && s.statusDark)} style={{ height }}>
      <span className={s.time} style={island ? { paddingTop: Math.max(0, height / 2 - 14) } : undefined}>
        {ios ? '9:41' : '12:30'}
      </span>
      <span className={s.statusIcons} style={island ? { paddingTop: Math.max(0, height / 2 - 14) } : undefined}>
        <svg width="17" height="11" viewBox="0 0 17 11" aria-hidden>
          <rect x="0" y="7" width="3" height="4" rx="0.8" fill="currentColor" />
          <rect x="4.5" y="5" width="3" height="6" rx="0.8" fill="currentColor" />
          <rect x="9" y="2.5" width="3" height="8.5" rx="0.8" fill="currentColor" />
          <rect x="13.5" y="0" width="3" height="11" rx="0.8" fill="currentColor" />
        </svg>
        <svg width="15" height="11" viewBox="0 0 15 11" aria-hidden>
          <path d="M7.5 2.2c2.2 0 4.2.9 5.7 2.3l1.1-1.1A9.6 9.6 0 0 0 7.5.6 9.6 9.6 0 0 0 .7 3.4l1.1 1.1a8 8 0 0 1 5.7-2.3Zm0 3.2c1.3 0 2.5.5 3.4 1.3l1.1-1.1a6.4 6.4 0 0 0-9 0l1.1 1.1c.9-.8 2.1-1.3 3.4-1.3Zm0 3.2c-.5 0-1 .2-1.3.5L7.5 10.4l1.3-1.3a1.8 1.8 0 0 0-1.3-.5Z" fill="currentColor" />
        </svg>
        <span className={s.battery}>
          <span className={s.batteryLevel} />
        </span>
      </span>
    </div>
  );
}

function HomeIndicator({ platform, height, dark }: { platform: string; height: number; dark: boolean }) {
  return (
    <div className={clsx(s.homeArea, dark && s.statusDark)} style={{ height }}>
      <span className={clsx(s.homeBar, platform !== 'ios' && s.homeBarAndroid)} />
    </div>
  );
}

function BrowserBar({ top, height }: { top: number; height: number }) {
  return (
    <div className={s.browserBar} style={{ top, height }}>
      <span className={s.urlPill} />
    </div>
  );
}

function Cutout({ style, screenW, landscape, fold }: { style: DeviceProfile['frameStyle']; screenW: number; landscape: boolean; fold?: PostureGeometry['fold'] }) {
  if (landscape) return null;
  if (style === 'iphone-island') {
    const w = Math.round(screenW * 0.31);
    return <span className={s.island} style={{ width: w, left: (screenW - w) / 2 }} />;
  }
  if (style === 'android-punch' || style === 'foldable-book') {
    // On an unfolded book foldable the camera sits on the right panel.
    const cx = style === 'foldable-book' && fold ? fold.offset + (screenW - fold.offset) / 2 : screenW / 2;
    return <span className={s.punch} style={{ left: cx - 5 }} />;
  }
  return null;
}

function SideButtons({ style, landscape }: { style: DeviceProfile['frameStyle']; landscape: boolean }) {
  if (landscape || !['iphone-island', 'iphone-notch', 'iphone-home', 'android-punch', 'foldable-book'].includes(style)) return null;
  const ios = style.startsWith('iphone');
  return (
    <>
      {ios && <span className={s.btn} style={{ left: -3, top: '17%', height: '4%' }} />}
      <span className={s.btn} style={{ left: ios ? -3 : 'auto', right: ios ? 'auto' : -3, top: ios ? '24%' : '20%', height: '8%' }} />
      {ios && <span className={s.btn} style={{ left: -3, top: '34%', height: '8%' }} />}
      <span className={s.btn} style={{ right: -3, top: ios ? '27%' : '33%', height: ios ? '12%' : '6%' }} />
    </>
  );
}

function FoldMask({ fold, progress }: { fold: NonNullable<PostureGeometry['fold']>; progress: number }) {
  const vertical = fold.axis === 'vertical';
  if (fold.kind === 'hinge' && fold.maskLength > 0) {
    return (
      <div
        className={clsx(s.hinge, !vertical && s.hingeH)}
        style={{
          ...(vertical ? { left: fold.offset, width: fold.maskLength, top: 0, bottom: 0 } : { top: fold.offset, height: fold.maskLength, left: 0, right: 0 }),
          opacity: Math.min(1, progress * 1.4),
        }}
        title={`Hinge: ${fold.maskLength}px at ${Math.round(fold.offset)}px — content here is not visible on hardware`}
      />
    );
  }
  return (
    <div
      className={clsx(s.crease, !vertical && s.creaseH)}
      style={{ ...(vertical ? { left: fold.offset - 8, width: 16, top: 0, bottom: 0 } : { top: fold.offset - 8, height: 16, left: 0, right: 0 }), opacity: 0.25 + 0.75 * (1 - progress) }}
    />
  );
}

function DualSlabSeam({ fold, bezel, screenH, screenW }: { fold: NonNullable<PostureGeometry['fold']>; bezel: { top: number; left: number; bottom: number }; screenH: number; screenW: number }) {
  const vertical = fold.axis === 'vertical';
  return vertical ? (
    <span className={s.seam} style={{ left: bezel.left + fold.offset, width: fold.maskLength, top: 0, height: screenH + bezel.top + bezel.bottom }} />
  ) : (
    <span className={clsx(s.seam, s.seamH)} style={{ top: bezel.top + fold.offset, height: fold.maskLength, left: 0, width: screenW + bezel.left * 2 }} />
  );
}

function MonitorStand({ width }: { width: number }) {
  return (
    <>
      <div className={s.standNeck} style={{ left: width / 2 - 40 }} />
      <div className={s.standFoot} style={{ left: width / 2 - 110 }} />
    </>
  );
}
