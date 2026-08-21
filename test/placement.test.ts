import { describe, expect, it } from 'vitest';

import {
  clampToPage,
  displaySize,
  fromUserSpace,
  normaliseRotation,
  sizeToUserSpace,
  toUserSpace,
  uprightRotation,
  type PageSize,
  type Rotation,
} from '../src/lib/placement';

const A4 = (rotation: Rotation): PageSize => ({ width: 595, height: 842, rotation });
const ROTATIONS: Rotation[] = [0, 90, 180, 270];

describe('displaySize', () => {
  it('swaps the axes on a quarter turn', () => {
    expect(displaySize(A4(0))).toEqual({ width: 595, height: 842 });
    expect(displaySize(A4(90))).toEqual({ width: 842, height: 595 });
    expect(displaySize(A4(180))).toEqual({ width: 595, height: 842 });
    expect(displaySize(A4(270))).toEqual({ width: 842, height: 595 });
  });
});

describe('toUserSpace', () => {
  it('flips the y axis on an unrotated page', () => {
    // Top-left on screen is the top-left of the page, which in user space is
    // x=0 and y=height, because PDF measures y from the bottom.
    expect(toUserSpace({ x: 0, y: 0 }, A4(0))).toEqual({ x: 0, y: 842 });
    expect(toUserSpace({ x: 1, y: 1 }, A4(0))).toEqual({ x: 595, y: 0 });
    expect(toUserSpace({ x: 0.5, y: 0.5 }, A4(0))).toEqual({ x: 297.5, y: 421 });
  });

  it('puts the screen top-left in the right place on a rotated page', () => {
    // On a page turned 90°, the unrotated bottom-left corner is what appears at
    // the top-left of the screen. Signing "the bottom of the page" on screen
    // must not write to the bottom of the file.
    expect(toUserSpace({ x: 0, y: 0 }, A4(90))).toEqual({ x: 0, y: 0 });
    expect(toUserSpace({ x: 0, y: 0 }, A4(180))).toEqual({ x: 595, y: 0 });
    expect(toUserSpace({ x: 0, y: 0 }, A4(270))).toEqual({ x: 595, y: 842 });
  });

  it('never puts a point outside the page, for any rotation or corner', () => {
    for (const rotation of ROTATIONS) {
      for (const x of [0, 0.5, 1]) {
        for (const y of [0, 0.5, 1]) {
          const point = toUserSpace({ x, y }, A4(rotation));
          expect(point.x, `${rotation}° (${x},${y})`).toBeGreaterThanOrEqual(0);
          expect(point.x, `${rotation}° (${x},${y})`).toBeLessThanOrEqual(595);
          expect(point.y, `${rotation}° (${x},${y})`).toBeGreaterThanOrEqual(0);
          expect(point.y, `${rotation}° (${x},${y})`).toBeLessThanOrEqual(842);
        }
      }
    }
  });

  it('maps the four screen corners to four distinct page corners', () => {
    // A rotation that collapsed two corners together would be silently wrong.
    for (const rotation of ROTATIONS) {
      const corners = [
        toUserSpace({ x: 0, y: 0 }, A4(rotation)),
        toUserSpace({ x: 1, y: 0 }, A4(rotation)),
        toUserSpace({ x: 0, y: 1 }, A4(rotation)),
        toUserSpace({ x: 1, y: 1 }, A4(rotation)),
      ].map((point) => `${point.x},${point.y}`);

      expect(new Set(corners).size, `${rotation}°`).toBe(4);
    }
  });
});

describe('fromUserSpace', () => {
  it('is the inverse of toUserSpace, at every rotation', () => {
    for (const rotation of ROTATIONS) {
      for (const x of [0, 0.2, 0.5, 0.9, 1]) {
        for (const y of [0, 0.3, 0.5, 0.7, 1]) {
          const round = fromUserSpace(toUserSpace({ x, y }, A4(rotation)), A4(rotation));
          expect(round.x, `${rotation}° x`).toBeCloseTo(x, 10);
          expect(round.y, `${rotation}° y`).toBeCloseTo(y, 10);
        }
      }
    }
  });
});

describe('uprightRotation', () => {
  it('cancels out the turn the viewer applies', () => {
    expect(uprightRotation(A4(0))).toBe(0);
    expect(uprightRotation(A4(90))).toBe(270);
    expect(uprightRotation(A4(180))).toBe(180);
    expect(uprightRotation(A4(270))).toBe(90);
  });
});

describe('sizeToUserSpace', () => {
  it('swaps width and height on a quarter turn', () => {
    // Something 200 wide on screen is 200 tall in the file.
    expect(sizeToUserSpace({ width: 200, height: 80 }, A4(90))).toEqual({ width: 80, height: 200 });
    expect(sizeToUserSpace({ width: 200, height: 80 }, A4(0))).toEqual({ width: 200, height: 80 });
  });
});

describe('normaliseRotation', () => {
  it('accepts the values PDFs actually contain', () => {
    expect(normaliseRotation(0)).toBe(0);
    expect(normaliseRotation(90)).toBe(90);
    expect(normaliseRotation(360)).toBe(0);
    expect(normaliseRotation(450)).toBe(90);
    // Negative rotations are legal and appear in real files.
    expect(normaliseRotation(-90)).toBe(270);
    expect(normaliseRotation(-270)).toBe(90);
  });

  it('snaps something that is not a quarter turn', () => {
    expect(normaliseRotation(89)).toBe(90);
    expect(normaliseRotation(3)).toBe(0);
  });
});

describe('clampToPage', () => {
  it('keeps a placement fully on the page', () => {
    const size = { width: 0.3, height: 0.1 };
    expect(clampToPage({ x: 0.9, y: 0.95 }, size)).toEqual({ x: 0.7, y: 0.9 });
    expect(clampToPage({ x: -0.2, y: -0.5 }, size)).toEqual({ x: 0, y: 0 });
  });

  it('does not go negative when the thing is bigger than the page', () => {
    expect(clampToPage({ x: 0.5, y: 0.5 }, { width: 1.5, height: 2 })).toEqual({ x: 0, y: 0 });
  });
});
