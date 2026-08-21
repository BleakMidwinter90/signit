/**
 * Does the placement maths agree with a real PDF viewer?
 *
 *   npx vite-node scripts/verify-rotation.mjs
 *
 * The unit tests prove the coordinate maths is self-consistent — that it
 * round-trips and that four screen corners map to four distinct page corners.
 * They cannot prove it matches what a viewer actually draws, and a rotation
 * convention that is internally consistent but backwards would pass every one
 * of them while putting signatures on the wrong edge of every rotated scan.
 *
 * So this places a mark near the top-left of the *displayed* page at each
 * /Rotate value, renders the files the way a viewer would, and checks the dark
 * pixels really are in the top-left of the resulting image.
 *
 * Requires macOS `qlmanage` for rendering, which is why it is a script rather
 * than part of the test suite that runs in CI.
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { degrees, PDFDocument, rgb } from 'pdf-lib';
import sharp from 'sharp';

import { sizeToUserSpace, toUserSpace, type Rotation } from '../src/lib/placement';

const WIDTH = 595;
const HEIGHT = 842;
const AT = { x: 0.15, y: 0.15 };
const SIZE = { width: 0.25, height: 0.08 };

const work = mkdtempSync(join(tmpdir(), 'signit-rotation-'));
let failures = 0;

for (const rotation of [0, 90, 180, 270] as Rotation[]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([WIDTH, HEIGHT]);
  page.setRotation(degrees(rotation));

  const pageSize = { width: WIDTH, height: HEIGHT, rotation };
  const quarterTurned = rotation === 90 || rotation === 270;
  const display = quarterTurned ? { w: HEIGHT, h: WIDTH } : { w: WIDTH, h: HEIGHT };

  const origin = toUserSpace(AT, pageSize);
  const box = sizeToUserSpace(
    { width: SIZE.width * display.w, height: SIZE.height * display.h },
    pageSize,
  );

  // pdf-lib draws from a rectangle's lower-left corner, so the on-screen
  // top-left origin becomes a different corner at each rotation.
  const corner = {
    0: { x: origin.x, y: origin.y - box.height },
    90: { x: origin.x, y: origin.y },
    180: { x: origin.x - box.width, y: origin.y },
    270: { x: origin.x - box.width, y: origin.y - box.height },
  }[rotation];

  page.drawRectangle({ ...corner, width: box.width, height: box.height, color: rgb(0.85, 0.1, 0.1) });

  const pdfPath = join(work, `r${rotation}.pdf`);
  writeFileSync(pdfPath, await doc.save());
  execSync(`cd "${work}" && qlmanage -t -s 600 -o . r${rotation}.pdf`, { stdio: 'ignore' });

  const { data, info } = await sharp(`${pdfPath}.png`)
    .raw()
    .toBuffer({ resolveWithObject: true });

  let sumX = 0;
  let sumY = 0;
  let found = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const index = (y * info.width + x) * info.channels;
      if (data[index] > 120 && data[index + 1] < 90 && data[index + 2] < 90) {
        sumX += x;
        sumY += y;
        found += 1;
      }
    }
  }

  if (found === 0) {
    console.log(`${String(rotation).padStart(3)}°  NO MARK FOUND`);
    failures += 1;
    continue;
  }

  const cx = sumX / found / info.width;
  const cy = sumY / found / info.height;
  // The mark spans 0.15–0.40 across and 0.15–0.23 down, so its centre is here.
  const ok = Math.abs(cx - 0.275) < 0.05 && Math.abs(cy - 0.19) < 0.05;
  if (!ok) failures += 1;

  console.log(
    `${String(rotation).padStart(3)}°  rendered ${info.width}x${info.height}  centre (${cx.toFixed(2)}, ${cy.toFixed(2)})  ${ok ? 'correct' : 'WRONG — expected (0.28, 0.19)'}`,
  );
}

rmSync(work, { recursive: true, force: true });
console.log(failures === 0 ? '\nplacement agrees with the renderer' : `\n${failures} rotation(s) WRONG`);
process.exit(failures === 0 ? 0 : 1);
