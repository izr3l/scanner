"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCheck, Clipboard, Download, FileImage, FileText, Image as ImageIcon, LoaderCircle, Settings2, Share2, ShieldCheck } from "lucide-react";
import { toast } from "@/lib/toast";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { ArrangeControls } from "@/components/editor/arrange-controls";
import { ImagePlane } from "@/components/editor/image-plane";
import { useSession } from "@/stores/session";
import { useSettings } from "@/stores/settings";
import type { ExportOptions, ExportResult } from "@/lib/types";
import { recommendedOrientation } from "@/lib/export/layout";
import { useArrangedPreview } from "./use-arranged-preview";
import { PreviewImage } from "@/components/editor/preview-image";
import { ExportSuccess } from "./export-success";
import "@/components/editor/editor.css";

const FORMATS = [{ id: "pdf", label: "PDF", description: "One document, every page", Icon: FileText }, { id: "png", label: "PNG", description: "Lossless, crisp detail", Icon: ImageIcon }, { id: "jpeg", label: "JPEG", description: "Smaller, easy to share", Icon: FileImage }, { id: "webp", label: "WebP", description: "Compact and modern", Icon: FileImage }] as const;

function formatBytes(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }

export function ExportStudio() {
  const pages = useSession((s) => s.pages);
  const selectedId = useSession((s) => s.selectedId);
  const arrangement = useSettings((s) => s.arrangement);
  const setArrangement = useSettings((s) => s.setArrangement);
  const watermark = useSettings((s) => s.watermark);
  const [format, setFormat] = useState<ExportOptions["format"]>("pdf");
  const [dpi, setDpi] = useState<ExportOptions["dpi"]>(200);
  const [quality, setQuality] = useState(0.9);
  const [filename, setFilename] = useState("{type}-{date}");
  const [showLayout, setShowLayout] = useState(false);
  const [busy, setBusy] = useState(false);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [previewSize, setPreviewSize] = useState({ width: 210, height: 297 });
  const [canCopy, setCanCopy] = useState(false);
  const [ready, setReady] = useState<{ signature: string; results: ExportResult[] } | null>(null);
  const options = useMemo<ExportOptions>(() => ({ format, dpi, quality, filename, watermark, arrangement }), [format, dpi, quality, filename, watermark, arrangement]);
  const signature = JSON.stringify({ options, pages: pages.map((page) => ({ id: page.id, corners: page.corners, recipe: page.recipe, redactions: page.redactions })) });
  const latestSignature = useRef(signature);
  latestSignature.current = signature;
  const request = useRef(0);
  const results = ready?.signature === signature ? ready.results : null;
  const sheetCount = Math.ceil(pages.length / (arrangement.idCopy ? 2 : 1));
  const preview = useArrangedPreview(pages, options);
  const idCopyAvailable = pages.length >= 2 && pages.every((page) => page.type === "id");

  useEffect(() => {
    setCanCopy(typeof navigator.clipboard?.write === "function" && typeof ClipboardItem !== "undefined");
    return () => { request.current += 1; };
  }, []);
  useEffect(() => { if (arrangement.idCopy && !idCopyAvailable) setArrangement({ idCopy: false, cropMarks: false }); }, [arrangement.idCopy, idCopyAvailable, setArrangement]);
  useEffect(() => { setReady((current) => current?.signature === signature ? current : null); }, [signature]);
  useEffect(() => {
    let cancelled = false;
    void import("@/lib/export").then(({ estimateExportBytes }) => { if (!cancelled) setEstimate(estimateExportBytes(pages, options)); });
    return () => { cancelled = true; };
  }, [pages, options]);

  async function deliver(action: "download" | "share" | "copy") {
    if (!pages.length || busy) return;
    const token = ++request.current;
    const originalSignature = signature;
    setBusy(true);
    try {
      const engine = await import("@/lib/export");
      const files = results ?? (options.format === "pdf" ? [await engine.createExport(pages, options)] : await engine.createImageExports(pages, options));
      if (token !== request.current || latestSignature.current !== originalSignature) return;
      setReady({ signature: originalSignature, results: files });
      if (action === "download") {
        files.forEach((file) => engine.downloadExport(file));
        toast.success(files.length > 1 ? `${files.length} image files are ready` : "Your document is ready", { description: "Exported on your device. Metadata removed." });
      } else if (action === "share") {
        const shared = await engine.shareExport(files[0]);
        if (!shared) { engine.downloadExport(files[0]); toast.success("Your export was downloaded", { description: "File sharing is unavailable in this browser." }); }
      } else {
        await engine.copyExportImage(files[0]);
        toast.success("Image copied to clipboard");
      }
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      if (token === request.current) toast.error(reason instanceof Error ? reason.message : "Unable to export. Please try again.");
    } finally { if (token === request.current) setBusy(false); }
  }

  async function downloadFile(file: ExportResult) { const { downloadExport } = await import("@/lib/export"); downloadExport(file); }
  function autoOrient() {
    const page = pages.find((item) => item.id === selectedId) ?? pages[0];
    if (!page) return;
    try { setArrangement({ orientation: recommendedOrientation(page) }); }
    catch (reason) { toast.error(reason instanceof Error ? reason.message : "Adjust the crop corners before choosing orientation."); }
  }
  const actualBytes = results?.reduce((sum, result) => sum + result.blob.size, 0);
  return <AppShell active="export" eyebrow="READY WHEN YOU ARE" title="Your scan. Ready to go.">
    {!pages.length ? <div className="editor-empty"><FileText size={38} /><h2>Something worth sharing.</h2><p>Scan a document first, then choose how to export it. Every file is created on your device.</p><Button asChild><Link href="/scan">Start a scan<ArrowRight size={17} /></Link></Button></div> : <>
      <div className="export-back-row"><Button variant="ghost" size="sm" asChild><Link href="/edit"><ArrowLeft size={16} />Back to editing</Link></Button><span className="editor-small-muted">{pages.length} scan{pages.length === 1 ? "" : "s"} · {sheetCount} sheet{sheetCount === 1 ? "" : "s"}</span></div>
      <div className="export-workspace"><section className="editor-preview export-preview"><div className="editor-preview-heading"><span>Export preview</span><span className="editor-resolution">{arrangement.preset.toUpperCase()} · {dpi} DPI</span></div><ImagePlane width={previewSize.width} height={previewSize.height}>{preview.blob ? <PreviewImage blob={preview.blob} alt="First export sheet with the chosen layout, watermark and redactions" onLoad={(event) => setPreviewSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} /> : <div className="editor-preview-loading"><LoaderCircle className="editor-spinner" size={25} /><span>Preparing your document…</span></div>}</ImagePlane>{preview.busy ? <div className="editor-render-status" role="status"><LoaderCircle className="editor-spinner" size={13} />Updating preview</div> : null}{preview.error ? <p className="editor-error" role="alert">{preview.error}</p> : null}<div className="editor-preview-footer"><span><ShieldCheck size={14} />Metadata removed</span><span>Sheet 1 of {sheetCount}</span></div><div className="export-preview-note"><CheckCheck size={18} /><div><strong>Created here. Shared by you.</strong><p>No uploads or server links. Your file goes directly from this device.</p></div></div></section>
      <section className="export-options" aria-label="Export options"><div className="editor-control-heading"><span>Choose your format</span><span className="editor-small-muted">01 / 03</span></div><div className="export-format-grid" role="group" aria-label="File format">{FORMATS.map(({ id, label, description, Icon }) => <button type="button" className={`export-format-card ${format === id ? "is-selected" : ""}`} key={id} aria-pressed={format === id} disabled={busy} onClick={() => setFormat(id)}><div><Icon size={25} strokeWidth={1.5} />{format === id ? <span className="export-format-check"><Check size={11} /></span> : null}</div><strong>{label}</strong><span>{description}</span></button>)}</div>
        <div className="editor-divider" /><div className="editor-control-heading"><span>A clear finish</span><span className="editor-small-muted">02 / 03</span></div><div className="editor-field"><span>Resolution</span><div className="editor-segmented">{([150, 200, 300] as const).map((value) => <button key={value} type="button" disabled={busy} aria-pressed={dpi === value} onClick={() => setDpi(value)}>{value}<small>DPI</small></button>)}</div><small>{dpi === 300 ? "Best for sharp printed copies." : dpi === 200 ? "A balanced choice for reading and sharing." : "Smaller files for quick sharing."}</small></div>
        {format === "jpeg" || format === "webp" ? <label className="editor-slider"><span>Image quality<output>{Math.round(quality * 100)}%</output></span><input type="range" aria-label="Image quality" min={0.1} max={1} step={0.01} disabled={busy} value={quality} onChange={(event) => setQuality(Number(event.target.value))} /></label> : null}
        <Button variant="ghost" className="export-layout-toggle" aria-expanded={showLayout} onClick={() => setShowLayout(!showLayout)}><Settings2 size={16} />{showLayout ? "Hide page layout" : "Adjust page layout"}<span>{arrangement.preset.toUpperCase()}</span></Button>{showLayout ? <div className="export-layout-controls"><ArrangeControls options={arrangement} onChange={setArrangement} idCopyAvailable={idCopyAvailable} onAutoOrient={autoOrient} /></div> : null}
        <div className="editor-divider" /><div className="editor-control-heading"><span>Name it. Make it yours.</span><span className="editor-small-muted">03 / 03</span></div><label className="editor-field">Filename<input value={filename} maxLength={100} disabled={busy} onChange={(event) => setFilename(event.target.value)} placeholder="{type}-{date}" /><small>Use {"{type}"} and {"{date}"} to name files automatically.</small></label>
        <div className="export-file-summary"><div><FileText size={20} /><span><strong>{format.toUpperCase()} export</strong><small>{format === "pdf" ? `${sheetCount} page${sheetCount === 1 ? "" : "s"} in one file` : `${sheetCount} image file${sheetCount === 1 ? "" : "s"}`}</small></span></div><span>{actualBytes !== undefined ? formatBytes(actualBytes) : estimate === null ? "…" : `~ ${formatBytes(estimate)}`}<small>{actualBytes !== undefined ? "Actual size" : "Estimated size"}</small></span></div>
        <Button className="export-primary-action" disabled={busy || Boolean(preview.error)} onClick={() => void deliver("download")}>{busy ? <LoaderCircle className="editor-spinner" size={19} /> : <Download size={19} />}{busy ? "Creating your export…" : format !== "pdf" && sheetCount > 1 ? `Download ${sheetCount} images` : "Download document"}<ArrowRight size={17} /></Button>
        <div className="export-secondary-actions"><Button variant="secondary" disabled={busy || (format !== "pdf" && sheetCount > 1) || Boolean(preview.error)} onClick={() => void deliver("share")}><Share2 size={17} />Share file</Button><Button variant="secondary" disabled={busy || format === "pdf" || sheetCount !== 1 || !canCopy || Boolean(preview.error)} onClick={() => void deliver("copy")}><Clipboard size={17} />Copy image</Button></div>
        {format !== "pdf" && sheetCount > 1 ? <p className="editor-footnote">Each sheet downloads as a separate image. Choose PDF to share all pages in one file.</p> : null}
        <div className="export-security"><ShieldCheck size={14} /><span>EXIF and location stripped · No document storage</span></div>
        {results ? <div className="export-ready" role="status"><ExportSuccess /><div><strong>Export complete</strong><p>{results.length > 1 ? "If your browser blocked multiple downloads, download each file below." : "Your file is ready. You can download it again or share it."}</p>{results.map((file) => <button type="button" key={file.filename} onClick={() => void downloadFile(file)}><Download size={14} />{file.filename}<span>{formatBytes(file.blob.size)}</span></button>)}</div></div> : null}
      </section></div>
    </>}
  </AppShell>;
}
