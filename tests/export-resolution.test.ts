import { describe, expect, it } from 'vitest';
import { setImageResolution } from '../lib/export/resolution';

const png = new Blob([Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))], { type: 'image/png' });

describe('print resolution without EXIF', () => {
  it('adds only PNG print density matching the chosen DPI', async () => {
    const output = await setImageResolution(png, 300);
    const bytes = new Uint8Array(await output.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const chunks: string[] = [];
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      chunks.push(type);
      if (type === 'pHYs') {
        expect(view.getUint32(offset + 8)).toBe(11811);
        expect(view.getUint32(offset + 12)).toBe(11811);
        expect(bytes[offset + 16]).toBe(1);
      }
      offset += length + 12;
    }
    expect(chunks).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
  });

  it('replaces an earlier density rather than accumulating chunks', async () => {
    const output = await setImageResolution(await setImageResolution(png, 150), 200);
    const bytes = new Uint8Array(await output.arrayBuffer());
    const types = new TextDecoder('latin1').decode(bytes);
    expect(types.match(/pHYs/g)).toHaveLength(1);
  });

  it('uses JFIF inch density for JPEG without an EXIF segment', async () => {
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
    const output = new Uint8Array(await (await setImageResolution(jpeg, 300)).arrayBuffer());
    expect([...output.subarray(2, 20)]).toEqual([0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1, 1, 44, 1, 44, 0, 0]);
    expect(new TextDecoder('latin1').decode(output)).not.toContain('Exif');
  });
});
