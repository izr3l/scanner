import type { ArrangeOptions, ScanPage } from '@/lib/types';
import { ID_CARD_MM, PASSPORT_MM, pageSizeMM, pixelsToMM } from '@/lib/presets';
import { warpGeometry } from '@/lib/cv/geometry';

export type Rect = { x: number; y: number; width: number; height: number };
export type PageSource = Pick<ScanPage, 'type'> & { width: number; height: number };
export type Placement = { sourceIndex: number; rect: Rect; clip: Rect; cropMarks: boolean };
export type SheetLayout = { width: number; height: number; placements: Placement[] };

/** Recommend from the actual flattened/rotated output, rather than the source camera frame. */
export function recommendedOrientation(page: Pick<ScanPage, 'corners' | 'type' | 'width' | 'height' | 'recipe'>): ArrangeOptions['orientation'] {
  const { width, height } = warpGeometry(page.corners, page.type, page.width, page.height);
  const rotation = Number.isFinite(page.recipe.rotation) ? ((page.recipe.rotation % 360) + 360) % 360 : 0;
  const radians = rotation * Math.PI / 180;
  const absCos = Math.abs(Math.cos(radians));
  const absSin = Math.abs(Math.sin(radians));
  const cosine = absCos < 1e-10 ? 0 : absCos;
  const sine = absSin < 1e-10 ? 0 : absSin;
  const renderedWidth = Math.ceil(width * cosine + height * sine);
  const renderedHeight = Math.ceil(height * cosine + width * sine);
  return renderedWidth > renderedHeight ? 'landscape' : 'portrait';
}

export function fitRect(source: { width: number; height: number }, target: Rect, fit: ArrangeOptions['fit'], actualSize: { width: number; height: number } = source): Rect {
  if (source.width <= 0 || source.height <= 0) throw new Error('The scan has invalid dimensions.');
  const scale = fit === 'actual' ? 1 : fit === 'fill'
    ? Math.max(target.width / source.width, target.height / source.height)
    : Math.min(target.width / source.width, target.height / source.height);
  const width = fit === 'actual' ? actualSize.width : source.width * scale;
  const height = fit === 'actual' ? actualSize.height : source.height * scale;
  return { x: target.x + (target.width - width) / 2, y: target.y + (target.height - height) / 2, width, height };
}

function physicalSize(source: PageSource, dpi: number) {
  const size = source.type === 'id' ? ID_CARD_MM : source.type === 'passport' ? PASSPORT_MM : null;
  if (!size) return { width: pixelsToMM(source.width, dpi), height: pixelsToMM(source.height, dpi) };
  return source.width >= source.height ? size : { width: size.height, height: size.width };
}

/** All sheet and placement dimensions are millimetres, independent of raster DPI. */
export function arrangePages(sources: PageSource[], options: ArrangeOptions, dpi: number): SheetLayout[] {
  const size = pageSizeMM(options);
  const margin = Math.max(0, Math.min(Number.isFinite(options.margin) ? options.margin : 0, (Math.min(size.width, size.height) - 1) / 2));
  const clip = { x: margin, y: margin, width: size.width - margin * 2, height: size.height - margin * 2 };
  if (options.idCopy) {
    if (sources.some((source) => source.type !== 'id')) throw new Error('ID copy layout supports ID card scans only. Choose a regular page layout for documents or passports.');
    const layouts: SheetLayout[] = [];
    for (let start = 0; start < sources.length; start += 2) {
      const count = Math.min(2, sources.length - start);
      const horizontal = options.orientation === 'landscape';
      const gap = 12;
      const sizes = sources.slice(start, start + count).map((source) => source.width >= source.height
        ? { ...ID_CARD_MM }
        : { width: ID_CARD_MM.height, height: ID_CARD_MM.width });
      const groupWidth = horizontal ? sizes.reduce((total, size) => total + size.width, 0) + gap * (count - 1) : Math.max(...sizes.map((size) => size.width));
      const groupHeight = horizontal ? Math.max(...sizes.map((size) => size.height)) : sizes.reduce((total, size) => total + size.height, 0) + gap * (count - 1);
      // True-size cards must never silently shrink when an excessive margin is chosen.
      if (groupWidth > clip.width || groupHeight > clip.height) throw new Error('Reduce the margin to fit the ID cards at their true physical size.');
      const placements: Placement[] = [];
      let advance = 0;
      for (let position = 0; position < count; position++) {
        const cardSize = sizes[position];
        const rect = {
          x: (size.width - groupWidth) / 2 + (horizontal ? advance : (groupWidth - cardSize.width) / 2),
          y: (size.height - groupHeight) / 2 + (!horizontal ? advance : (groupHeight - cardSize.height) / 2),
          ...cardSize,
        };
        placements.push({ sourceIndex: start + position, rect, clip, cropMarks: options.cropMarks });
        advance += (horizontal ? cardSize.width : cardSize.height) + gap;
      }
      layouts.push({ ...size, placements });
    }
    return layouts;
  }
  return sources.map((source, sourceIndex) => ({
    ...size,
    placements: [{ sourceIndex, rect: fitRect(source, clip, options.fit, physicalSize(source, dpi)), clip, cropMarks: options.cropMarks }],
  }));
}
