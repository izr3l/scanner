import { DEFAULT_RECIPE, type ScanMode, type ScanPage } from './types';
import { validateImage as validateRaster } from './cv/import-validation';
export async function validateImage(file: Blob): Promise<void> {
  await validateRaster(file);
}
export async function importImage(file: Blob, mode: ScanMode): Promise<ScanPage> {
  await validateImage(file);
  const { detectBlob } = await import('@/lib/cv/client');
  const result = await detectBlob(file, mode);
  return { id: crypto.randomUUID(), type: mode, createdAt: Date.now(), original: file, width: result.width, height: result.height, corners: result.corners, recipe: { ...DEFAULT_RECIPE }, redactions: [] };
}
