import type { Point, Quad, ScanMode, ScannedPaperSize } from '../types';
import { PAGE_PRESETS } from '../presets';

export const DETECTION_EDGE = 640;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_IMAGE_EDGE = 16_384;
export const MAX_IMPORT_BYTES = 32 * 1024 * 1024;

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function polygonArea(points: Quad): number {
  return Math.abs(points.reduce((sum, p, i) => {
    const q = points[(i + 1) % 4];
    return sum + p.x * q.y - q.x * p.y;
  }, 0)) / 2;
}

/** Sort around the centroid first, so tilted diamonds never duplicate a corner. */
export function orderQuad(points: Point[]): Quad {
  if (points.length !== 4) throw new Error('A crop needs four corners.');
  const center = points.reduce((c, p) => ({ x: c.x + p.x / 4, y: c.y + p.y / 4 }), { x: 0, y: 0 });
  const ordered = [...points].sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
  const start = ordered.reduce((best, p, i) => p.x + p.y < ordered[best].x + ordered[best].y ? i : best, 0);
  const quad = [...ordered.slice(start), ...ordered.slice(0, start)] as Quad;
  const cross = (quad[1].x - quad[0].x) * (quad[2].y - quad[1].y) - (quad[1].y - quad[0].y) * (quad[2].x - quad[1].x);
  return cross >= 0 ? quad : [quad[0], quad[3], quad[2], quad[1]];
}

export function isConvexQuad(quad: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i], b = quad[(i + 1) % 4], c = quad[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-4) return false;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
}

export function assertDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) {
    throw new Error('Use an image below 40 megapixels and 16,384 pixels per edge.');
  }
}

export function insetQuad(width: number, height: number, mode: ScanMode): Quad {
  const ratio = modeRatio(mode);
  let w = width * 0.90, h = height * 0.90;
  if (ratio) {
    if (w / h > ratio) w = h * ratio;
    else h = w / ratio;
  }
  const x = (width - w) / 2, y = (height - h) / 2;
  return [{ x, y }, { x: x + w - 1, y }, { x: x + w - 1, y: y + h - 1 }, { x, y: y + h - 1 }];
}

export function modeRatio(mode: ScanMode): number | null {
  return mode === 'id' ? 85.6 / 53.98 : mode === 'passport' ? 125 / 88 : null;
}

export function candidateScore(quad: Quad, frameArea: number, mode: ScanMode): number {
  const areaRatio = polygonArea(quad) / frameArea;
  const width = (distance(quad[0], quad[1]) + distance(quad[2], quad[3])) / 2;
  const height = (distance(quad[0], quad[3]) + distance(quad[1], quad[2])) / 2;
  const rectangularity = Math.min(1, polygonArea(quad) / (width * height));
  const expected = modeRatio(mode);
  const aspect = expected
    ? Math.exp(-2 * Math.min(Math.abs(Math.log((width / height) / expected)), Math.abs(Math.log((height / width) / expected))))
    : 1;
  let angular = 0;
  for (let i = 0; i < 4; i++) {
    const p = quad[(i + 3) % 4], c = quad[i], n = quad[(i + 1) % 4];
    angular += 1 - Math.abs(((p.x - c.x) * (n.x - c.x) + (p.y - c.y) * (n.y - c.y)) / Math.max(1, distance(p, c) * distance(n, c)));
  }
  return Math.min(1, 0.50 * Math.sqrt(areaRatio) + 0.20 * rectangularity + 0.20 * aspect + 0.10 * angular / 4);
}

export function warpGeometry(input: Quad, mode: ScanMode, sourceWidth: number, sourceHeight: number, paperSize: ScannedPaperSize = 'original'): { corners: Quad; width: number; height: number } {
  if (input.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Crop corners must be finite.');
  let corners = input.map(p => ({ x: Math.max(0, Math.min(sourceWidth - 1, p.x)), y: Math.max(0, Math.min(sourceHeight - 1, p.y)) })) as Quad;
  if (!isConvexQuad(corners) || polygonArea(corners) < 64) throw new Error('Move the crop corners to make a clear four-sided page.');
  let width = Math.max(distance(corners[0], corners[1]), distance(corners[2], corners[3]));
  let height = Math.max(distance(corners[0], corners[3]), distance(corners[1], corners[2]));
  const lockedRatio = modeRatio(mode);
  let ratio = lockedRatio;
  if (lockedRatio) {
    // A portrait capture of a card is turned onto its physical landscape page.
    if (width < height) {
      corners = [corners[3], corners[0], corners[1], corners[2]];
      [width, height] = [height, width];
    }
  }
  // A photograph's edge lengths do not determine a tilted sheet's physical aspect.
  // Only rectify to a paper ratio when the user identifies the scanned paper.
  if (!lockedRatio && paperSize !== 'original') {
    const size = PAGE_PRESETS[paperSize];
    ratio = width > height ? size.height / size.width : size.width / size.height;
  }
  if (ratio) { if (width / height > ratio) width = height * ratio; else height = width / ratio; }
  width = Math.max(2, Math.round(width));
  height = Math.max(2, Math.round(height));
  assertDimensions(width, height);
  return { corners, width, height };
}

/** Project a destination pixel through the inverse perspective matrix. */
export function project(matrix: ArrayLike<number>, x: number, y: number): Point {
  const d = matrix[6] * x + matrix[7] * y + matrix[8];
  if (Math.abs(d) < 1e-9) throw new Error('This crop has an invalid perspective.');
  return { x: (matrix[0] * x + matrix[1] * y + matrix[2]) / d, y: (matrix[3] * x + matrix[4] * y + matrix[5]) / d };
}
