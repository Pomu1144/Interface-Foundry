import { access } from 'node:fs/promises';
import type { IfdyServices } from '../services';

export type BrowserStatus = { available: boolean; reason: string; executable?: string };

let cached: BrowserStatus | null = null;

/** Whether a controlled Chromium can be launched (Playwright installed + browser binary present). */
export async function getBrowserStatus(services: IfdyServices): Promise<BrowserStatus> {
  if (!services.config.browserEnabled) return { available: false, reason: 'Disabled with IFDY_BROWSER=0.' };
  if (cached) return cached;
  try {
    const pw = await import('playwright-core');
    const executable = services.config.chromiumPath || pw.chromium.executablePath();
    await access(executable);
    cached = { available: true, reason: 'Playwright Chromium ready.', executable };
  } catch (err) {
    cached = {
      available: false,
      reason: `Chromium not found. Run "npm run browsers:install". (${(err as Error).message.split('\n')[0]})`,
    };
  }
  return cached;
}
