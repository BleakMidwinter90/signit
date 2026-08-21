/**
 * Serves the built app on the local network.
 *
 *   npm run build && node scripts/serve.mjs
 *
 * A short static file server rather than a dependency — the whole app is a
 * folder of static files, which is also the point being demonstrated.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);

// `.ttf` matters here: the embedded fonts are fetched at runtime, and a font
// served as octet-stream is refused by some browsers.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

const server = createServer(async (request, response) => {
  const requested = decodeURIComponent((request.url ?? '/').split('?')[0]);
  // Normalise and refuse anything trying to climb out of dist.
  const relative = normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const path = relative === '/' ? '/index.html' : relative;

  try {
    const body = await readFile(join(DIST, path));
    const type = MIME[extname(path)];
    if (!type) console.warn(`  no content type for ${extname(path)} (${path})`);
    response.writeHead(200, { 'Content-Type': type ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    // Single-page app: unknown paths fall back to the shell.
    try {
      const shell = await readFile(join(DIST, 'index.html'));
      response.writeHead(200, { 'Content-Type': MIME['.html'] });
      response.end(shell);
    } catch {
      response.writeHead(404).end('not found');
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);

  console.log(`signit serving ${DIST}`);
  console.log(`  local:   http://localhost:${PORT}/`);
  for (const address of addresses) console.log(`  network: http://${address}:${PORT}/`);
});
