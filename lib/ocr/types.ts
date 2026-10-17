export type OcrLanguage = 'eng' | 'fra' | 'eng+fra';

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** Coordinates refer to the final, redacted sheet, before any watermark. */
export interface OcrPage {
  text: string;
  confidence: number;
  width: number;
  height: number;
  words: OcrWord[];
}

export interface OcrProgress {
  page: number;
  total: number;
  status: string;
  progress: number;
}
