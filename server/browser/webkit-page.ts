import type { EngineInfo, OpenMessage } from '../../src/modules/preview-runtime/remote/protocol';
import type { LivePage } from './live-page';
import type { BrowserManager } from './manager';
import type { PageHost } from './remote-page';

/** WebKit engine (Playwright's WebKit build). Placeholder until implemented. */
export function createWebKitPage(_id: string, _host: PageHost, _open: OpenMessage, _manager: BrowserManager): LivePage {
  throw new Error('The WebKit engine is not available in this build yet.');
}

export async function webkitStatus(_manager: BrowserManager): Promise<EngineInfo> {
  return { id: 'webkit', available: false, label: 'WebKit', detail: 'Not implemented yet.', features: { inspect: false, input: false, touch: false, foldEmulation: false, rotate: false } };
}
