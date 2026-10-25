import type { EngineInfo, OpenMessage } from '../../src/modules/preview-runtime/remote/protocol';
import type { LivePage } from '../browser/live-page';
import type { BrowserManager } from '../browser/manager';
import type { PageHost } from '../browser/remote-page';

/** Real Mobile Safari in Xcode's iOS Simulator (macOS only). Placeholder until implemented. */
export function createSimulatorPage(_id: string, _host: PageHost, _open: OpenMessage, _manager: BrowserManager): LivePage {
  throw new Error('The iOS Simulator engine is not available in this build yet.');
}

export async function iosSimulatorStatus(_manager: BrowserManager): Promise<EngineInfo> {
  return {
    id: 'ios-simulator',
    available: false,
    label: 'Safari (iOS Simulator)',
    detail: 'Not implemented yet.',
    features: { inspect: false, input: false, touch: false, foldEmulation: false, rotate: false },
  };
}
