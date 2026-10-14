"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Crosshair } from "lucide-react";
import type { Point, Quad, ScanPage } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ImagePlane } from "./image-plane";
import { useObjectUrl } from "./use-object-url";

const CORNER_LABELS = ["Top left", "Top right", "Bottom right", "Bottom left"];

function convex(quad: Quad) {
  return quad.every((point, i) => {
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    return (b.x - point.x) * (c.y - b.y) - (b.y - point.y) * (c.x - b.x) > 1;
  });
}

export function CropPreview({ page, onChange }: { page: ScanPage; onChange: (corners: Quad) => void }) {
  const url = useObjectUrl(page.original);
  const plane = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const loupe = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const latest = useRef(page.corners);
  latest.current = page.corners;
  useEffect(() => { const canvas = loupe.current; if (canvas) { canvas.width = 120; canvas.height = 120; } return () => { if (canvas) { canvas.width = 0; canvas.height = 0; } }; }, []);

  function move(index: number, point: Point) {
    const next = latest.current.map((p) => ({ ...p })) as Quad;
    next[index] = { x: Math.max(0, Math.min(page.width, point.x)), y: Math.max(0, Math.min(page.height, point.y)) };
    if (convex(next)) {
      latest.current = next;
      onChange(next);
    }
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (dragging !== index || !plane.current) return;
    const bounds = plane.current.getBoundingClientRect();
    move(index, { x: (event.clientX - bounds.left) / bounds.width * page.width, y: (event.clientY - bounds.top) / bounds.height * page.height });
  }

  function nudge(dx: number, dy: number, amount = 1) {
    const point = latest.current[selected];
    move(selected, { x: point.x + dx * amount, y: point.y + dy * amount });
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const directions: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const point = latest.current[index];
    move(index, { x: point.x + direction.x * (event.shiftKey ? 10 : 1), y: point.y + direction.y * (event.shiftKey ? 10 : 1) });
  }

  useEffect(() => {
    const canvas = loupe.current;
    const source = image.current;
    if (!canvas || !source) return;
    const context = canvas.getContext("2d");
    const draw = () => {
      if (!context || !source.naturalWidth) return;
      const point = page.corners[selected];
      const sourceSize = Math.max(page.width, page.height) * 0.055;
      context.clearRect(0, 0, 120, 120);
      context.drawImage(source, point.x - sourceSize / 2, point.y - sourceSize / 2, sourceSize, sourceSize, 0, 0, 120, 120);
    };
    draw();
    source.addEventListener("load", draw);
    return () => source.removeEventListener("load", draw);
  }, [page.corners, page.width, page.height, selected, url]);

  return <>
    <ImagePlane width={page.width} height={page.height} className="crop-stage">
      <div className="crop-coordinate-plane" ref={plane}>
        {url ? <img src={url} ref={image} alt="Original scan with adjustable crop corners" draggable={false} /> : null}
        <svg className="crop-overlay" viewBox={`0 0 ${page.width} ${page.height}`} preserveAspectRatio="none" aria-hidden="true">
          <defs><mask id={`crop-mask-${page.id}`}><rect width={page.width} height={page.height} fill="white" /><polygon points={page.corners.map((p) => `${p.x},${p.y}`).join(" ")} fill="black" /></mask></defs>
          <rect width={page.width} height={page.height} fill="rgba(0,0,0,.52)" mask={`url(#crop-mask-${page.id})`} />
          <polygon points={page.corners.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
        {page.corners.map((point, index) => <button key={index} type="button" className={`crop-handle ${selected === index ? "is-selected" : ""}`} style={{ left: `${point.x / page.width * 100}%`, top: `${point.y / page.height * 100}%` }} aria-label={`${CORNER_LABELS[index]} crop corner. Use arrow keys to adjust, Shift for ten pixels.`} onFocus={() => setSelected(index)} onKeyDown={(event) => handleKey(event, index)} onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setSelected(index); setDragging(index); }} onPointerMove={(event) => pointerMove(event, index)} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setDragging(null); }} onPointerCancel={() => setDragging(null)}><span /></button>)}
      </div>
    </ImagePlane>
    <div className="crop-loupe" aria-hidden="true"><canvas ref={loupe} width={120} height={120} /><Crosshair size={22} /></div>
    <div className="crop-nudge-bar">
      <span className="editor-small-muted">Fine tune</span>
      <select value={selected} onChange={(event) => setSelected(Number(event.target.value))} aria-label="Corner to fine tune">{CORNER_LABELS.map((label, index) => <option value={index} key={label}>{label}</option>)}</select>
      <div className="crop-nudge-buttons">
        <Button variant="ghost" size="icon" aria-label="Nudge corner left one pixel" onClick={() => nudge(-1, 0)}><ArrowLeft size={15} /></Button>
        <Button variant="ghost" size="icon" aria-label="Nudge corner up one pixel" onClick={() => nudge(0, -1)}><ArrowUp size={15} /></Button>
        <Button variant="ghost" size="icon" aria-label="Nudge corner down one pixel" onClick={() => nudge(0, 1)}><ArrowDown size={15} /></Button>
        <Button variant="ghost" size="icon" aria-label="Nudge corner right one pixel" onClick={() => nudge(1, 0)}><ArrowRight size={15} /></Button>
      </div>
    </div>
  </>;
}
