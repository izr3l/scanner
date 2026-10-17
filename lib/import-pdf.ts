import type { PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';
import { MAX_IMAGE_EDGE, MAX_IMPORT_BYTES } from './cv/geometry';
import { DEFAULT_RECIPE, type ScanPage } from './types';

export const MAX_SESSION_PAGES = 40;
export const MAX_PDF_PAGE_PIXELS = 12_000_000;
const PDF_RENDER_SCALE = 200 / 72;

export interface PdfImportOptions {
  maxPages?: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

/** Check bytes before loading the PDF parser, regardless of the supplied filename. */
export async function validatePdf(file: Blob): Promise<void> {
  if (!file.size || file.size > MAX_IMPORT_BYTES) throw new Error('Choose a PDF smaller than 32 MB.');
  const header = await file.slice(0, 8).text();
  if (!/^%PDF-\d\.\d/.test(header)) throw new Error('Choose a valid PDF file. Its contents do not match a PDF document.');
  if (file.type && file.type !== 'application/pdf' && file.type !== 'application/octet-stream') throw new Error('The PDF content does not match its file type.');
}

/** Preserve a complete PDF page while keeping its canvas and decoded image bounded. */
export function pdfRasterSize(width: number, height: number): { width: number; height: number; scale: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !Number.isFinite(width * height)) throw new Error('This PDF has an invalid or excessively large page size.');
  const scale = Math.min(PDF_RENDER_SCALE, Math.sqrt(MAX_PDF_PAGE_PIXELS / (width * height)), MAX_IMAGE_EDGE / width, MAX_IMAGE_EDGE / height);
  const rasterWidth = Math.floor(width * scale), rasterHeight = Math.floor(height * scale);
  if (rasterWidth < 2 || rasterHeight < 2) throw new Error('This PDF has an invalid or excessively narrow page size.');
  return { width: rasterWidth, height: rasterHeight, scale };
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError');
}

function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('This browser could not create an image from the PDF page.')), 'image/png'));
}

/** Import only newly rendered pixels. PDF metadata, text, attachments, and links are discarded. */
export async function importPdf(file: Blob, options: PdfImportOptions = {}): Promise<ScanPage[]> {
  const { signal, onProgress } = options;
  checkCancelled(signal);
  await validatePdf(file);
  checkCancelled(signal);
  const maxPages = Math.min(MAX_SESSION_PAGES, Math.max(0, Math.floor(options.maxPages ?? MAX_SESSION_PAGES)));
  if (!maxPages) throw new Error('This session is full. Export or remove pages before importing another document.');
  const pdfjs = await import('pdfjs-dist');
  checkCancelled(signal);
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf/pdf.worker.min.mjs';
  let loadingTask: PDFDocumentLoadingTask | undefined;
  let renderTask: RenderTask | undefined;
  let destroyed: Promise<void> | undefined;
  let encrypted = false;
  let interrupt: (reason: Error) => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, reject) => { interrupt = reject; });
  const destroy = () => destroyed ??= loadingTask?.destroy().catch(() => undefined) ?? Promise.resolve();
  const cancel = () => { interrupt(new DOMException('Import cancelled.', 'AbortError')); renderTask?.cancel(); void destroy(); };
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    checkCancelled(signal);
    loadingTask = pdfjs.getDocument({
      data,
      cMapUrl: '/pdf/cmaps/', cMapPacked: true,
      standardFontDataUrl: '/pdf/standard_fonts/', wasmUrl: '/pdf/wasm/',
      // PDF.js 6 removed its dynamic-evaluation option; fonts use its built-in path renderer.
      disableFontFace: true, useSystemFonts: false,
      disableAutoFetch: true, disableStream: true, stopAtErrors: true,
      canvasMaxAreaInBytes: MAX_PDF_PAGE_PIXELS * 4,
    });
    loadingTask.onPassword = () => { encrypted = true; interrupt(new Error('This PDF requires a password.')); void destroy(); };
    signal?.addEventListener('abort', cancel, { once: true });
    checkCancelled(signal);
    const pdf = await Promise.race([loadingTask.promise, interrupted]);
    checkCancelled(signal);
    if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1) throw new Error('This PDF has no readable pages.');
    if (pdf.numPages > maxPages) throw new Error(`This PDF has ${pdf.numPages} pages. There is room for ${maxPages} more ${maxPages === 1 ? 'page' : 'pages'} in this session (40 total).`);
    const pages: ScanPage[] = [];
    onProgress?.(0, pdf.numPages);
    for (let index = 1; index <= pdf.numPages; index++) {
      checkCancelled(signal);
      const page = await pdf.getPage(index);
      const canvas = document.createElement('canvas');
      try {
        checkCancelled(signal);
        const natural = page.getViewport({ scale: 1 });
        const size = pdfRasterSize(natural.width, natural.height);
        canvas.width = size.width; canvas.height = size.height;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('This browser could not open an image canvas for the PDF.');
        renderTask = page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale: size.scale }), background: '#ffffff', annotationMode: pdfjs.AnnotationMode.ENABLE });
        await renderTask.promise;
        renderTask = undefined;
        checkCancelled(signal);
        const original = await pngBlob(canvas);
        checkCancelled(signal);
        pages.push({
          id: crypto.randomUUID(), type: pdf.numPages > 1 ? 'batch' : 'document', createdAt: Date.now(),
          original, width: size.width, height: size.height,
          corners: [{ x: 0, y: 0 }, { x: size.width - 1, y: 0 }, { x: size.width - 1, y: size.height - 1 }, { x: 0, y: size.height - 1 }],
          recipe: { ...DEFAULT_RECIPE, filter: 'document' }, redactions: [],
        });
        onProgress?.(index, pdf.numPages);
      } finally {
        renderTask?.cancel(); renderTask = undefined;
        canvas.width = 0; canvas.height = 0;
        page.cleanup();
      }
    }
    return pages;
  } catch (reason) {
    checkCancelled(signal);
    if (encrypted || reason instanceof Error && reason.name === 'PasswordException') throw new Error('Password-protected PDFs cannot be imported. Save an unlocked copy and try again.');
    if (reason instanceof Error && ['InvalidPDFException', 'UnknownErrorException', 'FormatError'].includes(reason.name)) throw new Error('This PDF is damaged or unsupported. Try saving a new copy before importing it.');
    throw reason;
  } finally {
    signal?.removeEventListener('abort', cancel);
    await destroy();
  }
}
