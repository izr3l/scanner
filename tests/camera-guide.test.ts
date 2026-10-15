import { describe, expect, it } from 'vitest';
import { CAPTURE_GUIDES, getCaptureGuide } from '../lib/camera-guide';
import type { ScanMode } from '../lib/types';

const ratios: [ScanMode, number][] = [
  ['id', 85.6 / 53.98],
  ['passport', 125 / 88],
  ['document', 210 / 297],
  ['book', 210 / 297],
  ['batch', 210 / 297],
];

const stages = [
  { name: 'portrait camera in a tall phone stage', stage: [390, 844], video: [1080, 1920], content: { x: 0, y: 75 + 1 / 3, width: 390, height: 693 + 1 / 3 } },
  { name: 'landscape camera without letterboxing', stage: [1280, 720], video: [1920, 1080], content: { x: 0, y: 0, width: 1280, height: 720 } },
  { name: 'landscape camera letterboxed on a phone', stage: [360, 640], video: [1920, 1080], content: { x: 0, y: 218.75, width: 360, height: 202.5 } },
  { name: 'portrait camera pillarboxed on desktop', stage: [1200, 500], video: [720, 1280], content: { x: 459.375, y: 0, width: 281.25, height: 500 } },
  { name: 'camera after a taller stage resize', stage: [600, 900], video: [1920, 1080], content: { x: 0, y: 281.25, width: 600, height: 337.5 } },
  { name: 'camera after a smaller stage resize', stage: [180, 320], video: [1280, 720], content: { x: 0, y: 109.375, width: 180, height: 101.25 } },
] as const;

describe('true-ratio camera placement guides', () => {
  it.each(ratios)('preserves the exact physical ratio for %s', (mode, ratio) => {
    expect(CAPTURE_GUIDES[mode].ratio).toBeCloseTo(ratio, 14);
    for (const fixture of stages) {
      const guide = getCaptureGuide(fixture.stage[0], fixture.stage[1], fixture.video[0], fixture.video[1], mode);
      expect(guide).not.toBeNull();
      expect(guide!.width / guide!.height).toBeCloseTo(ratio, 14);
    }
  });

  it.each(stages)('fits and centers every mode inside $name', ({ stage, video, content }) => {
    for (const [mode] of ratios) {
      const guide = getCaptureGuide(stage[0], stage[1], video[0], video[1], mode)!;
      expect(guide.width).toBeGreaterThan(0);
      expect(guide.height).toBeGreaterThan(0);
      expect(guide.x).toBeGreaterThanOrEqual(content.x);
      expect(guide.y).toBeGreaterThanOrEqual(content.y);
      expect(guide.x + guide.width).toBeLessThanOrEqual(content.x + content.width);
      expect(guide.y + guide.height).toBeLessThanOrEqual(content.y + content.height);
      expect(guide.x + guide.width / 2).toBeCloseTo(stage[0] / 2, 10);
      expect(guide.y + guide.height / 2).toBeCloseTo(stage[1] / 2, 10);
      // The outline reserves at least 9% per horizontal side and 14% vertically.
      const horizontalInset = (guide.x - content.x) / content.width;
      const verticalInset = (guide.y - content.y) / content.height;
      expect(horizontalInset).toBeGreaterThanOrEqual(0.09 - 1e-12);
      expect(verticalInset).toBeGreaterThanOrEqual(0.14 - 1e-12);
      // At least one inset is the intended limit rather than an arbitrary tiny box.
      expect(Math.min(Math.abs(horizontalInset - 0.09), Math.abs(verticalInset - 0.14))).toBeLessThan(1e-12);
    }
  });

  it('recomputes placement when the stage is resized without changing the camera', () => {
    const before = getCaptureGuide(360, 640, 1920, 1080, 'id')!;
    const after = getCaptureGuide(720, 1280, 1920, 1080, 'id')!;
    expect(after.x).toBeCloseTo(before.x * 2, 12);
    expect(after.y).toBeCloseTo(before.y * 2, 12);
    expect(after.width).toBeCloseTo(before.width * 2, 12);
    expect(after.height).toBeCloseTo(before.height * 2, 12);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])('rejects invalid size %s in each stage or video dimension', (invalid) => {
    for (let index = 0; index < 4; index++) {
      const dimensions: [number, number, number, number] = [390, 844, 1080, 1920];
      dimensions[index] = invalid;
      for (const [mode] of ratios) expect(getCaptureGuide(...dimensions, mode)).toBeNull();
    }
  });
});
