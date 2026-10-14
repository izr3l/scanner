'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';
import { useSession } from '@/stores/session';
import type { ScanMode } from '@/lib/types';
export function useImport() {
  const [importing, setImporting] = useState(false);
  const router = useRouter();
  const active = useRef(true);
  const operation = useRef(0);
  const running = useRef(false);
  useEffect(() => { const lifecycle = operation; active.current = true; return () => { active.current = false; lifecycle.current++; }; }, []);
  async function importFiles(files: FileList | File[], mode: ScanMode = 'document') {
    if (running.current) return;
    const images = Array.from(files);
    if (!images.length) return;
    running.current = true;
    const token = ++operation.current;
    const epoch = useSession.getState().epoch;
    const valid = () => active.current && token === operation.current && epoch === useSession.getState().epoch;
    setImporting(true);
    const added = [];
    try {
      const { importImage } = await import('@/lib/import-image');
      for (const image of images.slice(0, 40)) {
        if (!valid()) return;
        try { added.push(await importImage(image, mode)); }
        catch (error) { if (valid()) toast.error(error instanceof Error ? error.message : 'This image could not be opened.'); }
      }
      if (added.length && valid()) { useSession.getState().addPages(added); toast.success(`${added.length} ${added.length === 1 ? 'page' : 'pages'} ready to refine`); router.push('/edit/'); }
    } finally { running.current = false; if (active.current) setImporting(false); }
  }
  return { importing, importFiles };
}
