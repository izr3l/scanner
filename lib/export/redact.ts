import type { Redaction } from '@/lib/types';
import type { Rect } from './layout';

/** Expand to enclosing integer pixels so no partially covered boundary pixel leaks. */
export function redactionPixels(redaction: Redaction, width: number, height: number): Rect | null {
  if (![redaction.x, redaction.y, redaction.width, redaction.height, width, height].every(Number.isFinite)) return null;
  const x1 = Math.max(0, Math.min(1, Math.min(redaction.x, redaction.x + redaction.width)));
  const y1 = Math.max(0, Math.min(1, Math.min(redaction.y, redaction.y + redaction.height)));
  const x2 = Math.max(0, Math.min(1, Math.max(redaction.x, redaction.x + redaction.width)));
  const y2 = Math.max(0, Math.min(1, Math.max(redaction.y, redaction.y + redaction.height)));
  const x = Math.floor(x1 * width);
  const y = Math.floor(y1 * height);
  const right = Math.ceil(x2 * width);
  const bottom = Math.ceil(y2 * height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** Burn opaque pixels after enhancement, before resampling, layout, watermark, or encoding. */
export function burnRedactions(context: CanvasRenderingContext2D, redactions: Redaction[]): void {
  context.save();
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = '#000000';
  for (const redaction of redactions) {
    const rect = redactionPixels(redaction, context.canvas.width, context.canvas.height);
    if (rect) context.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
  context.restore();
}
