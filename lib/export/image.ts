import type { ExportOptions } from '@/lib/types';
import { canvasBlob } from './strip';
import { setImageResolution } from './resolution';

export const IMAGE_MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as const;

export async function encodeImage(canvas: HTMLCanvasElement, format: Exclude<ExportOptions['format'], 'pdf'>, quality: number, dpi = 300): Promise<Blob> {
  const blob = await canvasBlob(canvas, IMAGE_MIME[format], Math.max(0.1, Math.min(1, quality)));
  return setImageResolution(blob, dpi);
}
