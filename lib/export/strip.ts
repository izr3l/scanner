const MAX_EXPORT_PIXELS = 48_000_000;

export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width * height > MAX_EXPORT_PIXELS) {
    throw new Error('This page is too large to export safely. Reduce the page size or DPI.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  return canvas;
}

export function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not create an image canvas.');
  return context;
}

export function canvasBlob(canvas: HTMLCanvasElement, mime = 'image/png', quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (!blob) reject(new Error('The browser could not encode the exported image.'));
    else if (blob.type !== mime) reject(new Error(`${mime === 'image/webp' ? 'WebP' : mime} export is not supported in this browser. Choose PNG or JPEG.`));
    else resolve(blob);
  }, mime, quality));
}

export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** Decode only to pixels. The input blob's container and metadata never reach an export. */
export async function loadPixels(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; release(): void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Older Safari supports createImageBitmap but rejects some canvas-encoded blobs.
    }
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('The processed image could not be decoded.'));
      img.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => { img.src = ''; } };
  } finally {
    URL.revokeObjectURL(url);
  }
}
