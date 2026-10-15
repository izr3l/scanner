import type { ScanMode } from './types';

export const CAPTURE_GUIDES: Record<ScanMode, { ratio: number; label: string; instruction: string }> = {
  document: { ratio: 210 / 297, label: 'Document', instruction: 'Fit the whole page inside the outline' },
  id: { ratio: 85.6 / 53.98, label: 'ID card · 85.6 × 53.98 mm', instruction: 'Fit the whole card inside the outline' },
  passport: { ratio: 125 / 88, label: 'Passport · 125 × 88 mm', instruction: 'Fit the photo page inside the outline' },
  book: { ratio: 210 / 297, label: 'Book page', instruction: 'Fit one page inside the outline' },
  batch: { ratio: 210 / 297, label: 'Batch · one page at a time', instruction: 'Fit the whole page inside the outline' },
};

/** Fit a true-ratio placement outline inside the visible, object-fit:contain video. */
export function getCaptureGuide(stageWidth: number, stageHeight: number, videoWidth: number, videoHeight: number, mode: ScanMode) {
  if (![stageWidth, stageHeight, videoWidth, videoHeight].every((size) => Number.isFinite(size) && size > 0)) return null;
  const scale = Math.min(stageWidth / videoWidth, stageHeight / videoHeight);
  const contentWidth = videoWidth * scale;
  const contentHeight = videoHeight * scale;
  const ratio = CAPTURE_GUIDES[mode].ratio;
  const width = Math.min(contentWidth * 0.82, contentHeight * 0.72 * ratio);
  const height = width / ratio;
  return { x: (stageWidth - width) / 2, y: (stageHeight - height) / 2, width, height };
}
