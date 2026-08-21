/**
 * Does a stamp land in the right place, the right way up?
 *
 *   npm run verify:stamp
 *
 * Position alone is not enough: an image placed correctly but turned ninety
 * degrees is still a ruined document, and no unit test can see it. So the mark
 * is deliberately asymmetric — a wide red bar with a black square in its
 * top-left corner — and the render is checked for three things at each /Rotate
 * value:
 *
 *   1. the bar is where it was asked to go
 *   2. the bar is wider than it is tall, so it has not been turned
 *   3. the black square is at the bar's top-left, so it has not been flipped
 *
 * Needs macOS `qlmanage`, which is why this is a script rather than part of CI.
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { degrees, PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

import { applyStamps, type Stamp } from '../src/lib/pdf';

const WIDTH = 595;
const HEIGHT = 842;
const AT = { x: 0.15, y: 0.15 };
const STAMP_WIDTH = 0.3;

/** A wide red bar with a black square in its top-left. */
async function mark(): Promise<{ bytes: ArrayBuffer; aspect: number }> {
  const w = 240;
  const h = 72;
  const png = await sharp({
    create: { width: w, height: h, channels: 4, background: { r: 220, g: 30, b: 30, alpha: 1 } },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 28, height: 28, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
        })
          .png()
          .toBuffer(),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();

  return {
    bytes: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer,
    aspect: w / h,
  };
}

const work = mkdtempSync(join(tmpdir(), 'signit-stamp-'));
const { bytes: markBytes, aspect } = await mark();
let failures = 0;

for (const rotation of [0, 90, 180, 270]) {
  const source = await PDFDocument.create();
  const page = source.addPage([WIDTH, HEIGHT]);
  page.setRotation(degrees(rotation));
  const original = await source.save();

  const stamps: Stamp[] = [
    { kind: 'image', page: 0, at: AT, width: STAMP_WIDTH, bytes: markBytes, aspect },
  ];

  const blob = await applyStamps(
    original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength) as ArrayBuffer,
    stamps,
  );

  const out = join(work, `s${rotation}.pdf`);
  writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
  execSync(`cd "${work}" && qlmanage -t -s 800 -o . s${rotation}.pdf`, { stdio: 'ignore' });

  const { data, info } = await sharp(`${out}.png`).raw().toBuffer({ resolveWithObject: true });

  let red = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, n: 0 };
  let black = { sumX: 0, sumY: 0, n: 0 };

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];

      if (r > 150 && g < 90 && b < 90) {
        red.minX = Math.min(red.minX, x); red.maxX = Math.max(red.maxX, x);
        red.minY = Math.min(red.minY, y); red.maxY = Math.max(red.maxY, y);
        red.n += 1;
      } else if (r < 70 && g < 70 && b < 70) {
        black.sumX += x; black.sumY += y; black.n += 1;
      }
    }
  }

  if (red.n === 0 || black.n === 0) {
    console.log(`${String(rotation).padStart(3)}°  MARK NOT FOUND`);
    failures += 1;
    continue;
  }

  const barWidth = red.maxX - red.minX;
  const barHeight = red.maxY - red.minY;
  const placedX = red.minX / info.width;
  const placedY = red.minY / info.height;

  const upright = barWidth > barHeight;
  const cornerX = black.sumX / black.n;
  const cornerY = black.sumY / black.n;
  const notchTopLeft = cornerX < (red.minX + red.maxX) / 2 && cornerY < (red.minY + red.maxY) / 2;
  const positioned = Math.abs(placedX - AT.x) < 0.04 && Math.abs(placedY - AT.y) < 0.04;

  const ok = upright && notchTopLeft && positioned;
  if (!ok) failures += 1;

  console.log(
    `${String(rotation).padStart(3)}°  at (${placedX.toFixed(2)}, ${placedY.toFixed(2)})` +
      `  ${positioned ? 'placed' : 'MISPLACED'}` +
      `  ${upright ? 'upright' : 'TURNED'}` +
      `  ${notchTopLeft ? 'not flipped' : 'FLIPPED'}`,
  );
}

rmSync(work, { recursive: true, force: true });
console.log(failures === 0 ? '\nstamps land correctly at every rotation' : `\n${failures} rotation(s) WRONG`);
process.exit(failures === 0 ? 0 : 1);
