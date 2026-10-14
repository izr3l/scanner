"use client";

import { FlipHorizontal, RotateCcw, RotateCw, SlidersHorizontal } from "lucide-react";
import type { Recipe, ScanFilter, ScanPage } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { useObjectUrl } from "./use-object-url";

const FILTERS: { id: ScanFilter; label: string }[] = [
  { id: "original", label: "Original" }, { id: "auto", label: "Auto" }, { id: "document", label: "Document" },
  { id: "bw", label: "B&W" }, { id: "grayscale", label: "Grayscale" }, { id: "color", label: "Color boost" },
];

export function EnhanceControls({ page, onChange }: { page: ScanPage; onChange: (patch: Partial<Recipe>) => void }) {
  const url = useObjectUrl(page.original);
  const quarter = Math.round(page.recipe.rotation / 90) * 90;
  const fine = Math.round((page.recipe.rotation - quarter) * 10) / 10;
  return <div className="editor-controls">
    <div className="editor-control-heading"><span>Make every detail clear</span><SlidersHorizontal size={16} /></div>
    <div className="editor-filter-grid" role="group" aria-label="Enhancement filter">{FILTERS.map((filter) => <button type="button" key={filter.id} className={`editor-filter filter-${filter.id} ${page.recipe.filter === filter.id ? "is-selected" : ""}`} aria-pressed={page.recipe.filter === filter.id} onClick={() => onChange({ filter: filter.id })}><span className="editor-filter-image">{url ? <img src={url} alt="" draggable={false} /> : null}<span className="editor-filter-check">✓</span></span><span>{filter.label}</span></button>)}</div>
    <div className="editor-divider" />
    {([{ key: "brightness", label: "Brightness", min: -100, max: 100 }, { key: "contrast", label: "Contrast", min: -100, max: 100 }, { key: "sharpness", label: "Sharpness", min: 0, max: 100 }] as const).map((slider) => <label className="editor-slider" key={slider.key}><span>{slider.label}<output>{page.recipe[slider.key] > 0 && slider.key !== "sharpness" ? "+" : ""}{page.recipe[slider.key]}</output></span><input type="range" aria-label={slider.label} min={slider.min} max={slider.max} step={1} value={page.recipe[slider.key]} onChange={(event) => onChange({ [slider.key]: Number(event.target.value) })} /></label>)}
    <div className="editor-divider" />
    <label className="editor-slider"><span>Straighten<output>{fine > 0 ? "+" : ""}{fine}°</output></span><input type="range" aria-label="Straighten" min={-15} max={15} step={0.1} value={fine} onChange={(event) => onChange({ rotation: quarter + Number(event.target.value) })} /></label>
    <div className="editor-tool-row"><Button variant="secondary" onClick={() => onChange({ rotation: page.recipe.rotation - 90 })} aria-label="Rotate 90 degrees counterclockwise"><RotateCcw size={17} />Left</Button><Button variant="secondary" onClick={() => onChange({ rotation: page.recipe.rotation + 90 })} aria-label="Rotate 90 degrees clockwise"><RotateCw size={17} />Right</Button><Button variant="secondary" aria-pressed={page.recipe.flipX} onClick={() => onChange({ flipX: !page.recipe.flipX })}><FlipHorizontal size={17} />Flip</Button></div>
    <p className="editor-footnote">Your original stays untouched. Adjustments apply when you export.</p>
  </div>;
}
