function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Only print density is added to a freshly encoded image; no EXIF or original metadata. */
export async function setImageResolution(blob: Blob, dpi: number): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (blob.type === 'image/png') {
    const view = new DataView(bytes.buffer);
    const density = new Uint8Array(21);
    const densityView = new DataView(density.buffer);
    densityView.setUint32(0, 9);
    density.set([112, 72, 89, 115], 4); // pHYs
    const pixelsPerMetre = Math.round(dpi / 0.0254);
    densityView.setUint32(8, pixelsPerMetre);
    densityView.setUint32(12, pixelsPerMetre);
    density[16] = 1;
    densityView.setUint32(17, crc32(density.subarray(4, 17)));
    const chunks = [bytes.subarray(0, 8)];
    let inserted = false;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      const end = offset + 12 + length;
      if (end > bytes.length) throw new Error('The encoded PNG is incomplete.');
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (!inserted && type === 'IDAT') { chunks.push(density); inserted = true; }
      if (type !== 'pHYs') chunks.push(bytes.subarray(offset, end));
      offset = end;
    }
    if (!inserted) throw new Error('The encoded PNG has no image data.');
    return new Blob(chunks, { type: blob.type });
  }
  if (blob.type === 'image/jpeg') {
    // JFIF APP0 contains the resolution directly and does not require an EXIF segment.
    for (let offset = 2; offset + 4 < bytes.length;) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if (marker === 0xe0 && length >= 16 && String.fromCharCode(...bytes.subarray(offset + 4, offset + 9)) === 'JFIF\0') {
        bytes[offset + 11] = 1;
        bytes[offset + 12] = dpi >>> 8;
        bytes[offset + 13] = dpi & 255;
        bytes[offset + 14] = dpi >>> 8;
        bytes[offset + 15] = dpi & 255;
        return new Blob([bytes], { type: blob.type });
      }
      offset += 2 + length;
    }
    const jfif = new Uint8Array([0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1, dpi >>> 8, dpi & 255, dpi >>> 8, dpi & 255, 0, 0]);
    return new Blob([bytes.subarray(0, 2), jfif, bytes.subarray(2)], { type: blob.type });
  }
  // WebP has no standard print-resolution field without adding EXIF. Its dimensions still follow DPI.
  return blob;
}
