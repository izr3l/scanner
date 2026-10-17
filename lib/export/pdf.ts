import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, TextRenderingMode, degrees, popGraphicsState, pushGraphicsState, rgb, setCharacterSqueeze, setTextRenderingMode, type PDFFont, type PDFPage } from 'pdf-lib';
import type { OcrPage } from '@/lib/ocr/types';
import { ASSET_INTEGRITY } from '@/lib/asset-integrity';
import { verifyBytes } from '@/lib/cv/protocol';
import { mmToPoints } from '@/lib/presets';
import { normalizeOcrText, ocrPageText } from './ocr-text';

export type PdfSheet = { blob: Blob; width: number; height: number };
export type PdfOcrOptions = {
  mode: 'scan' | 'searchable' | 'text';
  ocrPages?: OcrPage[];
  margin?: number;
  watermark?: string;
  /** Optional bytes make the encoder usable outside a browser, including verification. */
  fontBytes?: Uint8Array;
};

function freshDocument(): Promise<PDFDocument> {
  return PDFDocument.create({ updateMetadata: false }).then((document) => {
    document.setAuthor('');
    document.setCreator('');
    document.setProducer('');
    document.setTitle('');
    document.setSubject('');
    document.setKeywords([]);
    return document;
  });
}

async function embedOcrFont(document: PDFDocument, supplied?: Uint8Array): Promise<PDFFont> {
  document.registerFontkit(fontkit);
  let bytes = supplied;
  if (!bytes) {
    const response = await fetch('/ocr/LiberationSans-Regular.ttf');
    if (!response.ok) throw new Error('The local OCR font could not be loaded. Reload the app and try again.');
    const fontBytes = await response.arrayBuffer();
    await verifyBytes(fontBytes, ASSET_INTEGRITY['/ocr/LiberationSans-Regular.ttf']);
    bytes = new Uint8Array(fontBytes);
  }
  return document.embedFont(bytes, { subset: true });
}

function supportedText(text: string, characters: Set<number>): string {
  const normalized = normalizeOcrText(text);
  const unsupported = Array.from(normalized).find((character) => character !== '\n' && !characters.has(character.codePointAt(0)!));
  if (unsupported) throw new Error(`The PDF font cannot display “${unsupported}”. Edit this character in the text review before exporting.`);
  return normalized;
}

function addSearchableText(page: PDFPage, result: OcrPage, font: PDFFont, characters: Set<number>): void {
  if (!Number.isFinite(result.width) || !Number.isFinite(result.height) || result.width <= 0 || result.height <= 0) {
    throw new Error('The recognized page has invalid dimensions. Recognize the text again.');
  }
  const { width, height } = page.getSize();
  const scaleX = width / result.width;
  const scaleY = height / result.height;
  for (const word of result.words) {
    const text = supportedText(word.text, characters).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const { x0, y0, x1, y1 } = word.bbox;
    if (![x0, y0, x1, y1].every(Number.isFinite) || x0 < 0 || y0 < 0 || x1 > result.width || y1 > result.height || x1 <= x0 || y1 <= y0) continue;
    const boxHeight = (y1 - y0) * scaleY;
    const size = boxHeight / font.heightAtSize(1, { descender: false });
    const textWidth = font.widthOfTextAtSize(text, size);
    if (!textWidth) continue;
    // OCR coordinates start at the top left. PDF coordinates start at the bottom left.
    // Invisible text occupies each recognized word box, so search and copy follow the scan.
    page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible), setCharacterSqueeze(((x1 - x0) * scaleX / textWidth) * 100));
    page.drawText(text, { font, size, x: x0 * scaleX, y: height - y1 * scaleY });
    page.pushOperators(popGraphicsState());
  }
}

function wrapLine(text: string, font: PDFFont, size: number, width: number): string[] {
  if (!text.trim()) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/u)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
      continue;
    }
    if (line) { lines.push(line); line = ''; }
    // Long URLs and words must wrap too; iterating code points preserves surrogate pairs.
    for (const character of Array.from(word)) {
      if (line && font.widthOfTextAtSize(line + character, size) > width) {
        lines.push(line);
        line = character;
      } else line += character;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawTextWatermark(page: PDFPage, label: string, font: PDFFont, characters: Set<number>): void {
  const text = supportedText(label.trim().slice(0, 120), characters).replace(/\s+/g, ' ');
  if (!text) return;
  const { width, height } = page.getSize();
  const size = Math.min(Math.min(width, height) / 17, width * 0.75 / Math.max(1, font.widthOfTextAtSize(text, 1)));
  const textWidth = font.widthOfTextAtSize(text, size);
  const angle = Math.PI / 6;
  page.drawText(text, { font, size, x: width / 2 - textWidth * Math.cos(angle) / 2, y: height / 2 - textWidth * Math.sin(angle) / 2, rotate: degrees(30), color: rgb(0.07, 0.1, 0.15), opacity: 0.16 });
}

function addTextPages(document: PDFDocument, sheet: PdfSheet, result: OcrPage, options: PdfOcrOptions, font: PDFFont, characters: Set<number>): void {
  const width = mmToPoints(sheet.width), height = mmToPoints(sheet.height);
  // Use a comfortable reading margin even when the scan's page arrangement has none.
  const requestedMargin = mmToPoints(Math.max(12, Number.isFinite(options.margin) ? options.margin! : 18));
  const margin = Math.min(requestedMargin, width * 0.15, height * 0.15);
  const size = Math.min(12, Math.max(7, (width - margin * 2) / 25));
  const lineHeight = size * 1.5;
  const usableWidth = width - margin * 2;
  const lines = supportedText(ocrPageText(result), characters).split('\n').flatMap((line) => wrapLine(line, font, size, usableWidth));
  const nextPage = () => {
    if (document.getPageCount() >= 500) throw new Error('The clean text PDF exceeds 500 pages. Shorten the reviewed text or export fewer scans.');
    return document.addPage([width, height]);
  };
  let page = nextPage();
  let y = height - margin - size;
  const decorate = () => drawTextWatermark(page, options.watermark ?? '', font, characters);
  for (const line of lines) {
    if (y < margin) {
      decorate();
      page = nextPage();
      y = height - margin - size;
    }
    if (line) page.drawText(line, { font, size, x: margin, y, color: rgb(0.07, 0.08, 0.1) });
    y -= lineHeight;
  }
  decorate();
}

/** Each mode creates a fresh document. Text mode embeds no original or raster images. */
export async function createPdfExport(sheets: PdfSheet[], options: PdfOcrOptions = { mode: 'scan' }): Promise<{ blob: Blob; pageCount: number }> {
  if (!sheets.length) throw new Error('Add at least one scan before exporting.');
  if (options.mode !== 'scan' && options.ocrPages?.length !== sheets.length) throw new Error('Recognize and review every page before exporting this PDF.');
  const document = await freshDocument();
  const font = options.mode === 'scan' ? undefined : await embedOcrFont(document, options.fontBytes);
  const characters = new Set(font?.getCharacterSet() ?? []);
  for (let index = 0; index < sheets.length; index++) {
    const sheet = sheets[index];
    if (![sheet.width, sheet.height].every((dimension) => Number.isFinite(dimension) && dimension > 0)) throw new Error('The PDF page size is invalid.');
    if (options.mode === 'text') {
      addTextPages(document, sheet, options.ocrPages![index], options, font!, characters);
      continue;
    }
    const image = await document.embedPng(await sheet.blob.arrayBuffer());
    const width = mmToPoints(sheet.width), height = mmToPoints(sheet.height);
    const page = document.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
    if (options.mode === 'searchable') addSearchableText(page, options.ocrPages![index], font!, characters);
  }
  const bytes = await document.save({ useObjectStreams: true });
  return { blob: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), pageCount: document.getPageCount() };
}

/** The default stays a flattened raster PDF with blank identification metadata. */
export async function createPdf(sheets: PdfSheet[], options?: PdfOcrOptions): Promise<Blob> {
  return (await createPdfExport(sheets, options)).blob;
}
