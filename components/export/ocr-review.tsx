"use client";

import { useState } from "react";
import { CheckCheck, ScanText } from "lucide-react";
import type { OcrPage } from "@/lib/ocr/types";

interface OcrReviewProps {
  pages: OcrPage[];
  mode: "searchable" | "text";
  selectedPage: number;
  onSelectPage: (index: number) => void;
  onChange: (index: number, page: OcrPage) => void;
  reviewed: boolean;
  onReviewedChange: (reviewed: boolean) => void;
  disabled: boolean;
}

export function OcrReview({ pages, mode, selectedPage, onSelectPage, onChange, reviewed, onReviewedChange, disabled }: OcrReviewProps) {
  const [onlyUncertain, setOnlyUncertain] = useState(false);
  const index = Math.min(selectedPage, pages.length - 1);
  const page = pages[index];
  if (!page) return null;
  const uncertainCount = page.words.filter((word) => word.confidence < 75).length;
  const hasText = mode === "text" ? page.text.trim().length > 0 : page.words.some((word) => word.text.trim());

  function changeWord(wordIndex: number, text: string) {
    const words = page.words.map((word, current) => current === wordIndex ? { ...word, text } : word);
    onChange(index, { ...page, words, text: words.map((word) => word.text).join(" ") });
  }

  return <section id="ocr-review" className="ocr-review" aria-labelledby="ocr-review-heading">
    <div className="ocr-review-heading"><div><ScanText size={19} /><h2 id="ocr-review-heading">Review recognized text</h2></div><span>{Math.round(page.confidence)}% confidence</span></div>
    <p className="ocr-review-description">Compare with the source scan and correct any mistakes. {mode === "searchable" ? "Each word stays in its original position in the searchable layer." : "This text is rebuilt in a clear font in your PDF."}</p>
    <div className="ocr-review-toolbar"><label htmlFor="ocr-review-page">Sheet to review<select id="ocr-review-page" value={index} disabled={disabled} onChange={(event) => onSelectPage(Number(event.target.value))}>{pages.map((_, pageIndex) => <option key={pageIndex} value={pageIndex}>Sheet {pageIndex + 1} of {pages.length}</option>)}</select></label><span>{mode === "text" ? `${page.text.length.toLocaleString()} characters` : `${page.words.length.toLocaleString()} words`}</span></div>
    {!hasText ? <p className="ocr-empty-note" role="status">No text was detected on this sheet. {mode === "text" ? "You can type the missing text below, or adjust the scan and recognize again." : "It will keep its scanned image. Adjust the scan or language and recognize again if text is missing."}</p> : null}
    {mode === "text" ? <label className="ocr-text-label" htmlFor="ocr-page-text">Recognized text — sheet {index + 1}<textarea id="ocr-page-text" value={page.text} disabled={disabled} spellCheck onChange={(event) => onChange(index, { ...page, text: event.target.value })} placeholder="Type any text that recognition missed…" /></label> : <>
      <label className="editor-checkbox ocr-uncertain-filter"><input type="checkbox" checked={onlyUncertain} onChange={(event) => setOnlyUncertain(event.target.checked)} /><span>Show only uncertain words ({uncertainCount})<small>Highlighted words have recognition confidence below 75%.</small></span></label>
      {page.words.length ? <div className="ocr-word-list" aria-label={`Recognized words on sheet ${index + 1}`}>
        {page.words.map((word, wordIndex) => onlyUncertain && word.confidence >= 75 ? null : <label key={wordIndex} className={`ocr-word ${word.confidence < 75 ? "is-uncertain" : ""}`}><span>Word {wordIndex + 1}<small>{Math.round(word.confidence)}%</small></span><input aria-label={`Word ${wordIndex + 1} on sheet ${index + 1}`} value={word.text} disabled={disabled} spellCheck onChange={(event) => changeWord(wordIndex, event.target.value)} /></label>)}
      </div> : null}
      {onlyUncertain && !uncertainCount ? <p className="editor-footnote">No words below 75% confidence. Check all words before confirming.</p> : null}
    </>}
    <label className={`editor-checkbox ocr-review-confirm ${reviewed ? "is-reviewed" : ""}`}><input type="checkbox" checked={reviewed} disabled={disabled} onChange={(event) => onReviewedChange(event.target.checked)} /><CheckCheck size={18} /><span>I have reviewed the text on all {pages.length} sheet{pages.length === 1 ? "" : "s"}.<small>{reviewed ? "Ready to download. Further corrections will ask you to confirm again." : "Check names, numbers, and reading order before exporting."}</small></span></label>
  </section>;
}
