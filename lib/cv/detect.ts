import type { DetectionResult, Point, Quad, ScanMode } from '../types';
import type { CV, CVMat } from './runtime';
import { assertDimensions, candidateScore, DETECTION_EDGE, distance, insetQuad, orderQuad, polygonArea } from './geometry';
import { assessQuality } from './quality';
import { validateImage } from './import-validation';

export async function detect(cv: CV, source: Blob | ImageBitmap, mode: ScanMode): Promise<DetectionResult> {
  let bitmap: ImageBitmap | undefined;
  let canvas: OffscreenCanvas | undefined;
  try {
    if (source instanceof Blob) await validateImage(source);
    bitmap = source instanceof Blob ? await createImageBitmap(source) : source;
    const { width, height } = bitmap;
    assertDimensions(width, height);
    const scale = Math.min(1, DETECTION_EDGE / Math.max(width, height));
    canvas = new OffscreenCanvas(Math.max(2, Math.round(width * scale)), Math.max(2, Math.round(height * scale)));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('This browser does not support the offline scanner canvas.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const detection = detectPixels(cv, context.getImageData(0, 0, canvas.width, canvas.height), mode);
    return {
      ...detection,
      corners: detection.corners.map(p => ({ x: Math.min(width - 1, p.x * width / canvas!.width), y: Math.min(height - 1, p.y * height / canvas!.height) })) as Quad,
      width, height,
    };
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('This image could not be decoded. Choose another photo.');
  } finally {
    bitmap?.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

interface Candidate { corners: Quad; area: number; geometry: number; support: number; rank: number }

/** Estimate the noise floor without letting a few dark text strokes set every edge threshold. */
function sensitiveThreshold(gray: CVMat): number {
  const histogram = new Uint32Array(32), data = gray.data;
  let count = 0;
  for (let y = 2; y < gray.rows - 2; y += 3) for (let x = 2; x < gray.cols - 2; x += 3) {
    histogram[Math.min(31, Math.abs(data[y * gray.cols + x] - data[y * gray.cols + x + 1]))]++;
    count++;
  }
  let sum = 0;
  for (let delta = 0; delta < histogram.length; delta++) {
    sum += histogram[delta];
    if (sum >= count / 2) return Math.max(6, Math.min(14, delta * 3));
  }
  return 6;
}

/** Require an actual intensity step along the proposed borders, not only a fitted hull. */
function borderSupport(gray: CVMat, corners: Quad): number {
  const data = gray.data, width = gray.cols, height = gray.rows;
  const sample = (x: number, y: number) => data[Math.round(y) * width + Math.round(x)];
  // Look beyond a thin printed frame and its blur halo, not just either Canny edge.
  const offset = Math.max(4, Math.min(12, Math.min(width, height) / 35));
  const coverage: number[] = [];
  for (let edge = 0; edge < 4; edge++) {
    const a = corners[edge], b = corners[(edge + 1) % 4];
    const length = distance(a, b), nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
    if (length < Math.min(width, height) * 0.07) return 0;
    let supported = 0, sampled = 0;
    for (let i = 2; i <= 22; i++) {
      const t = i / 24, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      if (x - Math.abs(nx * offset) < 0 || x + Math.abs(nx * offset) > width - 1 || y - Math.abs(ny * offset) < 0 || y + Math.abs(ny * offset) > height - 1) continue;
      const contrast = Math.abs(sample(x + nx * offset, y + ny * offset) - sample(x - nx * offset, y - ny * offset));
      const central = Math.abs(sample(x + nx * 3, y + ny * 3) - sample(x - nx * 3, y - ny * 3));
      sampled++;
      if (contrast >= 4 && central >= contrast * 0.35) supported++;
    }
    coverage.push(sampled >= 8 ? supported / sampled : 0);
  }
  // One partly shadowed side is allowed; a missing side is never invented.
  if (coverage.some(value => value < 0.15) || coverage.filter(value => value >= 0.4).length < 3) return 0;
  return coverage.reduce((sum, value) => sum + value, 0) / 4;
}

function inside(point: Point, quad: Quad): boolean {
  return quad.every((a, index) => {
    const b = quad[(index + 1) % 4];
    return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x) >= -2;
  });
}

function collectCandidates(cv: CV, image: CVMat, gray: CVMat, mode: ScanMode, candidates: Candidate[]): void {
  const contours = new cv.MatVector(), hierarchy = new cv.Mat();
  const frameArea = image.cols * image.rows;
  try {
    cv.findContours(image, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const large: { index: number; area: number }[] = [];
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      try {
        // Bounding area retains a nearly closed outer edge split by a small shadow.
        const bounds = cv.boundingRect(contour), area = bounds.width * bounds.height;
        if (area > frameArea * 0.08) large.push({ index: i, area });
      } finally { contour.delete(); }
    }
    large.sort((a, b) => b.area - a.area);
    for (const item of large.slice(0, 40)) {
      const contour = contours.get(item.index), approx = new cv.Mat(), hull = new cv.Mat();
      const consider = (curve: CVMat): boolean => {
        const perimeter = cv.arcLength(curve, true);
        for (const tolerance of [0.012, 0.02, 0.035]) {
          cv.approxPolyDP(curve, approx, tolerance * perimeter, true);
          if (approx.rows !== 4 || !cv.isContourConvex(approx)) continue;
          const corners = orderQuad(Array.from({ length: 4 }, (_, i) => ({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] })));
          const area = polygonArea(corners);
          if (area < frameArea * 0.08 || area > frameArea * 0.985) continue;
          const frameCorners = corners.filter(p => p.x <= 2 || p.y <= 2 || p.x >= image.cols - 3 || p.y >= image.rows - 3).length;
          if (frameCorners >= 3) continue;
          const support = borderSupport(gray, corners);
          if (!support) continue;
          const geometry = candidateScore(corners, frameArea, mode);
          const rank = 0.65 * Math.sqrt(area / frameArea) + 0.25 * geometry + 0.1 * support;
          candidates.push({ corners, area, geometry, support, rank });
          return true;
        }
        return false;
      };
      try {
        if (!consider(contour)) {
          cv.convexHull(contour, hull, false, true);
          consider(hull);
        }
      } finally { contour.delete(); approx.delete(); hull.delete(); }
    }
  } finally { contours.delete(); hierarchy.delete(); }
}

export function detectPixels(cv: CV, image: ImageData, mode: ScanMode): Omit<DetectionResult, 'width' | 'height'> {
  const src = cv.matFromImageData(image);
  const gray = new cv.Mat(), smooth = new cv.Mat(), edges = new cv.Mat(), dilated = new cv.Mat();
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U), joinKernel = cv.Mat.ones(5, 5, cv.CV_8U);
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, smooth, new cv.Size(5, 5), 0);
    const candidates: Candidate[] = [];
    const inspectEdges = (low: number, closeGaps: boolean) => {
      cv.Canny(smooth, edges, low, low * 3);
      if (closeGaps) cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, joinKernel);
      cv.dilate(edges, dilated, kernel);
      collectCandidates(cv, dilated, smooth, mode, candidates);
    };
    // Search weak boundaries first even when a strong inner chart is visible.
    inspectEdges(sensitiveThreshold(smooth), true);
    const plausiblePage = candidates.some(candidate => candidate.geometry >= 0.72 && candidate.support >= 0.8);
    // Strong edges recover pages connected to background texture in the weak pass.
    // Avoid duplicating the whole contour search for an already supported page.
    if (!plausiblePage) inspectEdges(45, false);
    // Prefer the enclosing sheet over a high-contrast rectangle printed on it.
    const outer = candidates.filter(candidate => !candidates.some(other => other.area > candidate.area * 1.12 && other.geometry > 0.55 && other.support > 0.45 && candidate.corners.every(point => inside(point, other.corners))));
    outer.sort((a, b) => b.rank - a.rank);
    const best = outer[0];
    const corners = best?.corners ?? insetQuad(image.width, image.height, mode);
    return {
      corners, confidence: best ? best.geometry * 0.85 + best.support * 0.15 : 0,
      fallback: !best, quality: assessQuality(cv, gray, corners),
    };
  } finally {
    for (const mat of [src, gray, smooth, edges, dilated, kernel, joinKernel]) mat.delete();
  }
}
