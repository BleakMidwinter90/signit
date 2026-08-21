/**
 * Reading a PDF, and writing marks onto it.
 *
 * Everything happens in the tab. The premise is the whole point: the documents
 * people need to sign are tenancy agreements, employment contracts, passports
 * and bank mandates, and the ordinary way to sign one is to upload it to a
 * stranger's server.
 */

import { degrees, PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import {
  normaliseRotation,
  toUserSpace,
  uprightRotation,
  type Normalised,
  type PageSize,
} from './placement';

export interface PageInfo extends PageSize {
  index: number;
}

export interface DocumentInfo {
  pageCount: number;
  pages: PageInfo[];
  encrypted: boolean;
}

/**
 * `ignoreEncryption` opens the very common case of a file carrying only an
 * owner password — the sort that marks a document "do not print". A file with a
 * real user password still fails, which is correct: it is genuinely locked.
 */
async function load(bytes: ArrayBuffer): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { ignoreEncryption: true });
}

export async function readDocument(bytes: ArrayBuffer): Promise<DocumentInfo> {
  const doc = await load(bytes);

  return {
    pageCount: doc.getPageCount(),
    encrypted: doc.isEncrypted,
    pages: doc.getPages().map((page, index) => {
      const { width, height } = page.getSize();
      return {
        index,
        width,
        height,
        rotation: normaliseRotation(page.getRotation().angle),
      };
    }),
  };
}

/** A signature, initial or image, drawn onto the page. */
export interface ImageStamp {
  kind: 'image';
  page: number;
  /** Top-left, normalised against the page as displayed. */
  at: Normalised;
  /** Fraction of the displayed page width. Height follows the aspect ratio. */
  width: number;
  bytes: ArrayBuffer;
  /** Aspect ratio of the image, width divided by height. */
  aspect: number;
}

/** Typed text — a name, a date, a reference. */
export interface TextStamp {
  kind: 'text';
  page: number;
  at: Normalised;
  text: string;
  /** Points, at 100% zoom. */
  size: number;
}

export type Stamp = ImageStamp | TextStamp;

/**
 * Where pdf-lib should be told to draw, given where it should appear.
 *
 * pdf-lib anchors at the lower-left corner and rotates about that same point,
 * counter-clockwise. So for each page rotation the on-screen top-left has to be
 * translated to whichever corner ends up being the anchor once the content has
 * been turned upright.
 *
 * Worked out against a real renderer rather than derived on paper — see
 * `scripts/verify-rotation.ts`, which draws at each rotation and checks the
 * pixels land where they should.
 */
function anchorFor(
  origin: { x: number; y: number },
  displayed: { width: number; height: number },
  rotation: number,
): { x: number; y: number } {
  // Derived by rotating the image's own corners about the anchor and solving
  // for the anchor that makes the result cover the intended screen rectangle.
  // Every case turns on the displayed *height*, which is not obvious and is why
  // this was got wrong first time.
  switch (rotation) {
    case 90:
      return { x: origin.x + displayed.height, y: origin.y };
    case 180:
      return { x: origin.x, y: origin.y + displayed.height };
    case 270:
      return { x: origin.x - displayed.height, y: origin.y };
    default:
      return { x: origin.x, y: origin.y - displayed.height };
  }
}

/**
 * Apply the stamps and return the finished file.
 *
 * The result is flattened — the marks are page content, not annotations or form
 * fields — because an annotation can be moved or deleted by any reader, and a
 * signature that the recipient can drag off the page is not a signature.
 */
export async function applyStamps(bytes: ArrayBuffer, stamps: readonly Stamp[]): Promise<Blob> {
  const doc = await load(bytes);
  const pages = doc.getPages();

  // Embedded once and reused: the same signature is usually placed on several
  // pages, and embedding it per stamp would multiply the file size by the
  // number of places it appears.
  const embedded = new Map<ArrayBuffer, Awaited<ReturnType<typeof doc.embedPng>>>();
  let helvetica: Awaited<ReturnType<typeof doc.embedFont>> | null = null;

  for (const stamp of stamps) {
    const page = pages[stamp.page];
    if (!page) continue;

    const { width, height } = page.getSize();
    const rotation = normaliseRotation(page.getRotation().angle);
    const pageSize: PageSize = { width, height, rotation };

    // The page as the reader sees it: a quarter turn swaps the axes.
    const display =
      rotation === 90 || rotation === 270 ? { w: height, h: width } : { w: width, h: height };

    const origin = toUserSpace(stamp.at, pageSize);
    const upright = uprightRotation(pageSize);

    if (stamp.kind === 'image') {
      let image = embedded.get(stamp.bytes);
      if (!image) {
        image = await doc.embedPng(stamp.bytes);
        embedded.set(stamp.bytes, image);
      }

      const displayWidth = stamp.width * display.w;
      const displayHeight = displayWidth / stamp.aspect;
      const anchor = anchorFor(origin, { width: displayWidth, height: displayHeight }, rotation);

      // The width and height passed are the on-screen ones; the rotation is
      // what puts them on the right axes, so they are never swapped here.
      page.drawImage(image, {
        x: anchor.x,
        y: anchor.y,
        width: displayWidth,
        height: displayHeight,
        rotate: degrees(upright),
      });
      continue;
    }

    helvetica ??= await doc.embedFont(StandardFonts.Helvetica);

    const textWidth = helvetica.widthOfTextAtSize(stamp.text, stamp.size);
    const textHeight = helvetica.heightAtSize(stamp.size);
    const anchor = anchorFor(origin, { width: textWidth, height: textHeight }, rotation);

    page.drawText(stamp.text, {
      x: anchor.x,
      y: anchor.y,
      size: stamp.size,
      font: helvetica,
      color: rgb(0.06, 0.09, 0.16),
      rotate: degrees(upright),
    });
  }

  const saved = await doc.save({ useObjectStreams: true });
  return new Blob([saved as BlobPart], { type: 'application/pdf' });
}

export function isPdf(file: { name: string; type: string }): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}
