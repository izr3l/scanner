import type { Quad, DetectionResult } from '../types';
import type { CV, CVMat } from './runtime';
import { polygonArea } from './geometry';

export function assessQuality(cv: CV, gray: CVMat, corners: Quad): DetectionResult['quality'] {
  const mask = cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8UC1);
  const laplacian = new cv.Mat(), mean = new cv.Mat(), std = new cv.Mat();
  const highlights = new cv.Mat(), hierarchy = new cv.Mat(), contours = new cv.MatVector();
  const center = corners.reduce((c, p) => ({ x: c.x + p.x / 4, y: c.y + p.y / 4 }), { x: 0, y: 0 });
  const inner = corners.map(p => ({ x: center.x + (p.x - center.x) * 0.94, y: center.y + (p.y - center.y) * 0.94 })) as Quad;
  const polygon = cv.matFromArray(4, 1, cv.CV_32SC2, inner.flatMap(p => [Math.round(p.x), Math.round(p.y)]));
  try {
    cv.fillConvexPoly(mask, polygon, new cv.Scalar(255));
    cv.Laplacian(gray, laplacian, cv.CV_64F, 1);
    cv.meanStdDev(laplacian, mean, std, mask);
    const variance = std.data64F[0] ** 2;
    const brightness = cv.mean(gray, mask)[0];
    cv.threshold(gray, highlights, 250, 255, cv.THRESH_BINARY);
    cv.bitwise_and(highlights, mask, highlights);
    const area = Math.max(1, polygonArea(inner));
    const clippedRatio = cv.countNonZero(highlights) / area;
    cv.findContours(highlights, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let largest = 0;
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      try { largest = Math.max(largest, cv.contourArea(contour)); }
      finally { contour.delete(); }
    }
    // A uniformly white sheet is not a glare blob. Require a local clipped patch.
    const glare = brightness < 235 && clippedRatio > 0.008 && clippedRatio < 0.4 && largest / area > 0.006 && largest / area < 0.3;
    return { blur: variance < 75, glare, lowLight: brightness < 60 };
  } finally {
    for (const mat of [mask, laplacian, mean, std, highlights, hierarchy, polygon]) mat.delete();
    contours.delete();
  }
}
