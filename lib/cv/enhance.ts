import type { Recipe } from '../types';
import type { CV, CVMat } from './runtime';

export interface Levels { low: number; high: number }

export function estimateLevels(rgba: CVMat): Levels {
  const histogram = new Uint32Array(256);
  const pixels = rgba.rows * rgba.cols;
  const data = rgba.data;
  for (let i = 0; i < data.length; i += 4) {
    const luma = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    histogram[luma]++;
  }
  let cumulative = 0, low = 0, high = 255;
  for (let i = 0; i < 256; i++) {
    cumulative += histogram[i];
    if (cumulative >= pixels * 0.02) { low = i; break; }
  }
  cumulative = 0;
  for (let i = 255; i >= 0; i--) {
    cumulative += histogram[i];
    if (cumulative >= pixels * 0.01) { high = i; break; }
  }
  // Flat pages should stay flat; extreme stretching turns sensor noise into ink.
  if (high - low < 60) return { low: 0, high: 255 };
  return { low, high };
}

export function enhance(cv: CV, source: CVMat, recipe: Recipe, levels: Levels): CVMat {
  // Embind's generic clone() can clone the handle rather than the pixel buffer.
  // copyTo guarantees a deep pixel copy across the pinned runtime versions.
  let result = new cv.Mat();
  source.copyTo(result);
  const temporaries: CVMat[] = [];
  const temporary = () => { const mat = new cv.Mat(); temporaries.push(mat); return mat; };
  try {
    if (recipe.filter === 'grayscale' || recipe.filter === 'document' || recipe.filter === 'bw') {
      const gray = temporary();
      cv.cvtColor(result, gray, cv.COLOR_RGBA2GRAY);
      if (recipe.filter === 'document' || recipe.filter === 'bw') {
        const background = temporary(), normalized = temporary(), threshold = temporary();
        const small = temporary(), smallBackground = temporary();
        // Shadows vary slowly. Estimate them at quarter scale (13px ≈51px),
        // retaining all original pixels for text and the final output.
        cv.resize(gray, small, new cv.Size(Math.max(2, Math.round(gray.cols / 4)), Math.max(2, Math.round(gray.rows / 4))), 0, 0, cv.INTER_AREA);
        cv.GaussianBlur(small, smallBackground, new cv.Size(13, 13), 0, 0, cv.BORDER_REPLICATE);
        cv.resize(smallBackground, background, new cv.Size(gray.cols, gray.rows), 0, 0, cv.INTER_LINEAR);
        cv.divide(gray, background, normalized, 255);
        cv.adaptiveThreshold(normalized, threshold, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, 31, recipe.filter === 'bw' ? 10 : 14);
        if (recipe.filter === 'document') cv.addWeighted(normalized, 0.70, threshold, 0.30, 0, gray);
        else threshold.copyTo(gray);
      }
      cv.cvtColor(gray, result, cv.COLOR_GRAY2RGBA);
    }
    const brightness = Math.max(-100, Math.min(100, recipe.brightness)) * 1.8;
    const contrast = Math.max(-100, Math.min(100, recipe.contrast));
    const factor = (259 * (contrast * 2.55 + 255)) / (255 * (259 - contrast * 2.55));
    const auto = recipe.filter === 'auto';
    const stretch = auto ? Math.min(1.8, 255 / Math.max(60, levels.high - levels.low)) : 1;
    const offset = auto ? levels.low : 0;
    const boost = recipe.filter === 'color';
    const pixels = result.data;
    for (let i = 0; (auto || boost || brightness !== 0 || contrast !== 0) && i < pixels.length; i += 4) {
      let r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      if (boost) {
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = luma + (r - luma) * 1.25;
        g = luma + (g - luma) * 1.25;
        b = luma + (b - luma) * 1.25;
      }
      pixels[i] = clamp(((r - offset) * stretch - 128) * factor + 128 + brightness);
      pixels[i + 1] = clamp(((g - offset) * stretch - 128) * factor + 128 + brightness);
      pixels[i + 2] = clamp(((b - offset) * stretch - 128) * factor + 128 + brightness);
      pixels[i + 3] = 255;
    }
    const sharpness = Math.max(0, Math.min(100, recipe.sharpness)) / 100;
    if (sharpness > 0) {
      const blurred = temporary(), sharpened = new cv.Mat();
      try {
        cv.GaussianBlur(result, blurred, new cv.Size(0, 0), 1);
        cv.addWeighted(result, 1 + sharpness * 1.5, blurred, -sharpness * 1.5, 0, sharpened);
        result.delete();
        result = sharpened;
      } catch (error) { sharpened.delete(); throw error; }
    }
    return result;
  } catch (error) {
    result.delete();
    throw error;
  } finally {
    for (const mat of temporaries) mat.delete();
  }
}

function clamp(value: number): number { return Math.max(0, Math.min(255, Math.round(value))); }
