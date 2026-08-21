/**
 * A drawn signature, as points.
 *
 * Kept as plain data rather than pixels for as long as possible: it can be
 * simplified, trimmed and re-rendered at whatever resolution the PDF needs,
 * where a bitmap captured at pad size would be embedded blurry.
 */

export interface Point {
  x: number;
  y: number;
}

/** One continuous line — pen down to pen up. */
export type Stroke = Point[];

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function isEmpty(strokes: readonly Stroke[]): boolean {
  return strokes.every((stroke) => stroke.length === 0);
}

/** The ink's extent, or null when there is none. */
export function boundsOf(strokes: readonly Stroke[]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of strokes) {
    for (const point of stroke) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
  }

  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/**
 * Crop to the ink and move it to the origin.
 *
 * Someone signs in the middle of the pad, not filling it. Embedding the whole
 * pad would surround the signature with empty space, so it would have to be
 * placed tiny to look right on the page. Padding is added back in stroke widths
 * so the ink is not clipped at the edges.
 */
export function trim(strokes: readonly Stroke[], padding = 0): { strokes: Stroke[]; width: number; height: number } {
  const bounds = boundsOf(strokes);
  if (!bounds) return { strokes: [], width: 0, height: 0 };

  const offsetX = bounds.minX - padding;
  const offsetY = bounds.minY - padding;

  return {
    strokes: strokes.map((stroke) => stroke.map((point) => ({ x: point.x - offsetX, y: point.y - offsetY }))),
    width: bounds.maxX - bounds.minX + padding * 2,
    height: bounds.maxY - bounds.minY + padding * 2,
  };
}

/**
 * Drop points that add nothing, by perpendicular distance.
 *
 * A pointer event fires far more often than a signature has detail — a slow,
 * careful signature can arrive as thousands of points, most of them a fraction
 * of a pixel apart. Keeping them all makes the embedded path enormous for no
 * visible difference.
 *
 * Ramer–Douglas–Peucker, iterative rather than recursive: a long stroke would
 * otherwise be able to overflow the stack.
 */
export function simplify(stroke: Stroke, tolerance = 1): Stroke {
  if (stroke.length <= 2) return [...stroke];

  const keep = new Array<boolean>(stroke.length).fill(false);
  keep[0] = true;
  keep[stroke.length - 1] = true;

  const stack: Array<[number, number]> = [[0, stroke.length - 1]];

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;

    let furthest = -1;
    let distance = tolerance;

    for (let index = first + 1; index < last; index++) {
      const candidate = perpendicularDistance(stroke[index], stroke[first], stroke[last]);
      if (candidate > distance) {
        distance = candidate;
        furthest = index;
      }
    }

    if (furthest !== -1) {
      keep[furthest] = true;
      stack.push([first, furthest], [furthest, last]);
    }
  }

  return stroke.filter((_, index) => keep[index]);
}

function perpendicularDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  // A zero-length segment: fall back to plain distance from the point.
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);

  const area = Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x);
  return area / Math.hypot(dx, dy);
}

/**
 * Turn strokes into SVG path data, smoothed.
 *
 * Straight lines between samples look like handwriting drawn with a ruler, so
 * each pair of points is joined through the midpoint with a quadratic curve —
 * the standard trick, and enough to make a mouse-drawn signature look drawn
 * rather than plotted.
 */
export function toPathData(strokes: readonly Stroke[]): string {
  const parts: string[] = [];

  for (const stroke of strokes) {
    if (stroke.length === 0) continue;

    if (stroke.length === 1) {
      // A dot: a tiny closed arc, or it would be invisible.
      const { x, y } = stroke[0];
      parts.push(`M ${round(x - 0.01)} ${round(y)} a 0.01 0.01 0 1 0 0.02 0 a 0.01 0.01 0 1 0 -0.02 0`);
      continue;
    }

    parts.push(`M ${round(stroke[0].x)} ${round(stroke[0].y)}`);

    for (let index = 1; index < stroke.length - 1; index++) {
      const current = stroke[index];
      const next = stroke[index + 1];
      const midX = (current.x + next.x) / 2;
      const midY = (current.y + next.y) / 2;
      parts.push(`Q ${round(current.x)} ${round(current.y)} ${round(midX)} ${round(midY)}`);
    }

    const last = stroke[stroke.length - 1];
    parts.push(`L ${round(last.x)} ${round(last.y)}`);
  }

  return parts.join(' ');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Total points, for deciding whether simplification is worth reporting. */
export function countPoints(strokes: readonly Stroke[]): number {
  return strokes.reduce((total, stroke) => total + stroke.length, 0);
}
