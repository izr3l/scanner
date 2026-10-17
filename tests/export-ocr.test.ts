import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OcrPage } from '../lib/ocr/types';
import { DEFAULT_ARRANGEMENT, DEFAULT_RECIPE, type ExportOptions, type ScanPage } from '../lib/types';
import { mmToPixels } from '../lib/presets';

const mocked = vi.hoisted(() => ({
  events: [] as string[],
  recognize: vi.fn(),
  terminate: vi.fn(),
  createEngine: vi.fn(),
  watermark: vi.fn(),
  redactions: vi.fn(),
  pdf: vi.fn(),
  canvases: [] as { width: number; height: number }[],
}));

vi.mock('../lib/cv/client', () => ({ renderPage: vi.fn(async (page: ScanPage) => { mocked.events.push(`render:${page.id}`); return new Blob(['flattened-edits']); }) }));
vi.mock('../lib/export/watermark', () => ({ drawWatermark: mocked.watermark }));
vi.mock('../lib/export/redact', () => ({ burnRedactions: mocked.redactions }));
vi.mock('../lib/ocr/client', () => ({ createOcrEngine: mocked.createEngine }));
vi.mock('../lib/export/pdf', () => ({ createPdfExport: mocked.pdf }));
vi.mock('../lib/export/strip', () => ({
  makeCanvas: (width: number, height: number) => {
    const canvas = { width: Math.round(width), height: Math.round(height) };
    mocked.canvases.push(canvas);
    return canvas;
  },
  canvasContext: () => ({ drawImage: () => mocked.events.push('draw'), fillRect() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {} }),
  canvasBlob: async () => { mocked.events.push('encode-final-pixels'); return new Blob(['redacted-arranged-sheet']); },
  loadPixels: async () => ({ source: {}, width: 1000, height: 1400, release() {} }),
  releaseCanvas: (canvas: { width: number; height: number }) => { canvas.width = 0; canvas.height = 0; },
}));

import { createExport, normalizeOcrText, ocrPageText, recognizeExport } from '../lib/export';

const options: ExportOptions = { format: 'pdf', dpi: 150, quality: 0.9, filename: '', watermark: 'PRIVATE', pdfMode: 'searchable', ocrLanguage: 'fra', arrangement: { ...DEFAULT_ARRANGEMENT } };
function page(id: string): ScanPage {
  return { id, type: 'document', createdAt: 0, original: new Blob(['private-source-container']), width: 1000, height: 1400, corners: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1400 }, { x: 0, y: 1400 }], recipe: { ...DEFAULT_RECIPE }, redactions: [{ id: 'secret', x: 0.1, y: 0.1, width: 0.2, height: 0.2 }] };
}
const result: OcrPage = { text: 'Reviewed words', confidence: 88, width: 500, height: 700, words: [{ text: 'Reviewed', confidence: 88, bbox: { x0: 20, y0: 30, x1: 120, y1: 50 } }] };

beforeEach(() => {
  vi.clearAllMocks();
  mocked.events.length = 0;
  mocked.canvases.length = 0;
  mocked.redactions.mockImplementation(() => mocked.events.push('burn-redactions'));
  mocked.recognize.mockImplementation(async () => { mocked.events.push('recognize'); return result; });
  mocked.terminate.mockResolvedValue(undefined);
  mocked.createEngine.mockResolvedValue({ recognize: mocked.recognize, terminate: mocked.terminate });
  mocked.pdf.mockResolvedValue({ blob: new Blob(['fresh-pdf'], { type: 'application/pdf' }), pageCount: 2 });
});

describe('recognition of safe arranged exports', () => {
  it('burns security edits before OCR, excludes watermarks, rescales word coordinates, and releases resources', async () => {
    const progress = vi.fn();
    const recognized = await recognizeExport([page('one'), page('two')], options, progress);
    expect(mocked.createEngine).toHaveBeenCalledWith('fra', expect.any(Function), undefined);
    expect(mocked.events.indexOf('burn-redactions')).toBeLessThan(mocked.events.indexOf('encode-final-pixels'));
    expect(mocked.events.indexOf('encode-final-pixels')).toBeLessThan(mocked.events.indexOf('recognize'));
    expect(mocked.watermark).not.toHaveBeenCalled();
    expect(await mocked.recognize.mock.calls[0][0].text()).toBe('redacted-arranged-sheet');
    expect(recognized[0].width).toBe(mmToPixels(210, 150));
    expect(recognized[0].height).toBe(mmToPixels(297, 150));
    expect(recognized[0].words[0].bbox.x0).toBeCloseTo(20 * mmToPixels(210, 150) / 500);
    expect(progress).toHaveBeenLastCalledWith({ page: 2, total: 2, status: 'Page ready for review', progress: 1 });
    expect(mocked.terminate).toHaveBeenCalledTimes(1);
    expect(mocked.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
  });

  it('terminates the worker after a failed page and does not recognize later pages', async () => {
    mocked.recognize.mockRejectedValueOnce(new Error('Recognition failed'));
    await expect(recognizeExport([page('one'), page('two')], options)).rejects.toThrow('Recognition failed');
    expect(mocked.recognize).toHaveBeenCalledTimes(1);
    expect(mocked.terminate).toHaveBeenCalledTimes(1);
  });

  it('cancels between pages without returning partial recognized text', async () => {
    const controller = new AbortController();
    mocked.recognize.mockImplementationOnce(async () => { controller.abort(); return result; });
    await expect(recognizeExport([page('one'), page('two')], options, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocked.recognize).toHaveBeenCalledTimes(1);
    expect(mocked.terminate).toHaveBeenCalledTimes(1);
  });

  it('requires fresh complete OCR before export and does not run recognition again', async () => {
    await expect(createExport([page('one')], options)).rejects.toThrow('every page');
    await expect(createExport([page('one')], options, [result])).rejects.toThrow('layout changed');
    const recognized = { ...result, width: mmToPixels(210, 150), height: mmToPixels(297, 150) };
    const exported = await createExport([page('one')], { ...options, pdfMode: 'text' }, [recognized]);
    expect(exported.pageCount).toBe(2);
    expect(mocked.recognize).not.toHaveBeenCalled();
    expect(mocked.pdf.mock.calls[0][0][0].blob.size).toBe(0);
    expect(mocked.pdf.mock.calls[0][1]).toMatchObject({ mode: 'text', ocrPages: [recognized], watermark: 'PRIVATE' });
  });

  it('keeps Unicode and page breaks while removing hidden review controls', () => {
    expect(normalizeOcrText('Cafe\u0301\r\nfrançais\u0000\u202e')).toBe('Café\nfrançais');
    expect(ocrPageText({ ...result, text: '' })).toBe('');
  });
});
