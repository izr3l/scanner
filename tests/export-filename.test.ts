import { describe, expect, it } from 'vitest';
import { defaultExportFilename, exportFilename } from '../lib/export/filename';
import type { ExportOptions, ScanMode } from '../lib/types';

const createdAt = new Date(2026, 9, 15, 0, 15).getTime();
const page = { type: 'document' as const, createdAt };

describe('readable export filenames', () => {
  it.each([['pdf', 'pdf'], ['png', 'png'], ['jpeg', 'jpg'], ['webp', 'webp']] as const)('shows the real name and selected %s extension', (format, extension) => {
    expect(defaultExportFilename([page], format)).toBe(`document-2026-10-15.${extension}`);
  });

  it.each([['document', 'document'], ['id', 'id-card'], ['passport', 'passport'], ['book', 'book'], ['batch', 'batch']] as const)('names %s scans without placeholder text', (type: ScanMode, name: string) => {
    expect(defaultExportFilename([{ ...page, type }], 'pdf')).toBe(`${name}-2026-10-15.pdf`);
  });

  it('uses the local scan creation date, including a padded month and day', () => {
    const local = new Date(2026, 0, 2, 23, 58);
    expect(defaultExportFilename([{ ...page, createdAt: local.getTime() }], 'pdf')).toBe('document-2026-01-02.pdf');
    expect(defaultExportFilename([page, { ...page, createdAt: local.getTime() }], 'pdf')).toBe('document-2026-10-15.pdf');
  });

  it('keeps a custom name and replaces an existing extension for the chosen format', () => {
    expect(exportFilename([page], { filename: 'Lease agreement.PDF', format: 'jpeg' })).toBe('Lease agreement.jpg');
    expect(exportFilename([page], { filename: 'Lease agreement.JPG', format: 'webp' })).toBe('Lease agreement.webp');
    expect(exportFilename([page], { filename: 'Lease agreement.png.pdf', format: 'png' })).toBe('Lease agreement.png');
    expect(exportFilename([page], { filename: 'Lease agreement', format: 'pdf' })).toBe('Lease agreement.pdf');
  });

  it('uses the same numbered image name in the preview and final export', () => {
    const options: Pick<ExportOptions, 'filename' | 'format'> = { filename: defaultExportFilename([page], 'png'), format: 'png' };
    expect(exportFilename([page], options, 1)).toBe('document-2026-10-15-01.png');
    expect(exportFilename([page], options, 12)).toBe('document-2026-10-15-12.png');
  });

  it('sanitizes separators, reserved filename characters, and control bytes', () => {
    const result = exportFilename([page], { filename: '..My/scan\\name:<copy>?*\u0000.pdf', format: 'pdf' });
    expect(result).toBe('My-scan-name--copy----.pdf');
    expect(result).not.toMatch(/[<>:"/\\|?*]/);
    expect(Array.from(result).every((character) => character.charCodeAt(0) >= 32)).toBe(true);
    expect(exportFilename([page], { filename: '...', format: 'pdf' })).toBe('scan.pdf');
  });

  it('uses a friendly default for blank input and keeps explicit template compatibility', () => {
    expect(exportFilename([page], { filename: '   ', format: 'pdf' })).toBe('document-2026-10-15.pdf');
    expect(exportFilename([{ ...page, type: 'passport' }], { filename: 'Copy-{type}-{date}', format: 'pdf' })).toBe('Copy-passport-2026-10-15.pdf');
  });

  it('caps the base name while retaining the correct extension', () => {
    expect(exportFilename([page], { filename: `${'a'.repeat(200)}.PDF`, format: 'pdf' })).toBe(`${'a'.repeat(100)}.pdf`);
  });
});
