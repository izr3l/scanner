'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';
import { useSession } from '@/stores/session';
import type { ScanMode, ScanPage } from '@/lib/types';
import { MAX_SESSION_PAGES } from '@/lib/import-pdf';
export function useImport() {
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const router = useRouter();
  const active = useRef(true);
  const operation = useRef(0);
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { const lifecycle = operation; const cancellation = controller; active.current = true; return () => { active.current = false; lifecycle.current++; cancellation.current?.abort(); }; }, []);
  function cancelImport() { controller.current?.abort(); }
  async function importFiles(files: FileList | File[], mode: ScanMode = 'document') {
    if (running.current) return;
    const sources = Array.from(files);
    if (!sources.length) return;
    const remaining = MAX_SESSION_PAGES - useSession.getState().pages.length;
    if (remaining < 1) { toast.error('This session is full. Export or remove pages before importing another document.'); return; }
    if (sources.length > remaining) { toast.error(`Choose up to ${remaining} more files. A session can contain 40 pages.`); return; }
    running.current = true;
    const token = ++operation.current;
    const epoch = useSession.getState().epoch;
    const cancellation = new AbortController();
    controller.current = cancellation;
    const current = () => active.current && token === operation.current && epoch === useSession.getState().epoch;
    const valid = () => current() && !cancellation.signal.aborted;
    const unsubscribe = useSession.subscribe((state) => { if (state.epoch !== epoch) cancellation.abort(); });
    setImporting(true);
    setImportProgress('Opening your files…');
    const added: ScanPage[] = [];
    try {
      const { importImage } = await import('@/lib/import-image');
      for (const [index, source] of sources.entries()) {
        if (!valid()) return;
        setImportProgress(`Opening file ${index + 1} of ${sources.length}…`);
        const isPdf = source.type === 'application/pdf' || /\.pdf$/i.test(source.name) || (await source.slice(0, 5).text()) === '%PDF-';
        if (isPdf) {
          const { importPdf } = await import('@/lib/import-pdf');
          const pdfPages = await importPdf(source, { maxPages: remaining - added.length, signal: cancellation.signal, onProgress: (completed, total) => { if (valid()) setImportProgress(`PDF ${index + 1} of ${sources.length} · page ${Math.min(completed + 1, total)} of ${total}`); } });
          added.push(...pdfPages);
        } else {
          if (added.length >= remaining) throw new Error('This import would exceed the 40-page session limit. Choose fewer files.');
          added.push(await importImage(source, mode));
        }
      }
      if (added.length && valid()) {
        if (useSession.getState().pages.length + added.length > MAX_SESSION_PAGES) throw new Error('This import would exceed the 40-page session limit. Remove pages and try again.');
        useSession.getState().addPages(added); toast.success(`${added.length} ${added.length === 1 ? 'page' : 'pages'} ready to refine`); router.push('/edit/');
      }
    } catch (error) {
      if (current()) {
        if (cancellation.signal.aborted) toast('Import cancelled', { description: 'No pages were added.' });
        else toast.error(error instanceof Error ? error.message : 'This file could not be opened.', { description: 'No pages were added. Choose JPEG, PNG, WebP, or an unlocked PDF.' });
      }
    } finally {
      unsubscribe(); running.current = false;
      if (controller.current === cancellation) controller.current = null;
      if (active.current) { setImporting(false); setImportProgress(''); }
    }
  }
  return { importing, importProgress, importFiles, cancelImport };
}
