import { useCallback, useEffect, useRef, useState } from 'react';

import { boundsOf, countPoints, isEmpty, simplify, toPathData, trim, type Stroke } from '../lib/strokes';

/**
 * Draw a signature.
 *
 * Pointer events rather than mouse or touch events, so a stylus, a finger and a
 * trackpad all take the same path — and `setPointerCapture`, so a stroke that
 * leaves the pad keeps drawing instead of stopping dead at the edge, which is
 * what makes a signature come out chopped.
 *
 * The strokes are rendered as an SVG path while drawing, and only turned into
 * pixels when the signature is accepted — at a size chosen for the page rather
 * than the size of the pad.
 */
export function SignaturePad({
  onAccept,
  onCancel,
}: {
  onAccept: (result: { bytes: ArrayBuffer; aspect: number }) => void;
  onCancel: () => void;
}) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [drawing, setDrawing] = useState(false);
  const surfaceRef = useRef<SVGSVGElement>(null);

  const pointFrom = useCallback((event: React.PointerEvent) => {
    const rect = surfaceRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  function start(event: React.PointerEvent) {
    // Keeps receiving moves even when the pointer leaves the element, so a
    // stroke that runs off the edge is not cut short.
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrawing(true);
    setStrokes((current) => [...current, [pointFrom(event)]]);
  }

  function extend(event: React.PointerEvent) {
    if (!drawing) return;
    const point = pointFrom(event);
    setStrokes((current) => {
      const next = [...current];
      next[next.length - 1] = [...next[next.length - 1], point];
      return next;
    });
  }

  function end() {
    setDrawing(false);
  }

  const clear = () => setStrokes([]);

  const accept = useCallback(async () => {
    if (isEmpty(strokes)) return;

    // Simplify first: a slow signature arrives as thousands of points and the
    // extra ones make no visible difference.
    const simplified = strokes.map((stroke) => simplify(stroke, 0.7)).filter((stroke) => stroke.length > 0);
    const strokeWidth = 2.4;
    const trimmed = trim(simplified, strokeWidth * 2);
    if (trimmed.width <= 0 || trimmed.height <= 0) return;

    // Rendered well above the size it will be placed at, so it stays crisp when
    // the page is printed or zoomed.
    const scale = Math.min(1600 / trimmed.width, 8);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(trimmed.width * scale));
    canvas.height = Math.max(1, Math.round(trimmed.height * scale));

    const context = canvas.getContext('2d')!;
    context.scale(scale, scale);
    context.strokeStyle = '#0f172a';
    context.lineWidth = strokeWidth;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    const path = new Path2D(toPathData(trimmed.strokes));
    context.stroke(path);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;

    onAccept({ bytes: await blob.arrayBuffer(), aspect: canvas.width / canvas.height });
  }, [strokes, onAccept]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const bounds = boundsOf(strokes);
  const path = toPathData(strokes);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-5">
      <div className="panel w-full max-w-2xl p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Draw your signature</h2>
          <span className="text-xs text-ink-faint">
            {bounds ? `${countPoints(strokes)} points` : 'Use a finger, stylus or trackpad'}
          </span>
        </div>

        <svg
          ref={surfaceRef}
          onPointerDown={start}
          onPointerMove={extend}
          onPointerUp={end}
          onPointerCancel={end}
          role="application"
          aria-label="Signature drawing area"
          className="h-56 w-full touch-none rounded-lg border-2 border-dashed border-line-strong bg-raised"
        >
          {/* A line to sign on, like a paper form. */}
          <line x1="6%" y1="76%" x2="94%" y2="76%" stroke="currentColor" className="text-line-strong" strokeWidth="1" />
          <path d={path} fill="none" stroke="#0f172a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={accept}
            disabled={isEmpty(strokes)}
            className="tap cursor-pointer rounded-lg bg-accent px-5 text-sm font-semibold text-on-accent transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Use this signature
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={isEmpty(strokes)}
            className="tap cursor-pointer rounded-lg border border-line bg-raised px-4 text-sm transition-colors hover:border-line-strong disabled:opacity-40"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="tap cursor-pointer rounded-lg px-4 text-sm text-ink-muted transition-colors hover:text-ink"
          >
            Cancel
          </button>
          <p className="ml-auto text-xs text-ink-faint">Nothing leaves this device.</p>
        </div>
      </div>
    </div>
  );
}
