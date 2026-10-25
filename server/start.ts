/**
 * Production entry: serves the built studio (dist/) plus the companion API and
 * the separate-origin preview host.  `npm run build && npm start`
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createIfdyServer } from './app';
import { loadConfig, ROOT_DIR } from './config';
import { mimeFor, safeJoin } from './http';

const port = Number(process.env.IFDY_PORT) || 4310;
const config = loadConfig({ dev: false, studioPort: port });
const ifdy = createIfdyServer(config, () => port);
const DIST = path.join(ROOT_DIR, 'dist');

const server = createServer((req, res) => {
  ifdy.middleware(req, res, async () => {
    const url = new URL(req.url ?? '/', 'http://studio.local');
    let file = safeJoin(DIST, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    try {
      if (!file || !(await stat(file)).isFile()) file = path.join(DIST, 'index.html');
      const data = await readFile(file);
      res.setHeader('Content-Type', mimeFor(file));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      if (file.endsWith('index.html')) res.setHeader('Cache-Control', 'no-store');
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end('IFDY studio build not found. Run "npm run build" first.');
    }
  });
});

server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/api/ws/') || !ifdy.upgrade(req, socket, head)) socket.destroy();
});

server.listen(port, async () => {
  const previewPort = await ifdy.listenPreview();
  console.log(`IFDY studio     http://localhost:${port}/`);
  console.log(`Preview origin  http://localhost:${previewPort}/ (isolated)`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await ifdy.close();
    server.close();
    process.exit(0);
  });
}
