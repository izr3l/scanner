import { describe, expect, it } from 'vitest';
import { warpGeometry } from '../lib/cv/geometry';
import { arrangePages, recommendedOrientation } from '../lib/export/layout';
import { DEFAULT_ARRANGEMENT, DEFAULT_RECIPE, type Quad, type ScannedPaperSize } from '../lib/types';

// A tilted portrait sheet whose photographed edge lengths imply the wrong aspect.
const corners: Quad = [{ x: 190, y: 180 }, { x: 1380, y: 290 }, { x: 1260, y: 1660 }, { x: 270, y: 1580 }];

describe('known scanned-paper proportions', () => {
  it.each([['a4', 210 / 297], ['a5', 148 / 210], ['letter', 215.9 / 279.4]] as const)('rectifies %s independently of photographed edge lengths', (paper, ratio) => {
    const geometry = warpGeometry(corners, 'document', 1800, 2000, paper);
    expect(geometry.width / geometry.height).toBeCloseTo(ratio, 3);
    expect(geometry.corners).toEqual(corners);
    expect(geometry.height).toBeGreaterThan(1300);
  });

  it('preserves unconstrained scan shapes until a paper size is chosen', () => {
    const original = warpGeometry(corners, 'document', 1800, 2000);
    expect(original).toEqual(warpGeometry(corners, 'document', 1800, 2000, 'original'));
    expect(Math.abs(original.width / original.height - 210 / 297)).toBeGreaterThan(0.1);
    const receipt: Quad = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 1600 }, { x: 100, y: 1600 }];
    const result = warpGeometry(receipt, 'document', 1800, 2000);
    expect(result.width / result.height).toBeCloseTo(200 / 1500, 6);
  });

  it('keeps a landscape sheet landscape before subsequent rotation edits', () => {
    const landscape: Quad = [{ x: 100, y: 100 }, { x: 1600, y: 170 }, { x: 1500, y: 1150 }, { x: 180, y: 1100 }];
    const result = warpGeometry(landscape, 'book', 1800, 1600, 'a4');
    expect(result.width / result.height).toBeCloseTo(297 / 210, 3);
    const page = { type: 'book' as const, width: 1800, height: 1600, corners: landscape, recipe: { ...DEFAULT_RECIPE, paperSize: 'a4' as ScannedPaperSize } };
    expect(recommendedOrientation(page)).toBe('landscape');
    expect(recommendedOrientation({ ...page, recipe: { ...page.recipe, rotation: 90 } })).toBe('portrait');
  });

  it('keeps ID and passport physical ratios when a generic paper recipe is present', () => {
    for (const [mode, ratio] of [['id', 85.6 / 53.98], ['passport', 125 / 88]] as const) {
      const result = warpGeometry(corners, mode, 1800, 2000, 'a4');
      expect(result.width / result.height).toBeCloseTo(ratio, 3);
    }
  });
});

describe('automatic paper placement', () => {
  it('starts with no extra border and follows each rendered sheet orientation', () => {
    expect(DEFAULT_ARRANGEMENT.margin).toBe(0);
    expect(DEFAULT_ARRANGEMENT.orientation).toBe('auto');
    const sheets = arrangePages([{ type: 'document', width: 2100, height: 2970 }, { type: 'document', width: 2970, height: 2100 }], DEFAULT_ARRANGEMENT, 200);
    expect(sheets.map(({ width, height }) => [width, height])).toEqual([[210, 297], [297, 210]]);
    for (const sheet of sheets) {
      const rect = sheet.placements[0].rect;
      expect(rect.x).toBeCloseTo(0, 6);
      expect(rect.y).toBeCloseTo(0, 6);
      expect(rect.width).toBeCloseTo(sheet.width, 6);
      expect(rect.height).toBeCloseTo(sheet.height, 6);
    }
  });

  it('preserves explicit paper orientation and user margins without stretching or clipping', () => {
    const options = { ...DEFAULT_ARRANGEMENT, orientation: 'portrait' as const, margin: 10 };
    const source = { type: 'document' as const, width: 2970, height: 2100 };
    const [sheet] = arrangePages([source], options, 200);
    expect([sheet.width, sheet.height]).toEqual([210, 297]);
    const placement = sheet.placements[0];
    expect(placement.rect.width / placement.rect.height).toBeCloseTo(source.width / source.height, 6);
    expect(placement.rect.x).toBeCloseTo(10, 6);
    expect(placement.rect.y).toBeGreaterThan(10);
    expect(options).toEqual({ ...DEFAULT_ARRANGEMENT, orientation: 'portrait', margin: 10 });
  });

  it('centres a receipt with legitimate white space instead of stretching it to A4', () => {
    const [sheet] = arrangePages([{ type: 'batch', width: 200, height: 1500 }], DEFAULT_ARRANGEMENT, 200);
    const rect = sheet.placements[0].rect;
    expect(rect.width / rect.height).toBeCloseTo(200 / 1500, 6);
    expect(rect.height).toBe(297);
    expect(rect.x).toBeCloseTo((210 - rect.width) / 2, 6);
  });

  it('keeps ID-copy pairs on A4 and prints exact physical sizes at every DPI', () => {
    for (const dpi of [150, 200, 300]) {
      const [sheet] = arrangePages([{ type: 'id', width: 856, height: 540 }, { type: 'id', width: 856, height: 540 }], { ...DEFAULT_ARRANGEMENT, idCopy: true }, dpi);
      expect([sheet.width, sheet.height]).toEqual([210, 297]);
      expect(sheet.placements.map(({ rect }) => [rect.width, rect.height])).toEqual([[85.6, 53.98], [85.6, 53.98]]);
    }
  });

  it('uses the declared paper dimensions for Actual size regardless of image pixels or export DPI', () => {
    for (const dpi of [150, 200, 300]) {
      const [sheet] = arrangePages([{ type: 'document', width: 700, height: 990, paperSize: 'a4' }], { ...DEFAULT_ARRANGEMENT, fit: 'actual' }, dpi);
      expect(sheet.placements[0].rect).toEqual({ x: 0, y: 0, width: 210, height: 297 });
      const [rotated] = arrangePages([{ type: 'document', width: 990, height: 700, paperSize: 'a4' }], { ...DEFAULT_ARRANGEMENT, fit: 'actual' }, dpi);
      expect(rotated.placements[0].rect).toEqual({ x: 0, y: 0, width: 297, height: 210 });
    }
  });
});
