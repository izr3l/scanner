"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Redaction } from "@/lib/types";

type Position = { x: number; y: number };
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function RedactionOverlay({ enabled, redactions, onChange }: { enabled: boolean; redactions: Redaction[]; onChange: (redactions: Redaction[]) => void }) {
  const plane = useRef<HTMLDivElement>(null);
  const start = useRef<Position | null>(null);
  const moving = useRef<{ id: string; x: number; y: number; clientX: number; clientY: number } | null>(null);
  const [draft, setDraft] = useState<Redaction | null>(null);

  function position(event: PointerEvent<HTMLDivElement>) {
    const bounds = plane.current!.getBoundingClientRect();
    return { x: clamp((event.clientX - bounds.left) / bounds.width), y: clamp((event.clientY - bounds.top) / bounds.height) };
  }

  function rectangle(event: PointerEvent<HTMLDivElement>) {
    if (!start.current) return null;
    const point = position(event);
    return { id: "draft", x: Math.min(start.current.x, point.x), y: Math.min(start.current.y, point.y), width: Math.abs(point.x - start.current.x), height: Math.abs(point.y - start.current.y) };
  }

  function keyboard(event: KeyboardEvent<HTMLButtonElement>, redaction: Redaction) {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onChange(redactions.filter((r) => r.id !== redaction.id));
      return;
    }
    const direction: Record<string, Position> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    if (!direction[event.key]) return;
    event.preventDefault();
    const delta = event.shiftKey ? 0.02 : 0.002;
    onChange(redactions.map((r) => r.id === redaction.id ? { ...r, x: Math.max(0, Math.min(1 - r.width, r.x + direction[event.key].x * delta)), y: Math.max(0, Math.min(1 - r.height, r.y + direction[event.key].y * delta)) } : r));
  }

  return <div className={`editor-redaction-overlay ${enabled ? "is-drawing" : ""}`} ref={plane} onPointerDown={(event) => { if (!enabled || event.target !== event.currentTarget) return; event.currentTarget.setPointerCapture(event.pointerId); start.current = position(event); setDraft(rectangle(event)); }} onPointerMove={(event) => { if (start.current) setDraft(rectangle(event)); }} onPointerUp={(event) => { const result = rectangle(event); if (result && result.width > 0.005 && result.height > 0.005) onChange([...redactions, { ...result, id: crypto.randomUUID() }]); start.current = null; setDraft(null); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { start.current = null; setDraft(null); }}>
    {redactions.map((redaction, index) => <button type="button" key={redaction.id} className="editor-redaction" style={{ left: `${redaction.x * 100}%`, top: `${redaction.y * 100}%`, width: `${redaction.width * 100}%`, height: `${redaction.height * 100}%` }} aria-label={`Redaction ${index + 1}. Arrow keys move it. Delete removes it.`} onKeyDown={(event) => keyboard(event, redaction)} onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); moving.current = { id: redaction.id, x: redaction.x, y: redaction.y, clientX: event.clientX, clientY: event.clientY }; }} onPointerMove={(event) => { const original = moving.current; if (!original || original.id !== redaction.id || !plane.current) return; event.stopPropagation(); const bounds = plane.current.getBoundingClientRect(); onChange(redactions.map((r) => r.id === redaction.id ? { ...r, x: Math.max(0, Math.min(1 - r.width, original.x + (event.clientX - original.clientX) / bounds.width)), y: Math.max(0, Math.min(1 - r.height, original.y + (event.clientY - original.clientY) / bounds.height)) } : r)); }} onPointerUp={(event) => { event.stopPropagation(); moving.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { moving.current = null; }} />)}
    {draft ? <div className="editor-redaction is-draft" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%` }} /> : null}
  </div>;
}
