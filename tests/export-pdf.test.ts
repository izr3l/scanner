import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { createPdf, createPdfExport } from '../lib/export/pdf';
import { mmToPoints } from '../lib/presets';
import type { OcrPage } from '../lib/ocr/types';

// A clean one-pixel PNG lets the test inspect the actual PDF container without DOM mocks.
const png = new Blob([Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))], { type: 'image/png' });
const sheet = { blob: png, width: 210, height: 297 };
const recognized: OcrPage = {
  text: 'Café français\nClear and readable.', confidence: 92, width: 1000, height: 1400,
  words: [{ text: 'Café', confidence: 92, bbox: { x0: 100, y0: 200, x1: 300, y1: 250 } }, { text: 'français', confidence: 91, bbox: { x0: 320, y0: 200, x1: 600, y1: 250 } }],
};

async function extractedPages(blob: Blob): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: false });
  const document = await task.promise;
  try {
    const text: string[] = [];
    for (let index = 1; index <= document.numPages; index++) {
      const content = await (await document.getPage(index)).getTextContent();
      text.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '));
    }
    return text;
  } finally { await task.destroy(); }
}

describe('fresh raster PDF encoding', () => {
  it('writes exact physical sizes and blank identification metadata', async () => {
    const blob = await createPdf([{ blob: png, width: 210, height: 297 }, { blob: png, width: 297, height: 210 }]);
    expect(blob.type).toBe('application/pdf');
    const pdf = await PDFDocument.load(await blob.arrayBuffer(), { updateMetadata: false });
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPage(0).getSize()).toEqual({ width: mmToPoints(210), height: mmToPoints(297) });
    expect(pdf.getPage(1).getSize()).toEqual({ width: mmToPoints(297), height: mmToPoints(210) });
    expect(pdf.getAuthor()).toBe('');
    expect(pdf.getCreator()).toBe('');
    expect(pdf.getProducer()).toBe('');
    expect(pdf.getCreationDate()).toBeUndefined();
    expect(pdf.getModificationDate()).toBeUndefined();
  });
});

describe('reviewed OCR PDF exports', () => {
  it('embeds invisible, selectable Unicode words aligned to the scan', async () => {
    const fontBytes = new Uint8Array(await readFile('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'));
    const blob = await createPdf([sheet], { mode: 'searchable', ocrPages: [recognized], fontBytes });
    expect(await extractedPages(blob)).toEqual(['Café français']);
    const pdf = await PDFDocument.load(await blob.arrayBuffer(), { updateMetadata: false });
    const streams = pdf.context.enumerateIndirectObjects().map(([, object]) => object).filter((object): object is PDFRawStream => object instanceof PDFRawStream);
    const operations = streams.filter((stream) => !stream.dict.get(PDFName.of('Subtype'))).map((stream) => {
      try { return new TextDecoder().decode(decodePDFRawStream(stream).decode()); }
      catch { return ''; }
    }).join('\n');
    expect(operations).toContain('3 Tr');
    expect(operations).toContain(`${mmToPoints(210) / 10} `);
    expect(pdf.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'))).toBeDefined();
    expect(pdf.getAuthor()).toBe('');
    expect(pdf.getCreationDate()).toBeUndefined();
  });

  it('rebuilds reviewed text without embedding images and preserves source page boundaries', async () => {
    const fontBytes = new Uint8Array(await readFile('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'));
    const reviewed = { ...recognized, text: 'Corrected Café français — 2026.' };
    const result = await createPdfExport([sheet, { ...sheet, width: 297, height: 210 }], { mode: 'text', ocrPages: [reviewed, { ...recognized, text: 'Second source page.' }], fontBytes });
    const text = await extractedPages(result.blob);
    expect(text).toEqual(['Corrected Café français — 2026.', 'Second source page.']);
    const pdf = await PDFDocument.load(await result.blob.arrayBuffer());
    expect(result.pageCount).toBe(2);
    expect(pdf.getPage(1).getSize()).toEqual({ width: mmToPoints(297), height: mmToPoints(210) });
    expect(pdf.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image')).toHaveLength(0);
  });

  it('wraps long lines and paginates rather than clipping recognized text', async () => {
    const fontBytes = new Uint8Array(await readFile('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'));
    const text = `${'A readable sentence with several words. '.repeat(500)}\nEND-OF-DOCUMENT`;
    const result = await createPdfExport([sheet], { mode: 'text', ocrPages: [{ ...recognized, text }], fontBytes });
    const extracted = await extractedPages(result.blob);
    expect(result.pageCount).toBeGreaterThan(1);
    expect(extracted.at(-1)).toContain('END-OF-DOCUMENT');
    expect(extracted.join(' ').match(/readable/g)).toHaveLength(500);
  });

  it('requires OCR for every sheet and reports characters the font cannot render', async () => {
    await expect(createPdf([sheet], { mode: 'searchable', ocrPages: [] })).rejects.toThrow('every page');
    const fontBytes = new Uint8Array(await readFile('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'));
    await expect(createPdf([sheet], { mode: 'text', ocrPages: [{ ...recognized, text: '文' }], fontBytes })).rejects.toThrow('cannot display');
  });
});
