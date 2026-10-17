"use client";

import { useEffect, useRef, useState } from "react";
import type { ExportOptions, ScanPage } from "@/lib/types";
import type { OcrPage, OcrProgress } from "@/lib/ocr/types";
import { useSession } from "@/stores/session";

const blobIds = new WeakMap<Blob, number>();
let nextBlobId = 0;

function blobId(blob: Blob) {
  let id = blobIds.get(blob);
  if (id === undefined) { id = ++nextBlobId; blobIds.set(blob, id); }
  return id;
}

interface Recognition {
  signature: string;
  pages: OcrPage[] | null;
  busy: boolean;
  progress: OcrProgress | null;
  error: string | null;
  reviewed: boolean;
  revision: number;
  cancelled: boolean;
}

export function useExportOcr(pages: ScanPage[], options: ExportOptions, epoch: number) {
  // A filename never changes recognized pixels; all render and source inputs do.
  const signature = JSON.stringify({
    epoch, format: options.format, mode: options.pdfMode, language: options.ocrLanguage,
    dpi: options.dpi, quality: options.quality, arrangement: options.arrangement, watermark: options.watermark,
    pages: pages.map((page) => ({ ...page, original: blobId(page.original) })),
  });
  const [recognition, setRecognition] = useState<Recognition | null>(null);
  const latestSignature = useRef(signature);
  latestSignature.current = signature;
  const controller = useRef<AbortController | null>(null);
  const request = useRef(0);
  const revision = useRef(0);
  const current = recognition?.signature === signature ? recognition : null;

  useEffect(() => {
    controller.current?.abort();
    request.current += 1;
    setRecognition(null);
    const unsubscribe = useSession.subscribe((state) => {
      if (state.epoch !== epoch) { controller.current?.abort(); request.current += 1; }
    });
    return () => { unsubscribe(); controller.current?.abort(); request.current += 1; };
  }, [signature, epoch]);

  async function recognize() {
    if (!pages.length || options.format !== "pdf" || options.pdfMode === "scan") return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const token = ++request.current;
    const valid = () => token === request.current && !abort.signal.aborted && latestSignature.current === signature && useSession.getState().epoch === epoch;
    setRecognition({ signature, pages: null, busy: true, progress: null, error: null, reviewed: false, revision: ++revision.current, cancelled: false });
    try {
      const { recognizeExport } = await import("@/lib/export");
      if (!valid()) return;
      const recognized = await recognizeExport(pages, options, (progress) => {
        if (valid()) setRecognition((state) => state?.signature === signature ? { ...state, progress } : state);
      }, abort.signal);
      if (!valid()) return;
      setRecognition({ signature, pages: recognized, busy: false, progress: null, error: null, reviewed: false, revision: ++revision.current, cancelled: false });
    } catch (reason) {
      if (!valid()) return;
      setRecognition({ signature, pages: null, busy: false, progress: null, error: reason instanceof Error ? reason.message : "Unable to recognize text. Please try again.", reviewed: false, revision: ++revision.current, cancelled: false });
    }
  }

  function cancel() {
    controller.current?.abort();
    request.current += 1;
    setRecognition((state) => state?.signature === signature ? { ...state, busy: false, progress: null, cancelled: true } : state);
  }

  function editPage(index: number, page: OcrPage) {
    const nextRevision = ++revision.current;
    setRecognition((state) => state?.signature === signature && state.pages ? {
      ...state, pages: state.pages.map((value, pageIndex) => pageIndex === index ? page : value), reviewed: false, revision: nextRevision,
    } : state);
  }

  function setReviewed(reviewed: boolean) {
    setRecognition((state) => state?.signature === signature ? { ...state, reviewed } : state);
  }

  return {
    pages: current?.pages ?? null, busy: current?.busy ?? false,
    progress: current?.progress ?? null, error: current?.error ?? null,
    reviewed: current?.reviewed ?? false, revision: current?.revision ?? 0,
    cancelled: current?.cancelled ?? false, signature, recognize, cancel, editPage, setReviewed,
  };
}
