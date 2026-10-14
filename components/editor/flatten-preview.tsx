"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { warpGeometry } from "@/lib/cv/geometry";
import type { Point, ScanPage } from "@/lib/types";
import { ImagePlane } from "./image-plane";
import { useObjectUrl } from "./use-object-url";

function edgeTransform(a: Point, b: Point): string {
  return `translate(${a.x}px,${a.y}px) rotate(${Math.atan2(b.y - a.y, b.x - a.x)}rad) scaleX(${Math.hypot(b.x - a.x, b.y - a.y)})`;
}

/** The real source corners move to their corresponding locations in the decoded CV result. */
export function FlattenPreview({ page, blob, onComplete, onSize }: { page: ScanPage; blob: Blob | null; onComplete: () => void; onSize: (size: { width: number; height: number }) => void }) {
  const original = useObjectUrl(page.original);
  const output = useObjectUrl(blob);
  const reduced = useReducedMotion();
  const plane = useRef<HTMLDivElement>(null);
  const complete = useRef(onComplete);
  complete.current = onComplete;
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [decoded, setDecoded] = useState<{ url: string; width: number; height: number } | null>(null);
  const [active, setActive] = useState(false);
  const geometry = useMemo(() => {
    try { return warpGeometry(page.corners, page.type, page.width, page.height); }
    catch { return null; }
  }, [page.corners, page.type, page.width, page.height]);

  useEffect(() => {
    const element = plane.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setBounds({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!output || decoded?.url !== output || !bounds.width || !geometry) return;
    let second = 0;
    let timeout = 0;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => {
        setActive(true);
        timeout = window.setTimeout(() => complete.current(), reduced ? 120 : 300);
      });
    });
    return () => { window.cancelAnimationFrame(first); window.cancelAnimationFrame(second); window.clearTimeout(timeout); };
  }, [output, decoded, bounds.width, geometry, reduced]);

  let from: Point[] = [], to: Point[] = [];
  if (geometry && decoded?.url === output) {
    from = geometry.corners.map((point) => ({ x: point.x / page.width * bounds.width, y: point.y / page.height * bounds.height }));
    const scale = Math.min(bounds.width / decoded.width, bounds.height / decoded.height);
    const angle = (Number.isFinite(page.recipe.rotation) ? page.recipe.rotation : 0) * Math.PI / 180;
    const c = Math.cos(angle), s = Math.sin(angle);
    to = [{ x: -geometry.width / 2, y: -geometry.height / 2 }, { x: geometry.width / 2, y: -geometry.height / 2 }, { x: geometry.width / 2, y: geometry.height / 2 }, { x: -geometry.width / 2, y: geometry.height / 2 }].map((point) => {
      const x = page.recipe.flipX ? -point.x : point.x;
      return { x: bounds.width / 2 + (x * c - point.y * s) * scale, y: bounds.height / 2 + (x * s + point.y * c) * scale };
    });
  }
  const points = active && !reduced ? to : from;
  return <ImagePlane width={page.width} height={page.height} className="flatten-stage"><div ref={plane} className={`flatten-plane ${active ? "is-flattened" : ""}`}>
    {original ? <img className="flatten-source" src={original} alt="Document crop being flattened" draggable={false} /> : null}
    {output ? <img className="flatten-result" src={output} alt="Flattened and enhanced document" draggable={false} onLoad={(event) => { const image = event.currentTarget; const size = { width: image.naturalWidth, height: image.naturalHeight }; setDecoded({ url: output, ...size }); onSize(size); }} /> : null}
    <div className="flatten-corners" aria-hidden="true">{points.map((point, index) => <div key={index}><i className="flatten-edge" style={{ transform: edgeTransform(point, points[(index + 1) % points.length]) }} /><i className="flatten-corner" style={{ transform: `translate(${point.x}px,${point.y}px)` }} /></div>)}</div>
  </div></ImagePlane>;
}
