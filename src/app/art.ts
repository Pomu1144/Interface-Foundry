/**
 * Illustration assets generated with Higgsfield (see docs/ASSETS.md).
 * UI glyphs are vector (lucide); these are used for brand, onboarding,
 * empty states and category art where a richer image helps.
 */
import appIcon from '@/assets/brand/ifdy-app-icon.webp';
import crucible from '@/assets/brand/ifdy-crucible.webp';
import welcomeHero from '@/assets/brand/welcome-hero.webp';
import design from '@/assets/icons3d/design.webp';
import inspect from '@/assets/icons3d/inspect.webp';
import simulate from '@/assets/icons3d/simulate.webp';
import test from '@/assets/icons3d/test.webp';
import ai from '@/assets/icons3d/ai.webp';
import ship from '@/assets/icons3d/ship.webp';
import phone from '@/assets/icons3d/device-phone.webp';
import foldable from '@/assets/icons3d/device-foldable.webp';
import tablet from '@/assets/icons3d/device-tablet.webp';
import desktop from '@/assets/icons3d/device-desktop.webp';
import select from '@/assets/icons3d/select.webp';
import record from '@/assets/icons3d/record.webp';
import hierarchy from '@/assets/icons3d/hierarchy-3d.webp';
import wall from '@/assets/icons3d/device-wall.webp';
import code from '@/assets/icons3d/code.webp';
import git from '@/assets/icons3d/git.webp';
import tokens from '@/assets/icons3d/tokens.webp';
import assets from '@/assets/icons3d/assets.webp';
import components from '@/assets/icons3d/components.webp';
import type { DeviceCategory } from '@shared/types';

export const art = {
  appIcon,
  crucible,
  welcomeHero,
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
