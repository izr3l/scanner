import type { ExportOptions, ScanPage } from '@/lib/types';

type FilenamePage = Pick<ScanPage, 'type' | 'createdAt'>;
type FilenameOptions = Pick<ExportOptions, 'filename' | 'format'>;

const TYPE_NAMES: Record<ScanPage['type'], string> = {
  document: 'document', id: 'id-card', passport: 'passport', book: 'book', batch: 'batch',
};

function localDate(timestamp: number): string {
  const date = new Date(Number.isFinite(timestamp) ? timestamp : Date.now());
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Shared by the editable name preview and the final download/share file. */
export function exportFilename(pages: readonly FilenamePage[], options: FilenameOptions, pageNumber?: number): string {
  const template = options.filename.trim() || '{type}-{date}';
  const type = TYPE_NAMES[pages[0]?.type ?? 'document'];
  let name = template.replaceAll('{type}', type).replaceAll('{date}', localDate(pages[0]?.createdAt ?? Date.now()));
  name = name.replace(/(?:\.(?:pdf|png|jpe?g|webp))+$/i, '');
  name = Array.from(name, (character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '-' : character).join('');
  name = name.replace(/^\.+|\.+$/g, '').slice(0, 100).trim() || 'scan';
  const extension = options.format === 'jpeg' ? 'jpg' : options.format;
  return `${name}${pageNumber === undefined ? '' : `-${String(pageNumber).padStart(2, '0')}`}.${extension}`;
}

export function defaultExportFilename(pages: readonly FilenamePage[], format: ExportOptions['format']): string {
  return exportFilename(pages, { filename: '', format });
}
