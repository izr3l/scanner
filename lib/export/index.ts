import type { ExportOptions, ExportResult, ScanPage } from '@/lib/types';
import { mmToPixels, pageSizeMM } from '@/lib/presets';
import { arrangePages, type Placement, type SheetLayout } from './layout';
import { encodeImage } from './image';
import type { PdfSheet } from './pdf';
import { burnRedactions } from './redact';
import { canvasBlob, canvasContext, loadPixels, makeCanvas, releaseCanvas } from './strip';
import { drawWatermark } from './watermark';

export type { ExportResult } from '@/lib/types';

function ensurePages(pages: ScanPage[]) {
  if (!pages.length) throw new Error('Add at least one scan before exporting.');
  if (pages.length > 50) throw new Error('Export up to 50 pages at a time.');
}

function dateLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function exportFilename(pages: ScanPage[], options: ExportOptions, pageNumber?: number): string {
  const template = options.filename.trim() || '{type}-{date}';
  let name = template.replaceAll('{type}', pages[0]?.type || 'document').replaceAll('{date}', dateLabel(pages[0]?.createdAt ?? Date.now()));
  name = name.replace(/\.(?:pdf|png|jpe?g|webp)$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/^\.+|\.+$/g, '').slice(0, 100).trim() || 'scan';
  const extension = options.format === 'jpeg' ? 'jpg' : options.format;
  return `${name}${pageNumber === undefined ? '' : `-${String(pageNumber).padStart(2, '0')}`}.${extension}`;
}

function drawCropMarks(context: CanvasRenderingContext2D, placement: Placement, scaleX: number, scaleY: number) {
  const { x, y, width, height } = placement.rect;
  const distance = 1.5;
  const length = 3.5;
  context.save();
  context.strokeStyle = '#333333';
  context.lineWidth = Math.max(0.75, scaleX * 0.16);
  context.beginPath();
  for (const [cornerX, cornerY, directionX, directionY] of [
    [x, y, -1, -1], [x + width, y, 1, -1],
    [x + width, y + height, 1, 1], [x, y + height, -1, 1],
  ]) {
    context.moveTo((cornerX + directionX * distance) * scaleX, cornerY * scaleY);
    context.lineTo((cornerX + directionX * (distance + length)) * scaleX, cornerY * scaleY);
    context.moveTo(cornerX * scaleX, (cornerY + directionY * distance) * scaleY);
    context.lineTo(cornerX * scaleX, (cornerY + directionY * (distance + length)) * scaleY);
  }
  context.stroke();
  context.restore();
}

async function renderSheet(pages: ScanPage[], options: ExportOptions, preview: boolean): Promise<{ canvas: HTMLCanvasElement; layout: SheetLayout }> {
  const { renderPage } = await import('@/lib/cv/client');
  const images: HTMLCanvasElement[] = [];
  let output: HTMLCanvasElement | undefined;
  try {
    for (const page of pages) {
      // Always render from the full edit recipe, then flatten security edits into pixels.
      const blob = await renderPage(page);
      const pixels = await loadPixels(blob);
      let image: HTMLCanvasElement | undefined;
      try {
        image = makeCanvas(pixels.width, pixels.height);
        images.push(image);
        const context = canvasContext(image);
        context.drawImage(pixels.source, 0, 0);
        burnRedactions(context, page.redactions);
      } finally {
        pixels.release();
      }
    }
    const sources = images.map((image, index) => ({ type: pages[index].type, width: image.width, height: image.height }));
    const layout = arrangePages(sources, options.arrangement, options.dpi)[0];
    const width = mmToPixels(layout.width, options.dpi);
    const height = mmToPixels(layout.height, options.dpi);
    const previewScale = preview ? Math.min(1, 1400 / Math.max(width, height)) : 1;
    output = makeCanvas(width * previewScale, height * previewScale);
    const context = canvasContext(output);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, output.width, output.height);
    const scaleX = output.width / layout.width;
    const scaleY = output.height / layout.height;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    for (const placement of layout.placements) {
      const image = images[placement.sourceIndex];
      const { rect, clip } = placement;
      context.save();
      context.beginPath();
      context.rect(clip.x * scaleX, clip.y * scaleY, clip.width * scaleX, clip.height * scaleY);
      context.clip();
      context.drawImage(image, rect.x * scaleX, rect.y * scaleY, rect.width * scaleX, rect.height * scaleY);
      context.restore();
      if (placement.cropMarks) drawCropMarks(context, placement, scaleX, scaleY);
    }
    drawWatermark(context, options.watermark);
    return { canvas: output, layout };
  } catch (error) {
    if (output) releaseCanvas(output);
    throw error;
  } finally {
    for (const image of images) releaseCanvas(image);
  }
}

function groupPages(pages: ScanPage[], options: ExportOptions): ScanPage[][] {
  const count = options.arrangement.idCopy ? 2 : 1;
  const groups: ScanPage[][] = [];
  for (let start = 0; start < pages.length; start += count) groups.push(pages.slice(start, start + count));
  return groups;
}

export async function renderArrangedPreview(pages: ScanPage[], options: ExportOptions): Promise<Blob> {
  ensurePages(pages);
  const { canvas } = await renderSheet(groupPages(pages, options)[0], options, true);
  try { return await canvasBlob(canvas); }
  finally { releaseCanvas(canvas); }
}

/** Image formats yield one file per arranged sheet, preserving every scan without an archive. */
export async function createImageExports(pages: ScanPage[], options: ExportOptions): Promise<ExportResult[]> {
  ensurePages(pages);
  if (options.format === 'pdf') throw new Error('Use PDF export to create a multi-page document.');
  const groups = groupPages(pages, options);
  const results: ExportResult[] = [];
  for (let index = 0; index < groups.length; index++) {
    const { canvas } = await renderSheet(groups[index], options, false);
    try {
      const blob = await encodeImage(canvas, options.format, options.quality, options.dpi);
      results.push({ blob, filename: exportFilename(pages, options, groups.length > 1 ? index + 1 : undefined), pageCount: 1 });
    } finally { releaseCanvas(canvas); }
  }
  return results;
}

export async function createExport(pages: ScanPage[], options: ExportOptions): Promise<ExportResult> {
  ensurePages(pages);
  const groups = groupPages(pages, options);
  if (options.format !== 'pdf') {
    if (groups.length > 1) throw new Error('Multiple image pages produce separate files. Use createImageExports or choose PDF.');
    return (await createImageExports(pages, options))[0];
  }
  const sheets: PdfSheet[] = [];
  for (const group of groups) {
    const { canvas, layout } = await renderSheet(group, options, false);
    try { sheets.push({ blob: await canvasBlob(canvas), width: layout.width, height: layout.height }); }
    finally { releaseCanvas(canvas); }
  }
  const { createPdf } = await import('./pdf');
  return { blob: await createPdf(sheets), filename: exportFilename(pages, options), pageCount: sheets.length };
}

export function estimateExportBytes(pages: ScanPage[], options: ExportOptions): number {
  if (!pages.length) return 0;
  const size = pageSizeMM(options.arrangement);
  const sheets = Math.ceil(pages.length / (options.arrangement.idCopy ? 2 : 1));
  const pixels = mmToPixels(size.width, options.dpi) * mmToPixels(size.height, options.dpi) * sheets;
  const quality = Math.max(0.1, Math.min(1, options.quality));
  // Pixel count drives this intentionally approximate live estimate; content determines encoding size.
  const bytesPerPixel = options.format === 'jpeg' ? 0.045 + quality * quality * 0.22
    : options.format === 'webp' ? 0.035 + quality * quality * 0.16
      : 0.38;
  return Math.round(pixels * bytesPerPixel + sheets * (options.format === 'pdf' ? 2500 : 1024));
}

export function downloadExport(result: ExportResult): void {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Browsers dispatch the download asynchronously. Keep the URL alive until navigation consumes it.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareExport(result: ExportResult): Promise<boolean> {
  const file = new File([result.blob], result.filename, { type: result.blob.type });
  if (!navigator.share || !navigator.canShare?.({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file] });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') return false;
    throw error;
  }
}

export async function copyExportImage(result: ExportResult): Promise<void> {
  if (!result.blob.type.startsWith('image/')) throw new Error('Only a single image can be copied to the clipboard.');
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Image copying is not supported by this browser. Download the image instead.');
  if (result.blob.type === 'image/png') {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': result.blob })]);
    return;
  }
  const pixels = await loadPixels(result.blob);
  let canvas: HTMLCanvasElement | undefined;
  try {
    canvas = makeCanvas(pixels.width, pixels.height);
    canvasContext(canvas).drawImage(pixels.source, 0, 0);
    const png = await canvasBlob(canvas);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  } finally {
    pixels.release();
    if (canvas) releaseCanvas(canvas);
  }
}
