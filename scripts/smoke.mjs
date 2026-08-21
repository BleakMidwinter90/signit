/**
 * End-to-end smoke test, run against a real browser.
 *
 *   npm run smoke
 *
 * The unit tests cover the coordinate maths. The two `verify:` scripts check
 * the maths against a real renderer, but need macOS to do it. This covers the
 * part neither can: that drawing a signature and clicking a page actually
 * produces a signed file.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { degrees, PDFDocument } from 'pdf-lib';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const PORT = 4186;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  // The pdf.js worker is emitted as .mjs, and a browser refuses to execute a
  // module served as application/octet-stream.
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
};

const server = createServer(async (request, response) => {
  const path = request.url === '/' ? '/index.html' : request.url.split('?')[0];
  try {
    const body = await readFile(join(DIST, path));
    const type = MIME[extname(path)];
    if (!type) console.warn(`  no content type for ${extname(path)} (${path}) — add it to MIME`);
    response.writeHead(200, { 'Content-Type': type ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end('not found');
  }
});
await new Promise((resolve) => server.listen(PORT, resolve));

const failures = [];
const check = (label, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures.push(label);
};

/* Two pages, the second rotated — the case that used to be silently wrong. */
const source = await PDFDocument.create();
source.addPage([595, 842]);
source.addPage([595, 842]).setRotation(degrees(90));
const original = Buffer.from(await source.save());

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
const workers = [];
page.on('worker', (worker) => workers.push(worker.url()));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
check('page loads', (await page.locator('h1').innerText()).includes('signit'));
check('no file input prompt is hidden away', (await page.locator('input[type=file]').count()) === 1);

await page.setInputFiles('input[type=file]', {
  name: 'contract.pdf',
  mimeType: 'application/pdf',
  buffer: original,
});

await page.waitForSelector('[data-testid="page-canvas"] canvas', { timeout: 25_000 });
check('the document is drawn', true);
check('the page count is read', /page 1 of 2/.test(await page.locator('main, body').innerText()));

/*
 * pdf.js falls back to decoding on the main thread when its worker cannot be
 * loaded, and the pixels come out identical — so only the presence of a real
 * worker distinguishes a working build from a broken one.
 */
check(
  'rendering ran in a worker, not on the main thread',
  workers.some((url) => /pdf\.worker/i.test(url)),
  workers.map((url) => url.split('/').pop()).join(', ') || 'none spawned',
);

/* Draw something with real pointer events, the way a person would. */
await page.getByRole('button', { name: /Draw signature/ }).click();
const pad = await page.locator('svg[role="application"]').boundingBox();
await page.mouse.move(pad.x + 60, pad.y + 120);
await page.mouse.down();
for (let step = 0; step <= 40; step++) {
  await page.mouse.move(pad.x + 60 + step * 8, pad.y + 120 - Math.sin(step / 4) * 35);
}
await page.mouse.up();

check('drawing is accepted', await page.getByRole('button', { name: /Use this signature/ }).isEnabled());
await page.getByRole('button', { name: /Use this signature/ }).click();
await page.waitForSelector('img[alt="Your signature"]', { timeout: 10_000 });
check('the signature is captured', true);

/* Place one on each page, including the rotated one. */
const sheet = await page.locator('[data-testid="page-canvas"]').boundingBox();
await page.mouse.click(sheet.x + sheet.width * 0.4, sheet.y + sheet.height * 0.7);
await page.waitForTimeout(300);
check('clicking the page places it', (await page.locator('img[alt^="Signature on page"]').count()) === 1);

await page.getByRole('button', { name: 'Next', exact: true }).click();
await page.waitForTimeout(800);
const rotated = await page.locator('[data-testid="page-canvas"]').boundingBox();
await page.mouse.click(rotated.x + rotated.width * 0.5, rotated.y + rotated.height * 0.5);
await page.waitForTimeout(300);
check('it can be placed on a rotated page too', (await page.locator('img[alt^="Signature on page"]').count()) === 1);

const listed = await page.locator('aside').innerText();
check('both placements are listed', /Placed \(2\)/i.test(listed), listed.replace(/\n/g, ' | '));

/* The signed file is the product, so it is checked on its own. */
const downloading = page.waitForEvent('download', { timeout: 30_000 });
await page.getByRole('button', { name: /Download signed PDF/ }).click();
const download = await downloading.catch(() => null);

if (download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const signed = Buffer.concat(chunks);

  check('the download is a PDF', signed.subarray(0, 5).toString() === '%PDF-');
  check('named after the original', /contract/.test(download.suggestedFilename()), download.suggestedFilename());

  const doc = await PDFDocument.load(signed);
  check('every page survived', doc.getPageCount() === 2, `${doc.getPageCount()}`);

  // The rotated page must still be rotated: rewriting the file must not
  // silently straighten it, which would reflow the original content.
  check('the rotated page is still rotated', doc.getPage(1).getRotation().angle === 90);

  /*
   * The signature has to be in the file rather than merely on screen. An
   * embedded image is the evidence — the file grows by the size of the PNG.
   */
  check(
    'the signature reached the file',
    signed.length > original.length + 2000,
    `${original.length} -> ${signed.length} bytes`,
  );
} else {
  check('the download is a PDF', false, 'no download appeared');
}

check('no uncaught page errors', pageErrors.length === 0, pageErrors.join('; '));

await browser.close();
server.close();

console.log(
  `\n${failures.length === 0 ? 'all checks passed' : `${failures.length} FAILED: ${failures.join(', ')}`}`,
);
process.exit(failures.length === 0 ? 0 : 1);
