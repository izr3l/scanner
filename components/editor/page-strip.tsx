"use client";

import Link from "next/link";
import { Reorder, useDragControls, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import type { ScanPage } from "@/lib/types";
import { useSession } from "@/stores/session";
import { useObjectUrl } from "./use-object-url";

function PageThumbnail({ page, index, selected, onSelect }: { page: ScanPage; index: number; selected: boolean; onSelect: () => void }) {
  const url = useObjectUrl(page.original);
  const controls = useDragControls();
  const reduced = useReducedMotion();
  return <Reorder.Item value={page.id} dragListener={false} dragControls={controls} className={`editor-page-card ${selected ? "is-selected" : ""}`} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 450, damping: 35 }} whileDrag={{ scale: reduced ? 1 : 1.03, zIndex: 2 }}>
    <button type="button" className="editor-page-select" onClick={onSelect} aria-label={`Edit page ${index + 1}`} aria-current={selected ? "true" : undefined}>{url ? <img src={url} alt="" draggable={false} /> : <span className="editor-thumbnail-placeholder" />}<span className="editor-page-number">{String(index + 1).padStart(2, "0")}</span></button>
    <button type="button" className="editor-page-grip" onPointerDown={(event) => controls.start(event)} aria-label={`Drag to reorder page ${index + 1}. Use the move buttons for keyboard reordering.`}><GripVertical size={15} /></button>
  </Reorder.Item>;
}

export function PageStrip() {
  const pages = useSession((s) => s.pages);
  const selectedId = useSession((s) => s.selectedId);
  const select = useSession((s) => s.select);
  const reorderPages = useSession((s) => s.reorderPages);
  const duplicatePage = useSession((s) => s.duplicatePage);
  const removePage = useSession((s) => s.removePage);
  const index = Math.max(0, pages.findIndex((page) => page.id === selectedId));
  const selected = pages[index];
  function onReorder(order: string[]) {
    const changed = order.findIndex((id, i) => id !== pages[i]?.id);
    if (changed >= 0) reorderPages(pages.findIndex((page) => page.id === order[changed]), changed);
  }
  return <section className="editor-pages" aria-label="Document pages">
    <div className="editor-pages-heading"><span>Pages <span className="editor-count">{pages.length}</span></span><div className="editor-page-actions">
      <Button variant="ghost" size="icon" disabled={index === 0} aria-label="Move selected page earlier" onClick={() => reorderPages(index, index - 1)}><ArrowLeft size={15} /></Button>
      <Button variant="ghost" size="icon" disabled={index >= pages.length - 1} aria-label="Move selected page later" onClick={() => reorderPages(index, index + 1)}><ArrowRight size={15} /></Button>
      <Button variant="ghost" size="icon" aria-label="Duplicate selected page" disabled={!selected} onClick={() => { if (selected) duplicatePage(selected.id); }}><Copy size={15} /></Button>
      <Button variant="ghost" size="icon" aria-label="Delete selected page" disabled={!selected} onClick={() => { if (selected) toast("Remove this scan?", { description: "The page will be removed from this session.", action: { label: "Remove", onClick: () => removePage(selected.id) }, cancel: { label: "Keep", onClick: () => undefined } }); }}><Trash2 size={15} /></Button>
    </div></div>
    <div className="editor-page-scroll"><Reorder.Group axis="x" values={pages.map((page) => page.id)} onReorder={onReorder} className="editor-page-list">{pages.map((page, i) => <PageThumbnail page={page} index={i} key={page.id} selected={page.id === selected?.id} onSelect={() => select(page.id)} />)}</Reorder.Group><Button variant="outline" asChild className="editor-add-page"><Link href="/scan"><Plus size={20} /><span>Add page</span></Link></Button></div>
  </section>;
}
