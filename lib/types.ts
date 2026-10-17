export type ScanMode = 'document' | 'id' | 'passport' | 'book' | 'batch';
export interface Point { x: number; y: number }
export type Quad = [Point, Point, Point, Point];
export type ScanFilter = 'original' | 'auto' | 'document' | 'bw' | 'grayscale' | 'color';
export type ScannedPaperSize = 'original' | 'a4' | 'letter' | 'a5';
export interface Recipe {
  filter: ScanFilter;
  brightness: number;
  contrast: number;
  sharpness: number;
  rotation: number;
  flipX: boolean;
  paperSize?: ScannedPaperSize;
}
export interface Redaction { id: string; x: number; y: number; width: number; height: number }
export interface ScanPage {
  id: string;
  type: ScanMode;
  createdAt: number;
  original: Blob;
  width: number;
  height: number;
  corners: Quad;
  recipe: Recipe;
  redactions: Redaction[];
}
export interface DetectionResult {
  corners: Quad;
  width: number;
  height: number;
  confidence: number;
  fallback: boolean;
  quality: { blur: boolean; glare: boolean; lowLight: boolean };
}
export interface ArrangeOptions {
  preset: 'a4' | 'letter' | 'a5' | 'id' | 'passport' | 'custom';
  orientation: 'auto' | 'portrait' | 'landscape';
  margin: number;
  fit: 'fit' | 'fill' | 'actual';
  customWidth: number;
  customHeight: number;
  idCopy: boolean;
  cropMarks: boolean;
}
export interface ExportOptions {
  format: 'pdf' | 'png' | 'jpeg' | 'webp';
  pdfMode?: 'scan' | 'searchable' | 'text';
  ocrLanguage?: import('./ocr/types').OcrLanguage;
  dpi: 150 | 200 | 300;
  quality: number;
  filename: string;
  watermark: string;
  arrangement: ArrangeOptions;
}
export interface ExportResult { blob: Blob; filename: string; pageCount: number }
export const DEFAULT_RECIPE: Recipe = { filter: 'auto', brightness: 0, contrast: 0, sharpness: 0, rotation: 0, flipX: false, paperSize: 'original' };
export const DEFAULT_ARRANGEMENT: ArrangeOptions = { preset: 'a4', orientation: 'auto', margin: 0, fit: 'fit', customWidth: 210, customHeight: 297, idCopy: false, cropMarks: false };
export const MODE_LABELS: Record<ScanMode, string> = { document: 'Document', id: 'ID card', passport: 'Passport', book: 'Book', batch: 'Batch' };
