import { assertDimensions, MAX_IMPORT_BYTES } from './geometry';

function ascii(data: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...data.subarray(offset, offset + length));
}

/** Read raster headers before decode; SVG and unknown formats never enter the decoder. */
export async function validateImage(blob: Blob): Promise<{ width: number; height: number; type: string }> {
  if (blob.size === 0 || blob.size > MAX_IMPORT_BYTES) throw new Error('Choose an image smaller than 32 MB.');
  // A JPEG SOF can follow large APP segments; the bounded input is already capped.
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let width = 0, height = 0, type = '';
  if (bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) && ascii(bytes, 12, 4) === 'IHDR') {
    width = view.getUint32(16); height = view.getUint32(20); type = 'image/png';
  } else if (bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === 'VP8X') {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
      height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
    } else if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
    }
    type = 'image/webp';
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += length;
    }
    type = 'image/jpeg';
  }
  if (!type || !width || !height) throw new Error('Choose a valid JPEG, PNG, or WebP image.');
  if (blob.type && blob.type !== type && !(type === 'image/jpeg' && blob.type === 'image/jpg') && blob.type !== 'application/octet-stream') throw new Error('The image content does not match its file type.');
  assertDimensions(width, height);
  return { width, height, type };
}
