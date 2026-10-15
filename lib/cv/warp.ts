import type { Quad, ScanPage } from '../types';
import type { CV } from './runtime';
import { assertDimensions, project, warpGeometry } from './geometry';
import { enhance, estimateLevels, type Levels } from './enhance';
import { validateImage } from './import-validation';

const TILE = 1024;
const PADDING = 40;

function points(cv: CV, corners: Quad) {
  return cv.matFromArray(4, 1, cv.CV_32FC2, corners.flatMap(p => [p.x, p.y]));
}

function destination(width: number, height: number): Quad {
  return [{ x: 0, y: 0 }, { x: width - 1, y: 0 }, { x: width - 1, y: height - 1 }, { x: 0, y: height - 1 }];
}

function sampleLevels(cv: CV, canvas: OffscreenCanvas, corners: Quad, width: number, height: number): Levels {
  const scale = Math.min(1, 640 / Math.max(canvas.width, canvas.height));
  const sample = new OffscreenCanvas(Math.max(2, Math.round(canvas.width * scale)), Math.max(2, Math.round(canvas.height * scale)));
  const context = sample.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('The scanner canvas could not be created.');
  context.drawImage(canvas, 0, 0, sample.width, sample.height);
  const source = cv.matFromImageData(context.getImageData(0, 0, sample.width, sample.height));
  const outputScale = Math.min(1, 640 / Math.max(width, height));
  const outWidth = Math.max(2, Math.round(width * outputScale)), outHeight = Math.max(2, Math.round(height * outputScale));
  const from = points(cv, corners.map(p => ({ x: p.x * sample.width / canvas.width, y: p.y * sample.height / canvas.height })) as Quad);
  const to = points(cv, destination(outWidth, outHeight));
  const transform = cv.getPerspectiveTransform(from, to), output = new cv.Mat();
  try {
    cv.warpPerspective(source, output, transform, new cv.Size(outWidth, outHeight), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    return estimateLevels(output);
  } finally {
    for (const mat of [source, from, to, transform, output]) mat.delete();
    sample.width = 0; sample.height = 0;
  }
}

/** Full-resolution output; only one padded tile enters the WASM heap at a time. */
export async function render(cv: CV, page: ScanPage): Promise<Blob> {
  await validateImage(page.original);
  let bitmap: ImageBitmap | undefined;
  let sourceCanvas: OffscreenCanvas | undefined, outputCanvas: OffscreenCanvas | undefined, rotatedCanvas: OffscreenCanvas | undefined;
  try {
    bitmap = await createImageBitmap(page.original);
    assertDimensions(bitmap.width, bitmap.height);
    const geometry = warpGeometry(page.corners, page.type, bitmap.width, bitmap.height, page.recipe.paperSize);
    const { corners, width, height } = geometry;
    sourceCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!sourceContext) throw new Error('The scanner canvas could not be created.');
    sourceContext.fillStyle = '#fff';
    sourceContext.fillRect(0, 0, bitmap.width, bitmap.height);
    sourceContext.drawImage(bitmap, 0, 0);
    bitmap.close(); bitmap = undefined;
    outputCanvas = new OffscreenCanvas(width, height);
    const outputContext = outputCanvas.getContext('2d');
    if (!outputContext) throw new Error('The scanner output canvas could not be created.');
    const levels = page.recipe.filter === 'auto' ? sampleLevels(cv, sourceCanvas, corners, width, height) : { low: 0, high: 255 };
    const from = points(cv, corners), to = points(cv, destination(width, height));
    const inverse = cv.getPerspectiveTransform(to, from);
    try {
      for (let y = 0; y < height; y += TILE) {
        for (let x = 0; x < width; x += TILE) {
          const left = Math.max(0, x - PADDING), top = Math.max(0, y - PADDING);
          const right = Math.min(width, x + TILE + PADDING), bottom = Math.min(height, y + TILE + PADDING);
          const tileWidth = right - left, tileHeight = bottom - top;
          const mapped = [project(inverse.data64F, left, top), project(inverse.data64F, right - 1, top), project(inverse.data64F, right - 1, bottom - 1), project(inverse.data64F, left, bottom - 1)];
          const sourceX = Math.max(0, Math.floor(Math.min(...mapped.map(p => p.x))) - 3);
          const sourceY = Math.max(0, Math.floor(Math.min(...mapped.map(p => p.y))) - 3);
          const sourceRight = Math.min(sourceCanvas.width, Math.ceil(Math.max(...mapped.map(p => p.x))) + 4);
          const sourceBottom = Math.min(sourceCanvas.height, Math.ceil(Math.max(...mapped.map(p => p.y))) + 4);
          const input = cv.matFromImageData(sourceContext.getImageData(sourceX, sourceY, Math.max(1, sourceRight - sourceX), Math.max(1, sourceBottom - sourceY)));
          const tileFrom = points(cv, corners.map(p => ({ x: p.x - sourceX, y: p.y - sourceY })) as Quad);
          const tileTo = points(cv, destination(width, height).map(p => ({ x: p.x - left, y: p.y - top })) as Quad);
          const transform = cv.getPerspectiveTransform(tileFrom, tileTo), warped = new cv.Mat();
          let enhanced;
          try {
            cv.warpPerspective(input, warped, transform, new cv.Size(tileWidth, tileHeight), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
            enhanced = enhance(cv, warped, page.recipe, levels);
            const pixels = new Uint8ClampedArray(enhanced.data);
            const image = new ImageData(pixels, tileWidth, tileHeight);
            outputContext.putImageData(image, left, top, x - left, y - top, Math.min(TILE, width - x), Math.min(TILE, height - y));
          } finally {
            for (const mat of [input, tileFrom, tileTo, transform, warped]) mat.delete();
            enhanced?.delete();
          }
        }
        // Let cancellation/other worker messages run between rows of tiles.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    } finally { from.delete(); to.delete(); inverse.delete(); }
    sourceCanvas.width = 0; sourceCanvas.height = 0;
    const rotation = Number.isFinite(page.recipe.rotation) ? ((page.recipe.rotation % 360) + 360) % 360 : 0;
    if (rotation || page.recipe.flipX) {
      const radians = rotation * Math.PI / 180;
      const absCos = Math.abs(Math.cos(radians)), absSin = Math.abs(Math.sin(radians));
      // Remove floating point residue at exact right angles.
      const outWidth = Math.ceil(width * (absCos < 1e-10 ? 0 : absCos) + height * (absSin < 1e-10 ? 0 : absSin));
      const outHeight = Math.ceil(height * (absCos < 1e-10 ? 0 : absCos) + width * (absSin < 1e-10 ? 0 : absSin));
      assertDimensions(outWidth, outHeight);
      rotatedCanvas = new OffscreenCanvas(outWidth, outHeight);
      const context = rotatedCanvas.getContext('2d');
      if (!context) throw new Error('The rotation canvas could not be created.');
      context.fillStyle = '#fff'; context.fillRect(0, 0, outWidth, outHeight);
      context.translate(outWidth / 2, outHeight / 2);
      context.rotate(radians);
      context.scale(page.recipe.flipX ? -1 : 1, 1);
      context.drawImage(outputCanvas, -width / 2, -height / 2);
      outputCanvas.width = 0; outputCanvas.height = 0;
      return await rotatedCanvas.convertToBlob({ type: 'image/png' });
    }
    return await outputCanvas.convertToBlob({ type: 'image/png' });
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('The scan could not be rendered. Try a smaller photo or adjust the crop.');
  } finally {
    bitmap?.close();
    for (const canvas of [sourceCanvas, outputCanvas, rotatedCanvas]) if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
