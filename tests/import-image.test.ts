import { describe, expect, it } from 'vitest';
import { validateImage } from '../lib/import-image';

function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = 2;
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(23);
  bytes.set([255, 216, 255, 192, 0, 17, 8]);
  const view = new DataView(bytes.buffer);
  view.setUint16(7, height);
  view.setUint16(9, width);
  bytes.set([3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217], 11);
  return bytes;
}

function webp(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(30);
  bytes.set([82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 88, 10, 0, 0, 0]);
  for (let i = 0; i < 3; i++) { bytes[24 + i] = ((width - 1) >>> (8 * i)) & 255; bytes[27 + i] = ((height - 1) >>> (8 * i)) & 255; }
  return bytes;
}

describe('import header and decompression-bomb validation', () => {
  it('accepts supported raster signatures independently of a filename or declared MIME', async () => {
    for (const bytes of [png(1200, 1800), jpeg(1200, 1800), webp(1200, 1800)]) {
      await expect(validateImage(new Blob([bytes], { type: 'application/octet-stream' }))).resolves.toBeUndefined();
    }
  });

  it('rejects SVG or text disguised with a raster MIME type', async () => {
    await expect(validateImage(new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], { type: 'image/png' }))).rejects.toThrow('valid JPEG, PNG, or WebP');
  });

  it('rejects an incomplete PNG signature before decoding', async () => {
    const malformed = png(100, 100);
    malformed.fill(0, 4, 8);
    await expect(validateImage(new Blob([malformed]))).rejects.toThrow('valid JPEG, PNG, or WebP');
  });

  it('rejects empty and truncated containers', async () => {
    await expect(validateImage(new Blob([]))).rejects.toThrow('32 MB');
    for (const bytes of [new Uint8Array([255, 216, 255, 192]), png(100, 100).subarray(0, 20), webp(100, 100).subarray(0, 16)]) {
      await expect(validateImage(new Blob([bytes]))).rejects.toThrow('valid JPEG, PNG, or WebP');
    }
  });

  it('rejects a JPEG segment whose claimed length exceeds the file', async () => {
    const malformed = jpeg(100, 100);
    malformed[4] = 255;
    malformed[5] = 255;
    await expect(validateImage(new Blob([malformed]))).rejects.toThrow('valid JPEG, PNG, or WebP');
  });

  it('allows a 12 megapixel import and the 40 megapixel boundary', async () => {
    for (const bytes of [png(4000, 3000), jpeg(4000, 3000), webp(4000, 3000), png(8000, 5000)]) {
      await expect(validateImage(new Blob([bytes]))).resolves.toBeUndefined();
    }
  });

  it('rejects declared dimensions above 40 megapixels in every supported format', async () => {
    for (const bytes of [png(8001, 5000), jpeg(8001, 5000), webp(8001, 5000)]) {
      await expect(validateImage(new Blob([bytes]))).rejects.toThrow('40 megapixels');
    }
  });

  it('rejects an excessive edge even when total pixels are small', async () => {
    for (const bytes of [png(16385, 2), jpeg(16385, 2), webp(16385, 2)]) {
      await expect(validateImage(new Blob([bytes]))).rejects.toThrow('40 megapixels');
    }
  });

  it('rejects zero-sized PNG and JPEG images', async () => {
    for (const bytes of [png(0, 100), jpeg(100, 0)]) {
      await expect(validateImage(new Blob([bytes]))).rejects.toThrow('valid JPEG, PNG, or WebP');
    }
  });

  it('rejects files over the byte limit before reading their contents', async () => {
    let read = false;
    const oversized = { size: 32 * 1024 * 1024 + 1, arrayBuffer: async () => { read = true; return new ArrayBuffer(0); } } as Blob;
    await expect(validateImage(oversized)).rejects.toThrow('32 MB');
    expect(read).toBe(false);
  });
});
