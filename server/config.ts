import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEMO_DIR = path.join(ROOT_DIR, 'demo');
export const AGENT_ENTRY = path.join(ROOT_DIR, 'src', 'agent', 'index.ts');

export type IfdyServerConfig = {
  /** Random per-launch token required by every studio API call. */
  apiToken: string;
  previewPort: number;
  /** Explicit public origin for the preview host (port-forwarded setups). */
  previewOrigin?: string;
  allowedRoots: string[];
  browserEnabled: boolean;
  chromiumPath?: string;
  ai: {
    anthropicKey?: string;
    model: string;
    localUrl?: string;
    localModel?: string;
  };
  dev: boolean;
};

export function loadConfig(opts: { dev: boolean; studioPort: number }): IfdyServerConfig {
  const env = process.env;
  const previewPort = Number(env.IFDY_PREVIEW_PORT) || opts.studioPort + 1;
  return {
    apiToken: randomBytes(24).toString('hex'),
    previewPort,
    previewOrigin: env.IFDY_PREVIEW_ORIGIN || undefined,
    allowedRoots: (env.IFDY_ALLOWED_ROOTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((p) => path.resolve(p)),
    browserEnabled: env.IFDY_BROWSER !== '0',
    chromiumPath: env.IFDY_CHROMIUM_PATH || undefined,
    ai: {
      anthropicKey: env.ANTHROPIC_API_KEY || undefined,
      // No built-in default: the hosted provider runs only once a model id is configured.
      model: env.IFDY_AI_MODEL || '',
      localUrl: env.IFDY_LOCAL_AI_URL || undefined,
      localModel: env.IFDY_LOCAL_AI_MODEL || undefined,
    },
    dev: opts.dev,
  };
}
