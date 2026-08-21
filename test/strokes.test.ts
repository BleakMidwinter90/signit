import { describe, expect, it } from 'vitest';

import {
  boundsOf,
  countPoints,
  isEmpty,
  simplify,
  toPathData,
  trim,
  type Stroke,
} from '../src/lib/strokes';

const line: Stroke = [
  { x: 0, y: 0 },
  { x: 5, y: 0.2 },
  { x: 10, y: 0 },
];

describe('isEmpty', () => {
  it('is true for nothing drawn', () => {
    expect(isEmpty([])).toBe(true);
    expect(isEmpty([[], []])).toBe(true);
  });

  it('is false once there is a single dot', () => {
    expect(isEmpty([[{ x: 1, y: 1 }]])).toBe(false);
  });
});

describe('boundsOf', () => {
  it('finds the extent across every stroke', () => {
    expect(boundsOf([line, [{ x: -3, y: 8 }]])).toEqual({ minX: -3, minY: 0, maxX: 10, maxY: 8 });
  });

  it('is null when there is no ink', () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([[]])).toBeNull();
  });
});

describe('trim', () => {
  it('moves the ink to the origin and reports its size', () => {
    // Someone signs in the middle of the pad; embedding the whole pad would
    // surround the signature with empty space.
    const result = trim([[{ x: 100, y: 50 }, { x: 140, y: 70 }]]);
    expect(result.strokes[0]).toEqual([{ x: 0, y: 0 }, { x: 40, y: 20 }]);
    expect(result).toMatchObject({ width: 40, height: 20 });
  });

  it('adds padding so a thick stroke is not clipped at the edge', () => {
    const result = trim([[{ x: 10, y: 10 }, { x: 20, y: 20 }]], 5);
    expect(result.strokes[0]).toEqual([{ x: 5, y: 5 }, { x: 15, y: 15 }]);
    expect(result).toMatchObject({ width: 20, height: 20 });
  });

  it('handles no ink without producing NaN', () => {
    expect(trim([])).toEqual({ strokes: [], width: 0, height: 0 });
  });
});

describe('simplify', () => {
  it('keeps both ends, always', () => {
    const result = simplify(line, 1);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[result.length - 1]).toEqual({ x: 10, y: 0 });
  });

  it('drops a point that is nearly on the line', () => {
    expect(simplify(line, 1)).toHaveLength(2);
  });

  it('keeps a point that genuinely departs from it', () => {
    const bent: Stroke = [{ x: 0, y: 0 }, { x: 5, y: 9 }, { x: 10, y: 0 }];
    expect(simplify(bent, 1)).toHaveLength(3);
  });

  it('leaves very short strokes alone', () => {
    expect(simplify([{ x: 1, y: 1 }], 1)).toHaveLength(1);
    expect(simplify([{ x: 1, y: 1 }, { x: 2, y: 2 }], 1)).toHaveLength(2);
  });

  it('never reorders or invents points', () => {
    const wobbly: Stroke = Array.from({ length: 200 }, (_, index) => ({
      x: index,
      y: Math.sin(index / 8) * 20,
    }));
    const result = simplify(wobbly, 1);

    let cursor = 0;
    for (const point of result) {
      const found = wobbly.indexOf(point, cursor);
      expect(found, 'points stay in order and come from the input').toBeGreaterThanOrEqual(cursor);
      cursor = found;
    }
  });

  it('survives a stroke long enough to overflow a recursive version', () => {
    // A slow signature really can arrive as thousands of points, and a
    // recursive implementation blows the stack on a near-straight one.
    const huge: Stroke = Array.from({ length: 60_000 }, (_, index) => ({ x: index, y: 0 }));
    expect(() => simplify(huge, 0.5)).not.toThrow();
    expect(simplify(huge, 0.5).length).toBeLessThan(10);
  });

  it('handles a stroke where every point is identical', () => {
    const stack: Stroke = Array.from({ length: 50 }, () => ({ x: 4, y: 4 }));
    expect(() => simplify(stack, 1)).not.toThrow();
  });
});

describe('toPathData', () => {
  it('starts each stroke with a move', () => {
    expect(toPathData([line]).startsWith('M 0 0')).toBe(true);
  });

  it('smooths with curves rather than straight segments', () => {
    // Straight lines between samples look like handwriting drawn with a ruler.
    expect(toPathData([line])).toContain('Q');
  });

  it('draws a single tap as a visible dot', () => {
    const path = toPathData([[{ x: 3, y: 4 }]]);
    expect(path).not.toBe('');
    expect(path).toContain('a');
  });

  it('produces separate subpaths for separate strokes', () => {
    const path = toPathData([line, [{ x: 20, y: 20 }, { x: 30, y: 30 }]]);
    expect(path.match(/M /g)).toHaveLength(2);
  });

  it('is empty for no ink', () => {
    expect(toPathData([])).toBe('');
    expect(toPathData([[]])).toBe('');
  });
});

describe('countPoints', () => {
  it('adds up every stroke', () => {
    expect(countPoints([line, [{ x: 1, y: 1 }]])).toBe(4);
  });
});
