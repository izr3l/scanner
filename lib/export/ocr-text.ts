import type { OcrPage } from '@/lib/ocr/types';

/** Keep the review field and the PDF text in agreement, without hidden controls. */
export function normalizeOcrText(text: string): string {
  return Array.from(text.normalize('NFC').replace(/\r\n?/g, '\n'))
    .filter((character) => {
      const code = character.codePointAt(0)!;
      return character === '\n' || character === '\t' || (code >= 32 && code !== 127 && !(code >= 0x202a && code <= 0x202e) && !(code >= 0x2066 && code <= 0x2069));
    })
    .join('')
    .replace(/\t/g, '    ');
}

export function ocrPageText(page: OcrPage): string {
  return normalizeOcrText(page.text);
}
