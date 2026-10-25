/**
 * Brand mark and line icons generated with Higgsfield (see docs/ASSETS.md).
 * Icons are monochrome masks: render them with <ArtIcon src={art.x} /> (or as
 * EmptyState art) so they take the current text color in both themes.
 * Small UI glyphs come from lucide-react.
 */
import mark from '@/assets/brand/ifdy-mark.png';
import productShot from '@/assets/brand/product-shot.webp';
import design from '@/assets/icons/design.png';
import inspect from '@/assets/icons/inspect.png';
import simulate from '@/assets/icons/simulate.png';
import test from '@/assets/icons/test.png';
import ai from '@/assets/icons/ai.png';
import ship from '@/assets/icons/ship.png';
import phone from '@/assets/icons/phone.png';
import foldable from '@/assets/icons/foldable.png';
import tablet from '@/assets/icons/tablet.png';
import desktop from '@/assets/icons/desktop.png';
import select from '@/assets/icons/select.png';
import record from '@/assets/icons/record.png';
import hierarchy from '@/assets/icons/hierarchy.png';
import wall from '@/assets/icons/wall.png';
import code from '@/assets/icons/code.png';
import git from '@/assets/icons/git.png';
import tokens from '@/assets/icons/tokens.png';
import assets from '@/assets/icons/assets.png';
import components from '@/assets/icons/components.png';
import shield from '@/assets/icons/shield.png';
import chart from '@/assets/icons/chart.png';
import tools from '@/assets/icons/tools.png';
import folderPlus from '@/assets/icons/folderPlus.png';
import globe from '@/assets/icons/globe.png';
import type { DeviceCategory } from '@shared/types';

export const art = {
  /** Full-color app mark (selection frame with fold line). Use as <img>. */
  appIcon: mark,
  /** Real screenshot of the studio used on the welcome screen. Use as <img>. */
  productShot,
  design,
  inspect,
  simulate,
  test,
  ai,
  ship,
  phone,
  foldable,
  tablet,
  desktop,
  select,
  record,
  hierarchy,
  wall,
  code,
  git,
  tokens,
  assets,
  components,
  shield,
  chart,
  tools,
  folderPlus,
  globe,
};

export function deviceArt(category: DeviceCategory): string | null {
  switch (category) {
    case 'phone':
      return phone;
    case 'foldable':
      return foldable;
    case 'tablet':
      return tablet;
    case 'desktop':
      return desktop;
    default:
      return null;
  }
}
