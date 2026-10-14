import type { ArrangeOptions } from '@/lib/types';
export { DEFAULT_ARRANGEMENT } from '@/lib/types';

export const MM_PER_INCH = 25.4;
export const POINTS_PER_INCH = 72;
export const ID_CARD_MM = { width: 85.6, height: 53.98 } as const;
export const PASSPORT_MM = { width: 125, height: 88 } as const;

export const PAGE_PRESETS = {
  a4: { label: 'A4', width: 210, height: 297 },
  letter: { label: 'Letter', width: 215.9, height: 279.4 },
  a5: { label: 'A5', width: 148, height: 210 },
  id: { label: 'ID-1', ...ID_CARD_MM },
  passport: { label: 'Passport', ...PASSPORT_MM },
} as const;

export function mmToPixels(mm: number, dpi: number): number {
  return Math.max(1, Math.round((mm / MM_PER_INCH) * dpi));
}

export function pixelsToMM(pixels: number, dpi: number): number {
  return (pixels / dpi) * MM_PER_INCH;
}

export function mmToPoints(mm: number): number {
  return (mm / MM_PER_INCH) * POINTS_PER_INCH;
}

export function pageSizeMM(options: ArrangeOptions): { width: number; height: number } {
  const preset = options.idCopy
    ? PAGE_PRESETS.a4
    : options.preset === 'custom'
      ? { width: options.customWidth, height: options.customHeight }
      : PAGE_PRESETS[options.preset];
  if (!Number.isFinite(preset.width) || !Number.isFinite(preset.height) || preset.width < 10 || preset.height < 10 || preset.width > 1000 || preset.height > 1000) {
    throw new Error('Page dimensions must be between 10 and 1,000 mm.');
  }
  const shorter = Math.min(preset.width, preset.height);
  const longer = Math.max(preset.width, preset.height);
  return options.orientation === 'landscape'
    ? { width: longer, height: shorter }
    : { width: shorter, height: longer };
}

export function recommendOrientation(width: number, height: number): ArrangeOptions['orientation'] {
  return width > height ? 'landscape' : 'portrait';
}
