"use client";

import { EyeOff, Plus, ShieldCheck, Trash2 } from "lucide-react";
import type { Redaction } from "@/lib/types";
import { Button } from "@/components/ui/button";

export function ProtectControls({ watermark, onWatermark, redactions, onRedactions, drawing, onDrawing }: { watermark: string; onWatermark: (value: string) => void; redactions: Redaction[]; onRedactions: (value: Redaction[]) => void; drawing: boolean; onDrawing: (value: boolean) => void }) {
  function addKeyboardRedaction() {
    onRedactions([...redactions, { id: crypto.randomUUID(), x: 0.25, y: 0.4, width: 0.5, height: 0.15 }]);
  }
  function adjustRedaction(id: string, key: "x" | "y" | "width" | "height", percent: number) {
    onRedactions(redactions.map((redaction) => {
      if (redaction.id !== id) return redaction;
      const max = key === "x" ? 1 - redaction.width : key === "y" ? 1 - redaction.height : key === "width" ? 1 - redaction.x : 1 - redaction.y;
      return { ...redaction, [key]: Math.max(key === "width" || key === "height" ? 0.005 : 0, Math.min(max, percent / 100)) };
    }));
  }
  return <div className="editor-controls">
    <div className="editor-control-heading"><span>Share with confidence</span><ShieldCheck size={17} /></div>
    <div className="editor-privacy-card"><ShieldCheck size={21} /><div><strong>Metadata is always removed</strong><p>Location, EXIF, author and creator details are stripped from every export.</p></div></div>
    <label className="editor-field">Watermark text<input value={watermark} maxLength={100} placeholder="e.g. For verification only" onChange={(event) => onWatermark(event.target.value)} /><small>Added to every page of your export.</small></label>
    <div className="editor-divider" />
    <div className="editor-control-heading"><span>Hide sensitive information</span><span className="editor-count">{redactions.length}</span></div>
    <Button variant={drawing ? "default" : "secondary"} aria-pressed={drawing} onClick={() => onDrawing(!drawing)}><EyeOff size={18} />{drawing ? "Finish drawing" : "Draw redactions"}</Button>
    <p className="editor-footnote">Drag a rectangle over information to hide. Redactions are permanently burned into the exported image.</p>
    <Button variant="ghost" onClick={addKeyboardRedaction}><Plus size={16} />Add rectangle with keyboard</Button>
    {redactions.length ? <div className="editor-redaction-list">{redactions.map((redaction, index) => <div key={redaction.id} className="editor-redaction-entry"><div className="editor-redaction-row"><span>Redaction {index + 1}</span><Button variant="ghost" size="icon" aria-label={`Remove redaction ${index + 1}`} onClick={() => onRedactions(redactions.filter((r) => r.id !== redaction.id))}><Trash2 size={15} /></Button></div><div className="editor-redaction-dimensions">{([{ key: "x", label: "Left" }, { key: "y", label: "Top" }, { key: "width", label: "Width" }, { key: "height", label: "Height" }] as const).map(({ key, label }) => <label className="editor-field" key={key}>{label} (%)<input type="number" aria-label={`Redaction ${index + 1} ${label.toLowerCase()} in percent`} min={key === "width" || key === "height" ? 0.5 : 0} max={100} step={0.5} value={Math.round(redaction[key] * 1000) / 10} onChange={(event) => adjustRedaction(redaction.id, key, Number(event.target.value) || 0)} /></label>)}</div></div>)}</div> : null}
    {redactions.length ? <p className="editor-footnote">Focus a rectangle in the preview to move it with arrow keys. Hold Shift for larger steps, or press Delete to remove it.</p> : null}
    <div className="editor-security-note">PDF password protection will be available after an encryption library has been vetted.</div>
  </div>;
}
