"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Drawer } from "vaul";
import { ArrowRight, Check, ChevronDown, Crop, Eye, FileCheck2, LoaderCircle, ScanLine, ShieldCheck, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { MODE_LABELS, type ExportOptions, type ScanPage, type ScannedPaperSize } from "@/lib/types";
import { useSession } from "@/stores/session";
import { useSettings } from "@/stores/settings";
import { ArrangeControls } from "./arrange-controls";
import { CropPreview } from "./crop-preview";
import { EnhanceControls } from "./enhance-controls";
import { ImagePlane } from "./image-plane";
import { PageStrip } from "./page-strip";
import { ProtectControls } from "./protect-controls";
import { RedactionOverlay } from "./redaction-preview";
import { useRenderedPage } from "./use-rendered-page";
import { useArrangedPreview } from "@/components/export/use-arranged-preview";
import { PreviewImage } from "./preview-image";
import { FlattenPreview } from "./flatten-preview";
import "./editor.css";

type EditorTab = "crop" | "enhance" | "arrange" | "protect";
const TABS = [{ id: "crop", label: "Crop", Icon: Crop }, { id: "enhance", label: "Enhance", Icon: Sparkles }, { id: "arrange", label: "Arrange", Icon: FileCheck2 }, { id: "protect", label: "Protect", Icon: ShieldCheck }] as const;

export function Editor() {
  const pages = useSession((s) => s.pages);
  const selectedId = useSession((s) => s.selectedId);
  const updatePage = useSession((s) => s.updatePage);
  const updateRecipe = useSession((s) => s.updateRecipe);
  const arrangement = useSettings((s) => s.arrangement);
  const setArrangement = useSettings((s) => s.setArrangement);
  const watermark = useSettings((s) => s.watermark);
  const setWatermark = useSettings((s) => s.setWatermark);
  const page = pages.find((item) => item.id === selectedId) ?? pages[0];
  const [tab, setTab] = useState<EditorTab>("crop");
  const [detecting, setDetecting] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [flattening, setFlattening] = useState<ScanPage | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [renderSize, setRenderSize] = useState({ width: 1, height: 1 });
  const detectionRequest = useRef(0);
  const currentPageId = useRef(page?.id);
  currentPageId.current = page?.id;
  const rendered = useRenderedPage(page, tab === "enhance" || tab === "protect");
  const originalPage = useMemo(() => page ? { ...page, recipe: { ...page.recipe, filter: "original" as const, brightness: 0, contrast: 0, sharpness: 0 } } : undefined, [page]);
  const before = useRenderedPage(originalPage, tab === "enhance");
  const previewOptions = useMemo<ExportOptions>(() => ({ format: "png", dpi: 150, quality: 1, filename: "preview", watermark, arrangement }), [watermark, arrangement]);
  const arranged = useArrangedPreview(pages, previewOptions, tab === "arrange");
  const previewBlob = tab === "arrange" ? arranged.blob : comparing ? before.blob : rendered.blob;
  const previewBusy = tab === "arrange" ? arranged.busy : rendered.busy;
  const previewError = tab === "arrange" ? arranged.error : rendered.error;
  const idCopyAvailable = pages.length >= 2 && pages.every((p) => p.type === "id");

  useEffect(() => { setComparing(false); setDrawing(false); setDetecting(false); setFlattening(null); detectionRequest.current += 1; }, [page?.id]);
  useEffect(() => { if (arrangement.idCopy && !idCopyAvailable) setArrangement({ idCopy: false, cropMarks: false }); }, [arrangement.idCopy, idCopyAvailable, setArrangement]);
  useEffect(() => {
    const cancelCompare = () => { if (document.hidden) setComparing(false); };
    document.addEventListener("visibilitychange", cancelCompare);
    return () => document.removeEventListener("visibilitychange", cancelCompare);
  }, []);

  async function autoDetect() {
    if (!page) return;
    const id = page.id;
    const request = ++detectionRequest.current;
    setDetecting(true);
    try {
      const { detectBlob } = await import("@/lib/cv/client");
      const result = await detectBlob(page.original, page.type);
      if (request !== detectionRequest.current || currentPageId.current !== id) return;
      updatePage(id, { corners: result.corners, width: result.width, height: result.height });
      toast.success(result.fallback ? "Adjust the corners to your document" : "Document edges found");
    } catch (reason) {
      if (request === detectionRequest.current) toast.error(reason instanceof Error ? reason.message : "Unable to detect edges. Adjust the corners manually.");
    } finally { if (request === detectionRequest.current) setDetecting(false); }
  }

  function autoOrient() {
    setArrangement({ orientation: 'auto' });
  }

  const tools = page ? <>
    {tab === "crop" ? <div className="editor-controls"><div className="editor-control-heading"><span>Find the perfect edges</span><Crop size={17} /></div><p className="editor-instruction">Drag the four corners to the edges of your document. Use the magnifier for a precise finish.</p><Button variant="secondary" onClick={() => void autoDetect()} disabled={detecting}>{detecting ? <LoaderCircle className="editor-spinner" size={18} /> : <ScanLine size={18} />}{detecting ? "Finding edges…" : "Auto detect edges"}</Button>{page.type !== 'id' && page.type !== 'passport' ? <label className="editor-field">Scanned paper size<select aria-label="Scanned paper size" value={page.recipe.paperSize ?? 'original'} onChange={(event) => updateRecipe(page.id, { paperSize: event.target.value as ScannedPaperSize })}><option value="original">Original proportions</option><option value="a4">A4 · 210 × 297 mm</option><option value="letter">US Letter · 216 × 279 mm</option><option value="a5">A5 · 148 × 210 mm</option></select><small>Choose the paper you scanned to restore its proportions after an angled photo. Use Original for receipts and other shapes.</small></label> : <p className="editor-footnote">{page.type === 'id' ? 'ID card' : 'Passport'} proportions are fixed to the document’s physical size.</p>}<div className="editor-privacy-card"><Check size={20} /><div><strong>Full resolution, every time</strong><p>Flattening uses your original image so small details stay sharp.</p></div></div><Button onClick={() => { setFlattening(page); setTab("enhance"); }} className="editor-full-width">Apply crop <ArrowRight size={16} /></Button></div> : null}
    {tab === "enhance" ? <EnhanceControls page={page} onChange={(patch) => updateRecipe(page.id, patch)} /> : null}
    {tab === "arrange" ? <ArrangeControls options={arrangement} onChange={setArrangement} idCopyAvailable={idCopyAvailable} onAutoOrient={autoOrient} /> : null}
    {tab === "protect" ? <ProtectControls watermark={watermark} onWatermark={setWatermark} redactions={page.redactions} onRedactions={(value) => updatePage(page.id, { redactions: value })} drawing={drawing} onDrawing={(value) => { setDrawing(value); if (value) setDrawerOpen(false); }} /> : null}
  </> : null;

  return <AppShell active="edit" eyebrow="YOUR DOCUMENT, REFINED" title="The details make the difference.">
    {!page ? <div className="editor-empty"><ScanLine size={38} /><h2>A fresh start.</h2><p>Capture or import a document to begin editing. Scans stay in this session until you export them.</p><Button asChild><Link href="/scan">Scan a document<ArrowRight size={17} /></Link></Button></div> : <>
      <div className="editor-top-row"><div className="editor-flow-nav" aria-label="Editing tools">{TABS.map(({ id, label, Icon }, index) => <button key={id} type="button" aria-pressed={tab === id} className={tab === id ? "is-active" : ""} onClick={() => { setTab(id); setComparing(false); setDrawing(false); setFlattening(null); }}><span className="editor-step-number">0{index + 1}</span><Icon size={16} /><span>{label}</span></button>)}</div><Button asChild className="editor-desktop-export"><Link href="/export">Export document<ArrowRight size={17} /></Link></Button></div>
      <div className="editor-workspace"><div className="editor-main-column"><section className="editor-preview" aria-label={`${tab} preview`}>
        <div className="editor-preview-heading"><span className="editor-preview-type">{MODE_LABELS[page.type]}<span>•</span>Page {pages.findIndex((p) => p.id === page.id) + 1} of {pages.length}</span><span className="editor-resolution">{Math.round(page.width)} × {Math.round(page.height)} PX</span></div>
        {tab === "crop" ? <CropPreview page={page} onChange={(corners) => updatePage(page.id, { corners })} /> : tab === "enhance" && flattening?.id === page.id && !comparing ? <FlattenPreview page={flattening} blob={rendered.blob} onComplete={() => setFlattening(null)} onSize={setRenderSize} /> : <ImagePlane width={renderSize.width} height={renderSize.height}>{previewBlob ? <PreviewImage blob={previewBlob} alt={comparing ? "Cropped document before enhancement" : tab === "arrange" ? "First arranged sheet preview" : "Enhanced document preview"} transitionKey={tab === "enhance" ? page.recipe.filter : undefined} instant={comparing} onLoad={(event) => { const source = event.currentTarget; setRenderSize({ width: source.naturalWidth, height: source.naturalHeight }); }} /> : <div className="editor-preview-loading"><LoaderCircle className="editor-spinner" size={25} /><span>Preparing your preview…</span></div>}{tab === "protect" && previewBlob ? <><RedactionOverlay enabled={drawing} redactions={page.redactions} onChange={(value) => updatePage(page.id, { redactions: value })} />{watermark ? <span className="editor-watermark-preview" aria-hidden="true">{watermark}</span> : null}</> : null}</ImagePlane>}
        {previewBusy && tab !== "crop" ? <div className="editor-render-status" role="status"><LoaderCircle className="editor-spinner" size={13} />Updating preview</div> : null}
        {previewError && tab !== "crop" ? <p className="editor-error" role="alert">{previewError}</p> : null}
        <div className="editor-preview-footer"><span><ShieldCheck size={14} />Only on your device</span>{tab === "enhance" ? <Button variant="ghost" size="sm" disabled={!before.blob || before.busy} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setFlattening(null); setComparing(true); }} onPointerUp={() => setComparing(false)} onPointerCancel={() => setComparing(false)} onLostPointerCapture={() => setComparing(false)} onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); setFlattening(null); setComparing(true); } }} onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") setComparing(false); }} onBlur={() => setComparing(false)} aria-pressed={comparing}><Eye size={15} />{comparing ? "Original" : "Hold to compare"}</Button> : <span>{tab === "crop" ? "Drag corners to adjust" : tab === "arrange" ? "First sheet · exact export layout" : drawing ? "Drag to hide sensitive details" : "Privacy controls"}</span>}</div>
      </section><PageStrip /></div><aside className="editor-tools-desktop">{tools}</aside></div>
      <div className="editor-mobile-actions">
        {/* Keep control gestures separate from Vaul's swipe-to-dismiss handling. */}
        <Drawer.Root open={drawerOpen} onOpenChange={setDrawerOpen} handleOnly autoFocus>
          <Drawer.Trigger asChild><Button variant="secondary"><SlidersHorizontal size={18} />{TABS.find((item) => item.id === tab)?.label}<ChevronDown size={14} /></Button></Drawer.Trigger>
          <Drawer.Portal>
            <Drawer.Overlay className="editor-sheet-overlay" />
            <Drawer.Content className="editor-sheet" onPointerDownOutside={(event) => event.preventDefault()}>
              <div className="editor-sheet-title">
                <Drawer.Title>{TABS.find((item) => item.id === tab)?.label} your scan</Drawer.Title>
                <Drawer.Close asChild><Button variant="ghost" size="icon" aria-label="Close tools"><X size={20} /></Button></Drawer.Close>
              </div>
              <Drawer.Description className="editor-sr-only">Adjust the current page using the controls below. Close tools to return to the document preview.</Drawer.Description>
              <div className="editor-sheet-body">{tools}</div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
        <Button asChild><Link href="/export">Export<ArrowRight size={17} /></Link></Button>
      </div>
    </>}
  </AppShell>;
}
