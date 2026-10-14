import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { createPdf } from '../lib/export/pdf';
import { mmToPoints } from '../lib/presets';

// A clean one-pixel PNG lets the test inspect the actual PDF container without DOM mocks.
const png = new Blob([Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))], { type: 'image/png' });

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
