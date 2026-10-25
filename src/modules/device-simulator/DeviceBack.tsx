import clsx from 'clsx';
import type { CSSProperties } from 'react';
import type { CameraLayout, Hardware } from './hardware';
import s from './DeviceFrame.module.css';

/**
 * Back plate of a device, drawn as the reverse face of a 3D panel. Positions
 * are in the back face's own coordinates, i.e. as seen when the device is
 * turned over. `hingeSide` places a foldable's camera next to its hinge.
 */
export function DeviceBack({
  hw,
  width,
  height,
  radius,
  camera = hw.camera,
  hingeSide,
  style,
  className,
}: {
  hw: Hardware;
  width: number;
  height: number;
  radius: string;
  camera?: CameraLayout;
  hingeSide?: 'left' | 'right' | 'top' | 'bottom';
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div className={clsx(s.back, hw.light && s.backLight, className)} style={{ borderRadius: radius, ...style }}>
      <div className={s.backPlate} style={{ background: hw.back, borderRadius: radius }} />
      <div className={s.backBand} style={{ borderRadius: radius, padding: Math.max(1.5, hw.band), background: hw.frame }} />
      <Cameras layout={camera} w={width} h={height} hingeSide={hingeSide} hw={hw} />
    </div>
  );
}

const lens = (key: string, cx: number, cy: number, d: number, extra?: string) => (
  <span key={key} className={clsx(s.lens, extra)} style={{ left: cx - d / 2, top: cy - d / 2, width: d, height: d }} />
);
const dot = (key: string, cx: number, cy: number, d: number, cls: string) => (
  <span key={key} className={cls} style={{ left: cx - d / 2, top: cy - d / 2, width: d, height: d }} />
);

function Cameras({ layout, w, h, hingeSide, hw }: { layout: CameraLayout; w: number; h: number; hingeSide?: 'left' | 'right' | 'top' | 'bottom'; hw: Hardware }) {
  const short = Math.min(w, h);
  switch (layout) {
    case 'iphone-pro': {
      const m = short * 0.46;
      const x = short * 0.05;
      const y = short * 0.05;
      const d = m * 0.42;
      return (
        <div className={s.camModule} style={{ left: x, top: y, width: m, height: m, borderRadius: m * 0.27, background: hw.back }}>
          {lens('a', m * 0.27, m * 0.27, d)}
          {lens('b', m * 0.27, m * 0.73, d)}
          {lens('c', m * 0.73, m * 0.5, d)}
          {dot('f', m * 0.75, m * 0.19, m * 0.12, s.flash)}
          {dot('l', m * 0.75, m * 0.81, m * 0.11, s.lidar)}
          {dot('m', m * 0.53, m * 0.5, m * 0.035, s.mic)}
        </div>
      );
    }
    case 'iphone-single': {
      const d = short * 0.14;
      return (
        <>
          {lens('a', short * 0.12, short * 0.12, d, s.lensRaised)}
          {dot('f', short * 0.24, short * 0.08, d * 0.32, s.flash)}
        </>
      );
    }
    case 'pixel-bar': {
      const barH = short * 0.21;
      const top = h * 0.11;
      const winW = w * 0.52;
      return (
        <div className={s.camBar} style={{ top, height: barH, background: hw.frame }}>
          <div className={s.camWindow} style={{ left: w * 0.1, width: winW, height: barH * 0.62, top: barH * 0.19, borderRadius: barH }}>
            {lens('a', barH * 0.42, barH * 0.31, barH * 0.5)}
            {lens('b', barH * 1.05, barH * 0.31, barH * 0.5)}
          </div>
          {dot('f', w * 0.74, barH / 2, barH * 0.16, s.flash)}
        </div>
      );
    }
    case 'galaxy-vertical': {
      const d = short * 0.15;
      const x = short * 0.13;
      const y0 = short * 0.13;
      const gap = d * 1.32;
      return (
        <>
          {lens('a', x, y0, d, s.lensRing)}
          {lens('b', x, y0 + gap, d, s.lensRing)}
          {lens('c', x, y0 + gap * 2, d, s.lensRing)}
          {dot('f', x + d * 1.05, y0 - d * 0.1, d * 0.28, s.flash)}
        </>
      );
    }
    case 'fold-vertical': {
      const d = short * 0.16;
      const pw = d * 1.36;
      const ph = pw + d * 2.7;
      const x = short * 0.06;
      const y = short * 0.07;
      return (
        <div className={s.camPill} style={{ left: x, top: y, width: pw, height: ph, borderRadius: pw }}>
          {lens('a', pw / 2, pw / 2, d)}
          {lens('b', pw / 2, pw / 2 + d * 1.35, d)}
          {lens('c', pw / 2, pw / 2 + d * 2.7, d)}
          {dot('f', pw + d * 0.45, pw * 0.3, d * 0.28, s.flash)}
        </div>
      );
    }
    case 'duo': {
      // Surface Duo 2: a raised camera bump next to the hinge, holding three lenses and a flash.
      const d = short * 0.085;
      const pw = d * 1.5;
      const ph = d * 4.4;
      const y = short * 0.05;
      const x = hingeSide === 'left' ? short * 0.035 : w - short * 0.035 - pw;
      return (
        <div className={s.camPill} style={{ left: x, top: y, width: pw, height: ph, borderRadius: pw * 0.5 }}>
          {lens('a', pw / 2, pw / 2, d)}
          {lens('b', pw / 2, pw / 2 + d * 1.15, d)}
          {lens('c', pw / 2, pw / 2 + d * 2.3, d)}
          {dot('f', pw / 2, pw / 2 + d * 3.25, d * 0.42, s.flash)}
        </div>
      );
    }
    case 'ipad-pro': {
      const m = short * 0.2;
      const x = short * 0.04;
      const d = m * 0.4;
      return (
        <div className={s.camModule} style={{ left: x, top: x, width: m, height: m, borderRadius: m * 0.3, background: hw.back }}>
          {lens('a', m * 0.29, m * 0.29, d)}
          {lens('b', m * 0.29, m * 0.71, d)}
          {dot('f', m * 0.72, m * 0.25, m * 0.14, s.flash)}
          {dot('l', m * 0.72, m * 0.72, m * 0.18, s.lidar)}
        </div>
      );
    }
    case 'ipad-single': {
      const d = short * 0.075;
      return lens('a', short * 0.065, short * 0.065, d, s.lensRaised);
    }
    case 'tab-dual': {
      const d = short * 0.06;
      return (
        <>
          {lens('a', short * 0.06, short * 0.06, d, s.lensRing)}
          {lens('b', short * 0.06, short * 0.06 + d * 1.4, d, s.lensRing)}
          {dot('f', short * 0.06 + d * 1.2, short * 0.06, d * 0.35, s.flash)}
        </>
      );
    }
    default:
      return null;
  }
}
