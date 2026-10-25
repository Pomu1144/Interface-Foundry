import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { AGENT_ENTRY, ROOT_DIR } from './config';

const require = createRequire(import.meta.url);

/**
 * Bundles the preview agent (src/agent) into a single classic script that is
 * injected as the first <script> in previewed documents. Rebuilt lazily in dev
 * when its sources change.
 */
export class AgentBundle {
  private code: string | null = null;
  private building: Promise<string> | null = null;
  private axe: string | null = null;
  private watchers: { close(): void }[] = [];

  constructor(private readonly opts: { dev: boolean }) {
    if (opts.dev) {
      for (const dir of ['src/agent', 'src/shared']) {
        try {
          this.watchers.push(
            watch(path.join(ROOT_DIR, dir), { recursive: true }, () => {
              this.code = null;
            }),
          );
        } catch {
          // Recursive watch is unavailable on some platforms; fall back to rebuilding every request.
        }
      }
    }
  }

  async get(): Promise<string> {
    if (this.code && (this.watchers.length || !this.opts.dev)) return this.code;
    if (!this.building) {
      this.building = this.build().finally(() => {
        this.building = null;
      });
    }
    return this.building;
  }

  private async build(): Promise<string> {
    const result = await esbuild.build({
      entryPoints: [AGENT_ENTRY],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      target: ['chrome110', 'safari16', 'firefox115'],
      minify: !this.opts.dev,
      sourcemap: this.opts.dev ? 'inline' : false,
      legalComments: 'none',
      alias: { '@shared': path.join(ROOT_DIR, 'src/shared') },
      define: { 'process.env.NODE_ENV': JSON.stringify(this.opts.dev ? 'development' : 'production') },
      logLevel: 'silent',
    });
    const code = `/* IFDY preview agent — injected by Interface Foundry for inspection. */\n${result.outputFiles[0].text}`;
    this.code = code;
    return code;
  }

  async getAxe(): Promise<string> {
    if (!this.axe) {
      this.axe = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
    }
    return this.axe;
  }

  close() {
    for (const w of this.watchers) w.close();
  }
}

/** Inject the agent <script> as early as possible in an HTML document. */
export function injectAgent(html: string, agentSrc = '/__ifdy/agent.js'): string {
  const tag = `<script src="${agentSrc}" data-ifdy-agent></script>`;
  if (html.includes('data-ifdy-agent')) return html;
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch && headMatch.index !== undefined) {
    const i = headMatch.index + headMatch[0].length;
    return html.slice(0, i) + tag + html.slice(i);
  }
  const htmlMatch = html.match(/<html[^>]*>/i);
  if (htmlMatch && htmlMatch.index !== undefined) {
    const i = htmlMatch.index + htmlMatch[0].length;
    return html.slice(0, i) + `<head>${tag}</head>` + html.slice(i);
  }
  return tag + html;
}
