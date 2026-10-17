"use client";

import { Check, LoaderCircle, ScanText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ExportOptions } from "@/lib/types";
import type { OcrLanguage, OcrProgress } from "@/lib/ocr/types";

const MODES = [
  { id: "scan", label: "Enhanced scan", description: "Keep your edited page as an image." },
  { id: "searchable", label: "Searchable PDF", description: "Keep the scan and add selectable, searchable text." },
  { id: "text", label: "Clean text PDF", description: "Rebuild recognized words with crisp digital fonts." },
] as const;

const PROGRESS_LABELS: Record<string, string> = {
  'loading tesseract core': 'Loading text recognition',
  'initializing tesseract': 'Preparing text recognition',
  'loading language traineddata': 'Loading document language',
  'initializing api': 'Getting ready to read',
  'recognizing text': 'Recognizing text',
};

interface OcrControlsProps {
  mode: NonNullable<ExportOptions["pdfMode"]>;
  language: OcrLanguage;
  onModeChange: (mode: NonNullable<ExportOptions["pdfMode"]>) => void;
  onLanguageChange: (language: OcrLanguage) => void;
  disabled: boolean;
  busy: boolean;
  progress: OcrProgress | null;
  error: string | null;
  hasResults: boolean;
  cancelled: boolean;
  onRecognize: () => void;
  onCancel: () => void;
}

export function OcrControls({ mode, language, onModeChange, onLanguageChange, disabled, busy, progress, error, hasResults, cancelled, onRecognize, onCancel }: OcrControlsProps) {
  const percentage = Math.round(Math.min(1, Math.max(0, progress?.progress ?? 0)) * 100);
  return <div className="ocr-controls">
    <div className="editor-control-heading"><span>Make it readable</span><ScanText size={17} /></div>
    <div className="ocr-mode-list" role="group" aria-label="PDF output">
      {MODES.map(({ id, label, description }) => <button key={id} type="button" aria-pressed={mode === id} disabled={disabled || busy} className={`ocr-mode ${mode === id ? "is-selected" : ""}`} onClick={() => onModeChange(id)}>
        <span className="ocr-mode-mark">{mode === id ? <Check size={12} /> : null}</span>
        <span><strong>{label}{id === "searchable" ? <small>RECOMMENDED</small> : null}</strong><span>{description}</span></span>
      </button>)}
    </div>
    {mode !== "scan" ? <>
      <label className="editor-field" htmlFor="ocr-language">Document language
        <select id="ocr-language" value={language} disabled={disabled || busy} onChange={(event) => onLanguageChange(event.target.value as OcrLanguage)}>
          <option value="eng">English</option><option value="fra">French</option><option value="eng+fra">English + French</option>
        </select>
      </label>
      <p className="editor-footnote">{mode === "searchable" ? "The scan keeps its appearance. Recognize and review the text layer before downloading." : "Letters become crisp typed text. Columns, tables, images, and page breaks may change; review the text before downloading."}</p>
      {busy ? <div className="ocr-progress">
        <div role="status" aria-live="polite"><LoaderCircle className="editor-spinner" size={16} /><span>{progress ? `Sheet ${progress.page} of ${progress.total} · ${PROGRESS_LABELS[progress.status] ?? progress.status}` : "Starting text recognition…"}</span><strong>{percentage}%</strong></div>
        <progress max={100} value={percentage} aria-label="Text recognition progress" />
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}><X size={14} />Cancel recognition</Button>
      </div> : <Button type="button" variant="secondary" className="ocr-recognize" disabled={disabled} onClick={onRecognize}><ScanText size={17} />{error ? "Retry text recognition" : hasResults ? "Recognize text again" : "Recognize text"}</Button>}
      {error ? <p className="ocr-error" role="alert">{error}</p> : null}
      {cancelled ? <p className="editor-footnote" role="status">Recognition cancelled. You can start again when ready.</p> : null}
      {hasResults ? <a className="ocr-review-link" href="#ocr-review">Review recognized text<Check size={14} /></a> : null}
      <p className="ocr-local-note">Text recognition runs on this device. Redactions are applied first.</p>
    </> : null}
  </div>;
}
