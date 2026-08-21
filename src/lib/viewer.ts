/**
 * Rendering pages to pixels, with pdf.js.
 *
 * pdf-lib manipulates structure and never draws anything, so showing someone
 * the page they are signing needs the other library.
 */

export interface RenderedPage {
  canvas: HTMLCanvasElement;
  /** CSS pixels, before device pixel ratio. */
  width: number;
  height: number;
}

let pdfjs: typeof import('pdfjs-dist') | null = null;

async function library() {
  if (pdfjs) return pdfjs;

  pdfjs = await import('pdfjs-dist');

  /*
   * Vite resolves this specifier at build time and emits the worker as its own
   * hashed asset, so it stays out of the main bundle.
   *
   * Worth knowing if this ever looks broken: with no worker, pdf.js silently
   * decodes on the main thread instead of failing. The output is identical, so
   * nothing that checks the rendered pixels can tell the difference — the thing
   * to assert is that a dedicated worker was spawned.
   */
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).href;

  return pdfjs;
}

export interface OpenDocument {
  pageCount: number;
  render: (pageNumber: number, targetWidth: number) => Promise<RenderedPage>;
  destroy: () => Promise<void>;
}

/**
 * Open a document for viewing.
 *
 * The bytes are copied first: pdf.js takes ownership of the buffer it is given
 * and detaches it, which leaves the same ArrayBuffer unusable for the pdf-lib
 * pass that writes the signature — a genuinely confusing failure, because the
 * file opens fine and only saving breaks.
 */
export async function openDocument(bytes: ArrayBuffer): Promise<OpenDocument> {
  const library_ = await library();
  const task = library_.getDocument({ data: bytes.slice(0) });
  const document = await task.promise;

  return {
    pageCount: document.numPages,

    async render(pageNumber, targetWidth) {
      const page = await document.getPage(pageNumber);

      // getViewport applies the page's /Rotate, so what comes back is the page
      // as a reader sees it.
      const base = page.getViewport({ scale: 1 });
      const scale = targetWidth / base.width;
      const viewport = page.getViewport({ scale });

      // Render above CSS size so the page is sharp on a retina display.
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.round(viewport.width * ratio);
      canvas.height = Math.round(viewport.height * ratio);

      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not get a drawing context');
      context.scale(ratio, ratio);

      await page.render({ canvas, canvasContext: context, viewport }).promise;
      page.cleanup();

      return { canvas, width: viewport.width, height: viewport.height };
    },

    async destroy() {
      // pdf.js keeps a worker and decoded page data alive until told otherwise.
      await task.destroy();
    },
  };
}
