import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importPdf, MAX_PDF_PAGE_PIXELS, pdfRasterSize, validatePdf } from '../lib/import-pdf';

const pdfjs = vi.hoisted(() => ({ getDocument: vi.fn(), GlobalWorkerOptions: { workerSrc: '' }, AnnotationMode: { ENABLE: 1 } }));
vi.mock('pdfjs-dist', () => pdfjs);

function file(type = 'application/pdf') { return new Blob(['%PDF-1.7\nsynthetic'], { type }); }

function documentFixture(count = 2) {
  const canvases: { width: number; height: number; toBlob: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal('document', { createElement: vi.fn(() => {
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => ({})), toBlob: vi.fn((done: BlobCallback) => done(new Blob(['fresh-page-pixels'], { type: 'image/png' }))) };
    canvases.push(canvas);
    return canvas;
  }) });
  const page = { getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale })), render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })), cleanup: vi.fn() };
  const pdf = { numPages: count, getPage: vi.fn<(index: number) => Promise<typeof page>>(async () => page) };
  const task = { promise: Promise.resolve(pdf), destroy: vi.fn(async () => undefined), onPassword: undefined as undefined | (() => void) };
  pdfjs.getDocument.mockReturnValue(task);
  return { canvases, page, pdf, task };
}

beforeEach(() => { pdfjs.getDocument.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('PDF input validation and raster limits', () => {
  it('checks a PDF signature independently of its filename', async () => {
    await expect(validatePdf(file())).resolves.toBeUndefined();
    await expect(validatePdf(file('application/octet-stream'))).resolves.toBeUndefined();
    await expect(validatePdf(file(''))).resolves.toBeUndefined();
    await expect(validatePdf(new Blob(['not a PDF'], { type: 'application/pdf' }))).rejects.toThrow('valid PDF');
    await expect(validatePdf(file('image/png'))).rejects.toThrow('does not match its file type');
  });

  it('rejects empty or oversized files before reading their bytes', async () => {
    const read = vi.fn();
    await expect(validatePdf(new Blob([]))).rejects.toThrow('32 MB');
    await expect(validatePdf({ size: 32 * 1024 * 1024 + 1, slice: read } as unknown as Blob)).rejects.toThrow('32 MB');
    expect(read).not.toHaveBeenCalled();
  });

  it('renders normal pages near 200 dpi and constrains large pages to 12 megapixels and 16,384 pixels per edge', () => {
    const letter = pdfRasterSize(612, 792);
    expect(letter.width).toBe(1700);
    expect(letter.height).toBe(2200);
    for (const [width, height] of [[3000, 4000], [100_000, 1000], [1000, 100_000]]) {
      const result = pdfRasterSize(width, height);
      expect(result.width * result.height).toBeLessThanOrEqual(MAX_PDF_PAGE_PIXELS);
      expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(16_384);
      expect(Math.abs(result.width / result.height - width / height)).toBeLessThan(0.7);
    }
  });

  it('rejects invalid page dimensions instead of allocating a canvas', () => {
    for (const [width, height] of [[0, 100], [NaN, 100], [100, Infinity], [-1, 100], [1e20, 1]]) expect(() => pdfRasterSize(width, height)).toThrow('page size');
  });
});

describe('atomic raster-only PDF import', () => {
  it('renders every page in order with full-page corners and releases resources', async () => {
    const { canvases, page, pdf, task } = documentFixture();
    const onProgress = vi.fn();
    const pages = await importPdf(file(), { onProgress });
    expect(pages).toHaveLength(2);
    expect(pdf.getPage.mock.calls.map(([index]) => index)).toEqual([1, 2]);
    expect(pages[0].corners).toEqual([{ x: 0, y: 0 }, { x: 1699, y: 0 }, { x: 1699, y: 2199 }, { x: 0, y: 2199 }]);
    expect(pages[0].recipe.filter).toBe('document');
    expect(pages[0].type).toBe('batch');
    expect(pages[0].original.type).toBe('image/png');
    expect(await pages[0].original.text()).toBe('fresh-page-pixels');
    expect(pages[0]).not.toHaveProperty('text');
    expect(pages[0]).not.toHaveProperty('metadata');
    expect(onProgress.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]]);
    expect(page.cleanup).toHaveBeenCalledTimes(2);
    expect(task.destroy).toHaveBeenCalledTimes(1);
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
    expect(pdfjs.getDocument).toHaveBeenCalledWith(expect.objectContaining({ disableFontFace: true, useSystemFonts: false, cMapUrl: '/pdf/cmaps/', standardFontDataUrl: '/pdf/standard_fonts/', wasmUrl: '/pdf/wasm/' }));
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe('/pdf/pdf.worker.min.mjs');
  });

  it('checks the remaining session capacity before rendering any pages', async () => {
    const { pdf, task, canvases } = documentFixture(3);
    await expect(importPdf(file(), { maxPages: 2 })).rejects.toThrow('room for 2 more pages');
    expect(pdf.getPage).not.toHaveBeenCalled();
    expect(canvases).toHaveLength(0);
    expect(task.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects a later page failure without returning any partial document and still releases the canvas', async () => {
    const { pdf, page, task, canvases } = documentFixture(2);
    pdf.getPage.mockResolvedValueOnce(page).mockRejectedValueOnce(new Error('Unreadable page.'));
    await expect(importPdf(file())).rejects.toThrow('Unreadable page.');
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
    expect(task.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects a cancelled import before loading the parser', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(importPdf(file(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(pdfjs.getDocument).not.toHaveBeenCalled();
  });

  it('cancels rendering and destroys the PDF worker when aborted', async () => {
    const controller = new AbortController();
    const { page, task, canvases } = documentFixture(1);
    const cancel = vi.fn();
    const pendingRender = new Promise<void>((_resolve, reject) => { cancel.mockImplementation(() => reject(new Error('Rendering cancelled.'))); });
    page.render.mockImplementation(() => { queueMicrotask(() => controller.abort()); return { promise: pendingRender, cancel }; });
    await expect(importPdf(file(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalled();
    expect(task.destroy).toHaveBeenCalledTimes(1);
    expect(page.cleanup).toHaveBeenCalledTimes(1);
    expect(canvases[0].width).toBe(0);
  });

  it('cancels while loading even if the PDF library leaves its loading promise pending', async () => {
    const controller = new AbortController();
    const { task } = documentFixture(1);
    pdfjs.getDocument.mockImplementation(() => {
      task.promise = new Promise(() => undefined);
      queueMicrotask(() => controller.abort());
      return task;
    });
    await expect(importPdf(file(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(task.destroy).toHaveBeenCalledTimes(1);
  });

  it('explains malformed PDFs and password protection', async () => {
    const { task } = documentFixture(1);
    const reason = new Error('Invalid structure'); reason.name = 'InvalidPDFException';
    task.promise = Promise.reject(reason);
    await expect(importPdf(file())).rejects.toThrow('damaged or unsupported');
    pdfjs.getDocument.mockImplementation(() => {
      const encryptedTask = { promise: new Promise(() => undefined), destroy: vi.fn(async () => undefined), onPassword: undefined as undefined | (() => void) };
      queueMicrotask(() => encryptedTask.onPassword?.());
      return encryptedTask;
    });
    await expect(importPdf(file())).rejects.toThrow('Password-protected PDFs cannot be imported');
  });
});
