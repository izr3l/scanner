"use client";

import { useEffect, useRef, useState } from "react";
import type { ScanPage } from "@/lib/types";

export function useRenderedPage(page: ScanPage | undefined, enabled = true) {
  const [result, setResult] = useState<{ id: string; blob: Blob } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(page);
  latest.current = page;

  useEffect(() => {
    const page = latest.current;
    if (!page || !enabled) {
      setResult(null);
      setBusy(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    // Debounce slider edits. Results from superseded recipes never replace the preview.
    const timer = window.setTimeout(() => {
      void import("@/lib/cv/client")
        .then(({ renderPage }) => renderPage(page))
        .then((result) => {
          if (!cancelled) setResult({ id: page.id, blob: result });
        })
        .catch((reason: unknown) => {
          if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to render this page.");
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [page?.id, page?.original, page?.width, page?.height, page?.corners, page?.recipe.filter, page?.recipe.brightness, page?.recipe.contrast, page?.recipe.sharpness, page?.recipe.rotation, page?.recipe.flipX, enabled]);

  return { blob: result && result.id === page?.id ? result.blob : null, busy, error };
}
