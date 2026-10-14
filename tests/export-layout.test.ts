import { describe, expect, it } from 'vitest';
import { DEFAULT_ARRANGEMENT, DEFAULT_RECIPE, type ArrangeOptions, type Quad } from '../lib/types';
import { arrangePages, fitRect, recommendedOrientation } from '../lib/export/layout';
import { ID_CARD_MM, mmToPixels, mmToPoints, pageSizeMM } from '../lib/presets';
import { redactionPixels } from '../lib/export/redact';

const arrangement = (overrides: Partial<ArrangeOptions> = {}): ArrangeOptions => ({ ...DEFAULT_ARRANGEMENT, ...overrides });

describe('physical page layout', () => {
  it('gives a 300 DPI A4 sheet the correct raster and PDF dimensions', () => {
    expect(mmToPixels(210, 300)).toBe(2480);
    expect(mmToPixels(297, 300)).toBe(3508);
    expect(mmToPoints(210)).toBeCloseTo(595.27559, 4);
    expect(pageSizeMM(arrangement({ orientation: 'landscape' }))).toEqual({ width: 297, height: 210 });
  });

  it('centres fit without distortion and lets fill crop the long dimension', () => {
    const target = { x: 10, y: 10, width: 100, height: 100 };
    expect(fitRect({ width: 200, height: 100 }, target, 'fit')).toEqual({ x: 10, y: 35, width: 100, height: 50 });
    expect(fitRect({ width: 200, height: 100 }, target, 'fill')).toEqual({ x: -40, y: 10, width: 200, height: 100 });
  });

  it('prints two card sides on one A4 at ID-1 size, independent of export DPI', () => {
    const sources = [{ type: 'id' as const, width: 1600, height: 1009 }, { type: 'id' as const, width: 800, height: 504 }];
    const options = arrangement({ preset: 'letter', idCopy: true, cropMarks: true });
    for (const dpi of [150, 200, 300]) {
      const sheets = arrangePages(sources, options, dpi);
      expect(sheets).toHaveLength(1);
      expect(sheets[0].width).toBe(210);
      expect(sheets[0].height).toBe(297);
      const [front, back] = sheets[0].placements;
      expect(front.rect.width).toBe(ID_CARD_MM.width);
      expect(front.rect.height).toBe(ID_CARD_MM.height);
      expect(back.rect.width).toBe(ID_CARD_MM.width);
      expect(front.rect.x).toBeCloseTo((210 - 85.6) / 2);
      expect(back.rect.y - front.rect.y - front.rect.height).toBeCloseTo(12);
      expect(front.cropMarks).toBe(true);
    }
  });

  it('keeps an unpaired final card and never silently shrinks a true-size copy', () => {
    const source = { type: 'id' as const, width: 856, height: 540 };
    expect(arrangePages([source, source, source], arrangement({ idCopy: true }), 150).map((sheet) => sheet.placements.length)).toEqual([2, 1]);
    expect(() => arrangePages([source, source], arrangement({ idCopy: true, margin: 80 }), 150)).toThrow('true physical size');
  });

  it('rejects stale ID copy settings when other document types enter the session', () => {
    const sources = [{ type: 'id' as const, width: 856, height: 540 }, { type: 'document' as const, width: 1200, height: 1600 }];
    expect(() => arrangePages(sources, arrangement({ idCopy: true }), 300)).toThrow('ID card scans only');
  });

  it('uses actual ID and passport physical dimensions while retaining orientation', () => {
    const sources = [{ type: 'id' as const, width: 1600, height: 1009 }, { type: 'passport' as const, width: 880, height: 1250 }];
    const sheets = arrangePages(sources, arrangement({ fit: 'actual' }), 300);
    expect(sheets[0].placements[0].rect.width).toBe(85.6);
    expect(sheets[1].placements[0].rect.width).toBe(88);
    expect(sheets[1].placements[0].rect.height).toBe(125);
  });

  it('rejects non-finite and impractical custom sizes', () => {
    expect(() => pageSizeMM(arrangement({ preset: 'custom', customWidth: Number.NaN }))).toThrow();
    expect(() => pageSizeMM(arrangement({ preset: 'custom', customHeight: 1001 }))).toThrow();
  });
});

describe('auto orientation from flattened page geometry', () => {
  const cropped = { width: 2000, height: 2000, type: 'document' as const, corners: [{ x: 100, y: 100 }, { x: 1700, y: 100 }, { x: 1700, y: 1000 }, { x: 100, y: 1000 }] as Quad, recipe: { ...DEFAULT_RECIPE } };

  it('uses the crop instead of the original square frame', () => {
    expect(recommendedOrientation(cropped)).toBe('landscape');
  });

  it('flips the orientation at right-angle rotation, including negative and wrapped angles', () => {
    for (const rotation of [90, -90, 270, 450]) expect(recommendedOrientation({ ...cropped, recipe: { ...cropped.recipe, rotation } })).toBe('portrait');
    for (const rotation of [0, 180, 360, -180]) expect(recommendedOrientation({ ...cropped, recipe: { ...cropped.recipe, rotation } })).toBe('landscape');
  });

  it('accounts for fine rotation and ignores horizontal flip when choosing paper orientation', () => {
    expect(recommendedOrientation({ ...cropped, recipe: { ...cropped.recipe, rotation: 20, flipX: true } })).toBe('landscape');
    expect(recommendedOrientation({ ...cropped, recipe: { ...cropped.recipe, rotation: 70, flipX: true } })).toBe('portrait');
  });

  it('uses the locked ID aspect ratio before applying the edit rotation', () => {
    const verticalCapture = { ...cropped, type: 'id' as const, corners: [{ x: 100, y: 100 }, { x: 900, y: 100 }, { x: 900, y: 1500 }, { x: 100, y: 1500 }] as Quad };
    expect(recommendedOrientation(verticalCapture)).toBe('landscape');
    expect(recommendedOrientation({ ...verticalCapture, recipe: { ...cropped.recipe, rotation: 90 } })).toBe('portrait');
  });
});

describe('irreversible redaction pixel bounds', () => {
  it('covers every partially touched pixel after normalization', () => {
    expect(redactionPixels({ id: 'r', x: 0.105, y: 0.205, width: 0.301, height: 0.101 }, 100, 100)).toEqual({ x: 10, y: 20, width: 31, height: 11 });
  });

  it('clips out-of-range edits and supports a reverse-direction drag', () => {
    expect(redactionPixels({ id: 'r', x: 0.8, y: 0.9, width: -0.9, height: -1.2 }, 100, 200)).toEqual({ x: 0, y: 0, width: 80, height: 180 });
    expect(redactionPixels({ id: 'r', x: 2, y: 0, width: 1, height: 1 }, 100, 100)).toBeNull();
    expect(redactionPixels({ id: 'r', x: Number.NaN, y: 0, width: 1, height: 1 }, 100, 100)).toBeNull();
  });
});
