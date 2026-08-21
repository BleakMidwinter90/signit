/**
 * Where a thing goes on a page.
 *
 * Two coordinate systems have to be reconciled, and getting it wrong is the
 * classic failure of every browser signing tool:
 *
 *   - the screen, where the origin is top-left and y grows downwards
 *   - PDF user space, where the origin is bottom-left and y grows upwards
 *
 * On top of that a page can carry a /Rotate of 90, 180 or 270. A scan from a
 * phone or an office copier very often does. The page is stored unrotated and
 * the viewer turns it, so a signature dropped on what looks like the bottom of
 * the page is nowhere near the bottom in the file — it lands on a side edge,
 * rotated, and the person only finds out after sending the contract.
 *
 * Placements are therefore stored normalised (0–1) against what is actually on
 * screen, which makes them independent of zoom, and converted to user space
 * only at the moment of drawing.
 */

export type Rotation = 0 | 90 | 180 | 270;

export interface PageSize {
  /** Unrotated, as the file stores it. */
  width: number;
  height: number;
  rotation: Rotation;
}

/** A position on the rendered page: 0–1 from the left, 0–1 from the top. */
export interface Normalised {
  x: number;
  y: number;
}

export interface UserSpacePoint {
  x: number;
  y: number;
}

export function normaliseRotation(value: number): Rotation {
  const wrapped = ((Math.round(value / 90) * 90) % 360 + 360) % 360;
  return wrapped as Rotation;
}

/** The size the page appears at once the viewer has turned it. */
export function displaySize(page: PageSize): { width: number; height: number } {
  const quarterTurned = page.rotation === 90 || page.rotation === 270;
  return quarterTurned
    ? { width: page.height, height: page.width }
    : { width: page.width, height: page.height };
}

/**
 * Convert a point on the rendered page into PDF user space.
 *
 * Derived by asking, for each rotation, where the unrotated corners end up on
 * screen — see the round-trip tests, which check every rotation against every
 * corner rather than trusting the arithmetic here.
 */
export function toUserSpace(point: Normalised, page: PageSize): UserSpacePoint {
  const { width: w, height: h } = page;

  switch (page.rotation) {
    case 90:
      // The unrotated bottom-left corner appears at the top-left of the screen.
      return { x: point.y * w, y: point.x * h };
    case 180:
      return { x: w - point.x * w, y: point.y * h };
    case 270:
      return { x: w - point.y * w, y: h - point.x * h };
    default:
      return { x: point.x * w, y: h - point.y * h };
  }
}

/** The inverse, for showing an existing placement back on screen. */
export function fromUserSpace(point: UserSpacePoint, page: PageSize): Normalised {
  const { width: w, height: h } = page;

  switch (page.rotation) {
    case 90:
      return { x: point.y / h, y: point.x / w };
    case 180:
      return { x: (w - point.x) / w, y: point.y / h };
    case 270:
      return { x: (h - point.y) / h, y: (w - point.x) / w };
    default:
      return { x: point.x / w, y: (h - point.y) / h };
  }
}

/**
 * How far to turn drawn content so it sits upright on screen.
 *
 * The viewer turns the whole page by `rotation`, so anything drawn axis-aligned
 * in user space arrives on screen turned by the same amount. Pre-turning it the
 * other way cancels that out.
 */
export function uprightRotation(page: PageSize): number {
  return (360 - page.rotation) % 360;
}

/**
 * Convert a size on the rendered page into user-space width and height.
 *
 * On a quarter-turned page the axes swap: something 200 points wide on screen
 * is 200 points tall in the file.
 */
export function sizeToUserSpace(
  size: { width: number; height: number },
  page: PageSize,
): { width: number; height: number } {
  const quarterTurned = page.rotation === 90 || page.rotation === 270;
  return quarterTurned ? { width: size.height, height: size.width } : { ...size };
}

/** Keep a placement on the page, allowing for its own size. */
export function clampToPage(point: Normalised, size: { width: number; height: number }): Normalised {
  return {
    x: Math.min(Math.max(point.x, 0), Math.max(0, 1 - size.width)),
    y: Math.min(Math.max(point.y, 0), Math.max(0, 1 - size.height)),
  };
}
