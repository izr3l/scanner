import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchOpenCV } from '../scripts/opencv-csp.mjs';
import type { CV } from '../lib/cv/runtime';
import type { Quad } from '../lib/types';
import { candidateScore, distance, insetQuad, isConvexQuad, orderQuad, polygonArea, project, warpGeometry } from '../lib/cv/geometry';
import { detectPixels } from '../lib/cv/detect';
import { enhance, estimateLevels } from '../lib/cv/enhance';
import { assessQuality } from '../lib/cv/quality';
import { validateImage } from '../lib/cv/import-validation';
import { verifyBytes } from '../lib/cv/protocol';

let cv: CV;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const original = readFileSync(require.resolve('@techstark/opencv-js'), 'utf8');
  const patched = patchOpenCV(original);
  expect(patched).not.toMatch(/\bnew\s+Function\s*\(|\beval\s*\(/);
  const target = fileURLToPath(new URL('../.qa/cv-tests/patched-opencv.cjs', import.meta.url));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, patched);
  cv = await (require(target) as CV | Promise<CV>);
}, 30_000);

function imageFromMat(mat: InstanceType<CV['Mat']>): ImageData {
  return { data: new Uint8ClampedArray(mat.data), width: mat.cols, height: mat.rows, colorSpace: 'srgb' } as ImageData;
}

function photographedPaper(options: { contrast: number; shadow?: boolean; blur?: boolean }) {
  const width = 640, height = 480;
  const expected: Quad = [{ x: 185, y: 28 }, { x: 507, y: 65 }, { x: 465, y: 454 }, { x: 151, y: 421 }];
  const mask = cv.Mat.zeros(height, width, cv.CV_8UC1);
  const polygon = cv.matFromArray(4, 1, cv.CV_32SC2, expected.flatMap(p => [p.x, p.y]));
  const source = new cv.Mat(height, width, cv.CV_8UC4);
  try {
    cv.fillConvexPoly(mask, polygon, new cv.Scalar(255));
    const pixels = source.data, paper = mask.data;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const shadow = options.shadow ? 65 * Math.exp(-(((x - 145 - y * 0.3) / 95) ** 2)) : 0;
      const noise = ((x * 17 + y * 29) % 7) - 3;
      const value = 212 + (paper[y * width + x] ? options.contrast : 0) + x * 0.014 - shadow + noise;
      const offset = (y * width + x) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = Math.round(value);
      pixels[offset + 3] = 255;
    }
    // A strong inset chart is deliberately easier to see than the page boundary.
    cv.rectangle(source, new cv.Point(220, 140), new cv.Point(416, 337), new cv.Scalar(45, 45, 45, 255), 4);
    for (let y = 160; y < 320; y += 27) cv.line(source, new cv.Point(235, y), new cv.Point(395, y), new cv.Scalar(80, 80, 80, 255), 2);
    if (options.blur) cv.GaussianBlur(source, source, new cv.Size(7, 7), 1.2);
    return { source, expected };
  } catch (error) { source.delete(); throw error; }
  finally { polygon.delete(); mask.delete(); }
}

describe('real OpenCV scanner pipeline', () => {
  it.each([
    { name: 'white paper on a pale surface', contrast: 13 },
    { name: 'soft camera focus and low contrast', contrast: 19, blur: true },
    { name: 'a broad diagonal shadow and sensor noise', contrast: 19, shadow: true, blur: true },
  ])('finds the whole page around an inner chart with $name', (options) => {
    const { source, expected } = photographedPaper(options);
    try {
      const result = detectPixels(cv, imageFromMat(source), 'document');
      expect(result.fallback).toBe(false);
      expect(polygonArea(result.corners)).toBeGreaterThan(polygonArea(expected) * 0.90);
      result.corners.forEach((corner, index) => expect(distance(corner, expected[index])).toBeLessThan(10));
    } finally { source.delete(); }
  });

  it('keeps the outer page when an inset filled chart is also a supported quadrilateral', () => {
    const { source, expected } = photographedPaper({ contrast: 17, shadow: true });
    try {
      cv.rectangle(source, new cv.Point(220, 140), new cv.Point(416, 337), new cv.Scalar(45, 45, 45, 255), -1);
      const result = detectPixels(cv, imageFromMat(source), 'document');
      expect(result.fallback).toBe(false);
      result.corners.forEach((corner, index) => expect(distance(corner, expected[index])).toBeLessThan(10));
    } finally { source.delete(); }
  });

  it('does not treat a printed chart outline as a visible paper boundary', () => {
    const source = new cv.Mat(480, 640, cv.CV_8UC4, new cv.Scalar(238, 238, 238, 255));
    try {
      cv.rectangle(source, new cv.Point(150, 90), new cv.Point(490, 390), new cv.Scalar(45, 45, 45, 255), 4);
      const result = detectPixels(cv, imageFromMat(source), 'document');
      expect(result.fallback).toBe(true);
      expect(result.confidence).toBe(0);
    } finally { source.delete(); }
  });

  it('ignores an image-frame border around a real page', () => {
    const { source, expected } = photographedPaper({ contrast: 25 });
    try {
      cv.rectangle(source, new cv.Point(0, 0), new cv.Point(639, 479), new cv.Scalar(30, 30, 30, 255), 4);
      const result = detectPixels(cv, imageFromMat(source), 'document');
      expect(result.fallback).toBe(false);
      result.corners.forEach((corner, index) => expect(distance(corner, expected[index])).toBeLessThan(10));
    } finally { source.delete(); }
  });

  it('does not manufacture a fourth paper corner from a triangular object', () => {
    const source = new cv.Mat(480, 640, cv.CV_8UC4, new cv.Scalar(60, 60, 60, 255));
    const triangle = cv.matFromArray(3, 1, cv.CV_32SC2, [190, 50, 530, 420, 100, 405]);
    try {
      cv.fillConvexPoly(source, triangle, new cv.Scalar(235, 235, 235, 255));
      expect(detectPixels(cv, imageFromMat(source), 'document').fallback).toBe(true);
    } finally { triangle.delete(); source.delete(); }
  });

  it('detects a perspective document rather than choosing its text lines', () => {
    const source = new cv.Mat(480, 640, cv.CV_8UC4, new cv.Scalar(25, 25, 25, 255));
    const expected: Quad = [{ x: 120, y: 65 }, { x: 540, y: 100 }, { x: 505, y: 415 }, { x: 100, y: 390 }];
    const polygon = cv.matFromArray(4, 1, cv.CV_32SC2, expected.flatMap(p => [p.x, p.y]));
    try {
      cv.fillConvexPoly(source, polygon, new cv.Scalar(230, 230, 230, 255));
      for (let y = 150; y < 350; y += 25) cv.rectangle(source, new cv.Point(160, y), new cv.Point(460, y + 4), new cv.Scalar(30, 30, 30, 255), -1);
      const detection = detectPixels(cv, imageFromMat(source), 'document');
      expect(detection.fallback).toBe(false);
      expect(detection.confidence).toBeGreaterThan(0.65);
      detection.corners.forEach((corner, index) => expect(distance(corner, expected[index])).toBeLessThan(7));
      expect(detection.quality.blur).toBe(false);
      expect(detection.quality.lowLight).toBe(false);
    } finally { source.delete(); polygon.delete(); }
  });

  it('returns a manual crop and low-light hint for a dark frame', () => {
    const source = new cv.Mat(240, 320, cv.CV_8UC4, new cv.Scalar(20, 20, 20, 255));
    try {
      const result = detectPixels(cv, imageFromMat(source), 'id');
      expect(result.fallback).toBe(true);
      expect(result.confidence).toBe(0);
      expect(result.quality.lowLight).toBe(true);
      expect(result.quality.blur).toBe(true);
      const width = distance(result.corners[0], result.corners[1]), height = distance(result.corners[0], result.corners[3]);
      expect(Math.abs(width / height - 85.6 / 53.98)).toBeLessThan(0.01);
    } finally { source.delete(); }
  });

  it('detects a local clipped highlight while accepting uniformly white paper', () => {
    const gray = new cv.Mat(240, 320, cv.CV_8UC1, new cv.Scalar(225));
    const corners = insetQuad(320, 240, 'document');
    try {
      cv.rectangle(gray, new cv.Point(110, 70), new cv.Point(180, 130), new cv.Scalar(255), -1);
      expect(assessQuality(cv, gray, corners).glare).toBe(true);
      gray.setTo(new cv.Scalar(255));
      expect(assessQuality(cv, gray, corners).glare).toBe(false);
    } finally { gray.delete(); }
  });

  it('renders a document filter and color adjustments without mutating the original Mat', () => {
    const source = new cv.Mat(120, 180, cv.CV_8UC4, new cv.Scalar(180, 175, 160, 255));
    let output;
    try {
      cv.rectangle(source, new cv.Point(20, 30), new cv.Point(160, 35), new cv.Scalar(20, 25, 20, 255), -1);
      const original = new Uint8Array(source.data);
      output = enhance(cv, source, { filter: 'bw', brightness: 0, contrast: 0, sharpness: 25, rotation: 0, flipX: false }, estimateLevels(source));
      // Compare the view bytes, never the entire backing WASM memory buffer.
      expect(Buffer.from(source.data).equals(Buffer.from(original))).toBe(true);
      expect(output.data[0]).toBeGreaterThan(230);
      const textPixel = (32 * 180 + 90) * 4;
      expect(output.data[textPixel]).toBeLessThan(20);
      expect(output.data[textPixel]).toBe(output.data[textPixel + 1]);
      expect(output.data[textPixel + 3]).toBe(255);
    } finally { output?.delete(); source.delete(); }
  });

  it('maps a full-resolution tile through an inverse perspective matrix without drift', () => {
    const quad: Quad = [{ x: 200, y: 200 }, { x: 3700, y: 350 }, { x: 3600, y: 2700 }, { x: 350, y: 2600 }];
    const geometry = warpGeometry(quad, 'document', 4000, 3000);
    const destination: Quad = [{ x: 0, y: 0 }, { x: geometry.width - 1, y: 0 }, { x: geometry.width - 1, y: geometry.height - 1 }, { x: 0, y: geometry.height - 1 }];
    const from = cv.matFromArray(4, 1, cv.CV_32FC2, destination.flatMap(p => [p.x, p.y]));
    const to = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flatMap(p => [p.x, p.y]));
    const inverse = cv.getPerspectiveTransform(from, to);
    try {
      expect(geometry.width).toBeGreaterThan(3000);
      expect(geometry.height).toBeGreaterThan(2000);
      destination.forEach((p, i) => expect(distance(project(inverse.data64F, p.x, p.y), quad[i])).toBeLessThan(0.01));
      const inside = project(inverse.data64F, 1024, 1024);
      expect(inside.x).toBeGreaterThan(quad[0].x);
      expect(inside.x).toBeLessThan(quad[1].x);
    } finally { from.delete(); to.delete(); inverse.delete(); }
  });
});

describe('crop and import guards', () => {
  it('orders tilted corners without repeating the top vertex', () => {
    const quad = orderQuad([{ x: 100, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 200 }, { x: 0, y: 100 }]);
    expect(new Set(quad.map(p => `${p.x},${p.y}`)).size).toBe(4);
    expect(isConvexQuad(quad)).toBe(true);
  });

  it('locks ID and passport output to their physical ratio even from a portrait capture', () => {
    const corners: Quad = [{ x: 100, y: 100 }, { x: 800, y: 100 }, { x: 800, y: 1600 }, { x: 100, y: 1600 }];
    for (const [mode, ratio] of [['id', 85.6 / 53.98], ['passport', 125 / 88]] as const) {
      const out = warpGeometry(corners, mode, 1800, 1800);
      expect(Math.abs(out.width / out.height - ratio) / ratio).toBeLessThan(0.01);
    }
  });

  it('scores the selected card ratio above an equal-area square', () => {
    const card: Quad = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 252 }, { x: 0, y: 252 }];
    const square: Quad = [{ x: 0, y: 0 }, { x: 317, y: 0 }, { x: 317, y: 317 }, { x: 0, y: 317 }];
    expect(candidateScore(card, 200_000, 'id')).toBeGreaterThan(candidateScore(square, 200_000, 'id'));
  });

  it('rejects self-intersecting or non-finite crop corners', () => {
    expect(() => warpGeometry([{ x: 0, y: 0 }, { x: 200, y: 200 }, { x: 200, y: 0 }, { x: 0, y: 200 }], 'document', 300, 300)).toThrow();
    expect(() => warpGeometry([{ x: NaN, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }], 'document', 300, 300)).toThrow();
  });

  it('rejects SVG disguised as JPEG and oversized raster dimensions before decoding', async () => {
    await expect(validateImage(new Blob(['<svg/>'], { type: 'image/jpeg' }))).rejects.toThrow('valid JPEG');
    const header = new Uint8Array(24);
    header.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    header.set([73, 72, 68, 82], 12);
    new DataView(header.buffer).setUint32(16, 20_000);
    new DataView(header.buffer).setUint32(20, 20_000);
    await expect(validateImage(new Blob([header], { type: 'image/png' }))).rejects.toThrow('40 megapixels');
  });

  it('checks all PNG signature bytes and rejects a MIME mismatch', async () => {
    const header = new Uint8Array(24);
    header.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    header.set([73, 72, 68, 82], 12);
    new DataView(header.buffer).setUint32(16, 320);
    new DataView(header.buffer).setUint32(20, 240);
    await expect(validateImage(new Blob([header], { type: 'image/jpeg' }))).rejects.toThrow('does not match');
    header[7] = 0;
    await expect(validateImage(new Blob([header], { type: 'image/png' }))).rejects.toThrow('valid JPEG');
  });

  it('rejects modified executable assets before they can run', async () => {
    const bytes = new TextEncoder().encode('verified worker');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Buffer.from(digest).toString('base64');
    await expect(verifyBytes(bytes.buffer, hash)).resolves.toBeUndefined();
    await expect(verifyBytes(new TextEncoder().encode('modified worker').buffer, hash)).rejects.toThrow('integrity');
  });
});
