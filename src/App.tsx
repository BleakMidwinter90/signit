import { useCallback, useEffect, useRef, useState } from 'react';

import { SignaturePad } from './components/SignaturePad';
import { applyStamps, isPdf, readDocument, type Stamp } from './lib/pdf';
import { release, urlFor } from './lib/objectUrl';
import { clampToPage } from './lib/placement';
import { openDocument, type OpenDocument } from './lib/viewer';

interface Placed {
  id: string;
  page: number;
  at: { x: number; y: number };
  width: number;
  aspect: number;
  bytes: ArrayBuffer;
  label: string;
}

let counter = 0;

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [doc, setDoc] = useState<OpenDocument | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [signature, setSignature] = useState<{ bytes: ArrayBuffer; aspect: number } | null>(null);
  const [padOpen, setPadOpen] = useState(false);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);

  const pageRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);

  const openFile = useCallback(async (chosen: File) => {
    setError(null);
    setBusy(true);

    try {
      const buffer = await chosen.arrayBuffer();
      const info = await readDocument(buffer);
      const opened = await openDocument(buffer);

      setFile(chosen);
      setBytes(buffer);
      setDoc((previous) => {
        void previous?.destroy();
        return opened;
      });
      setPageCount(info.pageCount);
      setPageNumber(1);
      setPlaced([]);
    } catch {
      setError('That file could not be opened. If it is password protected, it needs unlocking first.');
    } finally {
      setBusy(false);
    }
  }, []);

  // Draw the current page whenever it, or the document, changes.
  useEffect(() => {
    if (!doc || !canvasHostRef.current) return;
    let cancelled = false;

    const host = canvasHostRef.current;
    const width = Math.min(host.clientWidth || 720, 900);

    void doc
      .render(pageNumber, width)
      .then(({ canvas }) => {
        if (cancelled) return;
        canvas.className = 'block w-full h-auto';
        host.replaceChildren(canvas);
      })
      .catch(() => {
        if (!cancelled) setError('That page could not be drawn.');
      });

    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber]);

  useEffect(() => {
    return () => {
      void doc?.destroy();
    };
  }, [doc]);

  function placeSignature(event: React.MouseEvent) {
    if (!signature || dragging) return;

    const rect = pageRef.current!.getBoundingClientRect();
    const width = 0.28;
    const height = width / signature.aspect / (rect.height / rect.width);

    // Dropped centred on the click, which is where someone expects it, then
    // kept on the page.
    const at = clampToPage(
      {
        x: (event.clientX - rect.left) / rect.width - width / 2,
        y: (event.clientY - rect.top) / rect.height - height / 2,
      },
      { width, height },
    );

    setPlaced((current) => [
      ...current,
      {
        id: `stamp-${++counter}`,
        page: pageNumber - 1,
        at,
        width,
        aspect: signature.aspect,
        bytes: signature.bytes,
        label: `Signature on page ${pageNumber}`,
      },
    ]);
  }

  function dragTo(event: React.MouseEvent, id: string) {
    const rect = pageRef.current!.getBoundingClientRect();
    setPlaced((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const height = item.width / item.aspect / (rect.height / rect.width);
        return {
          ...item,
          at: clampToPage(
            {
              x: (event.clientX - rect.left) / rect.width - item.width / 2,
              y: (event.clientY - rect.top) / rect.height - height / 2,
            },
            { width: item.width, height },
          ),
        };
      }),
    );
  }

  const download = useCallback(async () => {
    if (!bytes || !file) return;
    setBusy(true);

    try {
      const stamps: Stamp[] = placed.map((item) => ({
        kind: 'image',
        page: item.page,
        at: item.at,
        width: item.width,
        bytes: item.bytes,
        aspect: item.aspect,
      }));

      const blob = await applyStamps(bytes, stamps);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = file.name.replace(/\.pdf$/i, '') + ' (signed).pdf';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('The signed file could not be written.');
    } finally {
      setBusy(false);
    }
  }, [bytes, file, placed]);

  const onThisPage = placed.filter((item) => item.page === pageNumber - 1);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">signit</h1>
          <p className="mt-1.5 max-w-lg text-pretty text-sm text-ink-muted">
            Sign a PDF without sending it anywhere. The contract, the tenancy agreement, the
            passport scan — all of it stays on this device.
          </p>
        </div>

        {file && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPadOpen(true)}
              className="tap cursor-pointer rounded-lg border border-line bg-raised px-4 text-sm transition-colors hover:border-line-strong"
            >
              {signature ? 'Redraw signature' : 'Draw signature'}
            </button>
            <button
              type="button"
              onClick={download}
              disabled={busy || placed.length === 0}
              className="tap cursor-pointer rounded-lg bg-accent px-5 text-sm font-semibold text-on-accent transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Writing…' : 'Download signed PDF'}
            </button>
          </div>
        )}
      </header>

      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
          {error}
        </p>
      )}

      {!file ? (
        <label className="tap flex flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line-strong bg-surface px-6 py-24 text-center transition-colors hover:border-accent">
          <span aria-hidden className="text-2xl text-ink-faint">
            [ + ]
          </span>
          <span className="text-lg font-medium">Choose a PDF, or drop it here</span>
          <span className="max-w-sm text-sm text-ink-muted">
            Nothing is uploaded. The file is opened in this tab and never sent anywhere.
          </span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen && isPdf(chosen)) void openFile(chosen);
              event.target.value = '';
            }}
          />
        </label>
      ) : (
        <div className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-ink-muted">
                {file.name} · page {pageNumber} of {pageCount}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
                  disabled={pageNumber <= 1}
                  className="cursor-pointer rounded-md border border-line bg-raised px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
                  disabled={pageNumber >= pageCount}
                  className="cursor-pointer rounded-md border border-line bg-raised px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>

            <div
              ref={pageRef}
              onClick={placeSignature}
              className={`sheet relative mx-auto w-full overflow-hidden rounded ${
                signature ? 'cursor-crosshair' : ''
              }`}
            >
              <div ref={canvasHostRef} data-testid="page-canvas" />

              {onThisPage.map((item) => (
                <img
                  key={item.id}
                  src={urlFor(item.bytes)}
                  alt={item.label}
                  draggable={false}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    setDragging(item.id);
                  }}
                  onMouseMove={(event) => {
                    if (dragging === item.id) dragTo(event, item.id);
                  }}
                  onMouseUp={() => setDragging(null)}
                  style={{
                    left: `${item.at.x * 100}%`,
                    top: `${item.at.y * 100}%`,
                    width: `${item.width * 100}%`,
                  }}
                  className="absolute cursor-move select-none outline-2 outline-dashed outline-accent/40"
                />
              ))}
            </div>
          </div>

          <aside className="space-y-4">
            <div className="panel p-4">
              <h2 className="eyebrow mb-2">Signature</h2>
              {signature ? (
                <>
                  <img
                    src={urlFor(signature.bytes)}
                    alt="Your signature"
                    className="w-full rounded border border-line bg-raised p-2"
                  />
                  <p className="mt-2 text-xs text-ink-muted">
                    Click the page to place it. Drag to move.
                  </p>
                </>
              ) : (
                <p className="text-xs text-ink-muted">
                  Draw one, then click where it should go on the page.
                </p>
              )}
            </div>

            <div className="panel p-4">
              <h2 className="eyebrow mb-2">Placed ({placed.length})</h2>
              {placed.length === 0 ? (
                <p className="text-xs text-ink-faint">Nothing placed yet.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {placed.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setPageNumber(item.page + 1)}
                        className="cursor-pointer truncate text-left text-ink-muted hover:text-ink"
                      >
                        Page {item.page + 1}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setPlaced((current) => {
                            const remaining = current.filter((entry) => entry.id !== item.id);
                            // Only release once no placement and no pad preview
                            // still points at these bytes.
                            const stillUsed =
                              remaining.some((entry) => entry.bytes === item.bytes) ||
                              signature?.bytes === item.bytes;
                            if (!stillUsed) release(item.bytes);
                            return remaining;
                          })
                        }
                        aria-label={`Remove signature from page ${item.page + 1}`}
                        className="cursor-pointer rounded px-2 text-ink-faint hover:text-warn"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}

      {padOpen && (
        <SignaturePad
          onAccept={(result) => {
            setSignature(result);
            setPadOpen(false);
          }}
          onCancel={() => setPadOpen(false)}
        />
      )}

      <footer className="mt-10 border-t border-line pt-5 text-xs text-ink-faint">
        <p className="max-w-xl text-pretty">
          The signature becomes part of the page rather than an annotation, so a reader cannot drag
          it off or delete it. Nothing is uploaded — there is no server to upload to.
        </p>
        <p className="mt-2 flex flex-wrap gap-x-4">
          <a
            href="https://github.com/BleakMidwinter90/signit"
            className="underline decoration-line-strong underline-offset-4 hover:text-ink"
          >
            Source on GitHub
          </a>
          <span>MIT licensed</span>
        </p>
      </footer>
    </div>
  );
}
