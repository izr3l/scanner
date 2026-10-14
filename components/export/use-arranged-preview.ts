"use client";

import { useEffect, useState } from "react";
import type { ExportOptions, ScanPage } from "@/lib/types";

export function useArrangedPreview(pages: ScanPage[], options: ExportOptions, enabled = true) {
  const [result, setResult] = useState<{ firstId: string; blob: Blob } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!pages.length || !enabled) { setResult(null); setBusy(false); return; }
    let cancelled = false;
    setBusy(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void import("@/lib/export")
        .then(({ renderArrangedPreview }) => renderArrangedPreview(pages, options))
        .then((blob) => { if (!cancelled) setResult({ firstId: pages[0].id, blob }); })
        .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to arrange this preview."); })
        .finally(() => { if (!cancelled) setBusy(false); });
    }, 150);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [pages, options, enabled]);
  return { blob: result && result.firstId === pages[0]?.id ? result.blob : null, busy, error };
}
