import { PDFDocument } from 'pdf-lib';
import { mmToPoints } from '@/lib/presets';

export type PdfSheet = { blob: Blob; width: number; height: number };

/** PDFs contain fresh flattened rasters only; no original image or reversible overlays. */
export async function createPdf(sheets: PdfSheet[]): Promise<Blob> {
  const document = await PDFDocument.create({ updateMetadata: false });
  document.setAuthor('');
  document.setCreator('');
  document.setProducer('');
  document.setTitle('');
  document.setSubject('');
  document.setKeywords([]);
  for (const sheet of sheets) {
    const image = await document.embedPng(await sheet.blob.arrayBuffer());
    const width = mmToPoints(sheet.width);
    const height = mmToPoints(sheet.height);
    document.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
  }
  const bytes = await document.save({ useObjectStreams: true });
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}
