import type { DetectionResult, Quad, ScanMode } from '../types';
import type { CV } from './runtime';
import { assertDimensions, candidateScore, DETECTION_EDGE, insetQuad, orderQuad, polygonArea } from './geometry';
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

export function detectPixels(cv: CV, image: ImageData, mode: ScanMode): Omit<DetectionResult, 'width' | 'height'> {
    const src = cv.matFromImageData(image);
    const gray = new cv.Mat(), smooth = new cv.Mat(), edges = new cv.Mat(), dilated = new cv.Mat();
    const kernel = cv.Mat.ones(3, 3, cv.CV_8U), hierarchy = new cv.Mat(), contours = new cv.MatVector();
    try {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, smooth, new cv.Size(5, 5), 0);
      cv.Canny(smooth, edges, 45, 135);
      cv.dilate(edges, dilated, kernel);
      cv.findContours(dilated, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      const frameArea = image.width * image.height;
      const large: { index: number; area: number }[] = [];
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        try {
          const area = cv.contourArea(contour);
          if (area > frameArea * 0.08 && area < frameArea * 0.995) large.push({ index: i, area });
        } finally { contour.delete(); }
      }
      large.sort((a, b) => b.area - a.area);
      let best: Quad | null = null, score = 0;
      for (const item of large.slice(0, 40)) {
        const contour = contours.get(item.index), approx = new cv.Mat();
        try {
          const perimeter = cv.arcLength(contour, true);
          for (const tolerance of [0.018, 0.028, 0.04]) {
            cv.approxPolyDP(contour, approx, tolerance * perimeter, true);
            if (approx.rows !== 4 || !cv.isContourConvex(approx)) continue;
            const corners = orderQuad(Array.from({ length: 4 }, (_, i) => ({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] })));
            if (polygonArea(corners) < frameArea * 0.08) continue;
            const candidate = candidateScore(corners, frameArea, mode);
            if (candidate > score) { best = corners; score = candidate; }
            break;
          }
        } finally { contour.delete(); approx.delete(); }
      }
      const fallback = !best;
      const corners = best ?? insetQuad(image.width, image.height, mode);
      const quality = assessQuality(cv, gray, corners);
      return {
        corners, confidence: fallback ? 0 : score, fallback, quality,
      };
    } finally {
      for (const mat of [src, gray, smooth, edges, dilated, kernel, hierarchy]) mat.delete();
      contours.delete();
    }
}
