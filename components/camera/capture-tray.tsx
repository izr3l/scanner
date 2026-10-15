'use client';
import { ArrowRight, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { BlobImage } from '@/components/editor/blob-image';
import { useSession } from '@/stores/session';
import type { ScanPage } from '@/lib/types';

function CapturedThumbnail({ page, number, onOpen }: { page: ScanPage; number: number; onOpen: () => void }) {
  return <button className="captured-thumbnail" onClick={onOpen} aria-label={`Review captured page ${number}`}>
    <BlobImage blob={page.original} alt="" /><span>{number}</span>
  </button>;
}

export function CaptureTray({ disabled }: { disabled: boolean }) {
  const pages = useSession((s) => s.pages);
  const router = useRouter();
  if (!pages.length) return null;
  function openPage(id: string) { useSession.getState().select(id); router.push('/edit/'); }
  return <section className="capture-tray" aria-label="Captured pages in this session" aria-busy={disabled}>
    <div className="capture-tray-copy" role="status"><span><Check size={13} />{pages.length === 1 ? '1 page captured' : `${pages.length} pages captured`}</span><small>In this session · export to keep</small></div>
    <div className="capture-tray-thumbnails" inert={disabled}>
      {pages.slice(-3).map((page, index) => <CapturedThumbnail key={page.id} page={page} number={Math.max(0, pages.length - 3) + index + 1} onOpen={() => openPage(page.id)} />)}
    </div>
    <Button size="sm" disabled={disabled} onClick={() => openPage(pages.at(-1)!.id)}>Review {pages.length} {pages.length === 1 ? 'page' : 'pages'}<ArrowRight size={14} /></Button>
  </section>;
}
