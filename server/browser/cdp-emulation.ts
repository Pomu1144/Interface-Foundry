import type { CDPSession } from 'playwright-core';
import type { DisplayFeatureMethod, EmulationParams } from '../../src/modules/preview-runtime/remote/protocol';
import { defaultUserAgent, deviceMetricsParams, displayFeatureFor, emulationKey, mediaFeatures, userAgentMetadataFor } from './emulation';

/** What has been applied to a CDP target, so repeated calls only send what changed. */
export type AppliedEmulation = { metrics: string; ua: string; media: string; touch: boolean | null; feature: string };

export const freshEmulation = (): AppliedEmulation => ({ metrics: '', ua: '', media: '', touch: null, feature: '' });

/**
 * Apply device emulation through CDP only (never Playwright's own viewport
 * emulation, which re-applies metrics on its own and would drop the display
 * feature). Changes take effect in place, without reloading.
 */
export async function applyCdpEmulation(
  cdp: CDPSession,
  e: EmulationParams,
  opts: { method: DisplayFeatureMethod; browserVersion: string },
  applied: AppliedEmulation,
): Promise<{ touchChanged: boolean }> {
  const d = e.device;
  const fold = opts.method === 'none' ? null : e.fold;
  const metricsKey = emulationKey.metrics(d, fold) + opts.method;
  if (metricsKey !== applied.metrics) {
    await cdp.send('Emulation.setDeviceMetricsOverride', deviceMetricsParams(d, fold, opts.method));
    applied.metrics = metricsKey;
  }
  if (opts.method === 'displayFeaturesOverride') {
    const fk = fold ? `${fold.axis}:${fold.offset}:${fold.maskLength}` : '';
    if (fk !== applied.feature) {
      if (fold) await cdp.send('Emulation.setDisplayFeaturesOverride', { features: [displayFeatureFor(fold)] });
      else await cdp.send('Emulation.clearDisplayFeaturesOverride');
      applied.feature = fk;
    }
  }
  const uaKey = emulationKey.ua(d);
  if (uaKey !== applied.ua) {
    const userAgent = d.userAgent ?? defaultUserAgent(opts.browserVersion);
    await cdp.send('Emulation.setUserAgentOverride', { userAgent, userAgentMetadata: userAgentMetadataFor(userAgent, opts.browserVersion, d.mobile) });
    applied.ua = uaKey;
  }
  let touchChanged = false;
  if (applied.touch !== d.touch) {
    await cdp.send('Emulation.setTouchEmulationEnabled', d.touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    touchChanged = applied.touch !== null;
    applied.touch = d.touch;
  }
  const mediaKey = emulationKey.media(e);
  if (mediaKey !== applied.media) {
    await cdp.send('Emulation.setEmulatedMedia', { media: '', features: mediaFeatures(e.colorScheme, e.reducedMotion) });
    applied.media = mediaKey;
  }
  return { touchChanged };
}
