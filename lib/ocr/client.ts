'use client';

import type { Page as RecognizedPage } from 'tesseract.js';
import { ASSET_INTEGRITY } from '@/lib/asset-integrity';
import { verifiedScriptUrl, verifyBytes, type TrustedTypesFactory } from '@/lib/cv/protocol';
import { canvasBlob, canvasContext, loadPixels, makeCanvas, releaseCanvas } from '@/lib/export/strip';
import type { OcrLanguage, OcrPage } from './types';

type Progress = (progress: { status: string; progress: number }) => void;
type Packet = { jobId: string; status: 'progress' | 'resolve' | 'reject'; data: unknown };
type Pending = { resolve(value: unknown): void; reject(reason: Error): void; timer: ReturnType<typeof setTimeout> };

async function verifiedAsset(path: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(path, { credentials: 'same-origin', signal });
  if (!response.ok) throw new Error('OCR files are unavailable. Connect once and wait for Offline-ready, then try again.');
  const bytes = await response.arrayBuffer();
  await verifyBytes(bytes, ASSET_INTEGRITY[path]);
  signal?.throwIfAborted();
  return bytes;
}

/** One bounded worker per batch. No Tesseract IndexedDB cache or remote asset fallback. */
export async function createOcrEngine(language: OcrLanguage, onProgress?: Progress, signal?: AbortSignal) {
  if (!['eng', 'fra', 'eng+fra'].includes(language)) throw new Error('Choose English, French, or English + French for recognition.');
  signal?.throwIfAborted();
  const bytes = await verifiedAsset('/ocr/worker.js', signal);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
  let worker: Worker;
  try {
    const factory = (globalThis as unknown as { trustedTypes?: TrustedTypesFactory }).trustedTypes;
    worker = new Worker(verifiedScriptUrl(url, 'vaultscan-ocr-worker', factory), { name: 'Vaultscan offline text recognition' });
  } finally { URL.revokeObjectURL(url); }
  let ended = false;
  let job = 0;
  let recognizing = false;
  const pending = new Map<string, Pending>();
  const stop = (reason: Error) => {
    if (ended) return;
    ended = true;
    worker.terminate();
    signal?.removeEventListener('abort', abort);
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(reason); }
    pending.clear();
  };
  const abort = () => stop(new DOMException('Text recognition cancelled.', 'AbortError'));
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  worker.onmessage = ({ data }: MessageEvent<Packet>) => {
    if (!data || typeof data !== 'object' || typeof data.jobId !== 'string' || !['progress', 'resolve', 'reject'].includes(data.status)) {
      stop(new Error('The text recognition engine returned an unreadable result. Try again.'));
      return;
    }
    const request = pending.get(data.jobId);
    if (!request || ended) return;
    if (data.status === 'progress') {
      const progress = data.data as { status: string; progress: number } | null;
      if (!progress || typeof progress.status !== 'string' || !Number.isFinite(progress.progress)) {
        stop(new Error('The text recognition engine returned an unreadable result. Try again.'));
        return;
      }
      onProgress?.({ status: progress.status, progress: Math.max(0, Math.min(1, progress.progress)) });
      return;
    }
    clearTimeout(request.timer); pending.delete(data.jobId);
    if (data.status === 'resolve') request.resolve(data.data);
    else request.reject(new Error('Text recognition failed. Try a clearer scan or a different language.'));
  };
  worker.onerror = (event) => { event.preventDefault(); stop(new Error('The text recognition engine stopped. Try fewer or smaller pages.')); };
  worker.onmessageerror = () => stop(new Error('The text recognition engine returned an unreadable result. Try again.'));
  function dispatch(action: string, payload: unknown, transfer: Transferable[] = []): Promise<unknown> {
    if (ended) return Promise.reject(signal?.aborted ? new DOMException('Text recognition cancelled.', 'AbortError') : new Error('The text recognition engine has closed.'));
    const jobId = `ocr-${++job}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => stop(new Error('Text recognition took too long. Try a smaller page or fewer pages.')), 180_000);
      pending.set(jobId, { resolve, reject, timer });
      try { worker.postMessage({ workerId: 'vaultscan', jobId, action, payload }, transfer); }
      catch { clearTimeout(timer); pending.delete(jobId); reject(new Error('The page could not be sent to text recognition.')); }
    });
  }
  try {
    // The pinned LSTM core (including WASM) is embedded in the verified worker.
    await dispatch('load', { options: { lstmOnly: true, logging: false } });
    const langs = await Promise.all(language.split('+').map(async (code) => ({ code, data: new Uint8Array(await verifiedAsset(`/ocr/lang/${code}.traineddata.gz`, signal)) })));
    await dispatch('loadLanguage', { langs, options: { cacheMethod: 'none', gzip: true, lstmOnly: true } }, langs.map(({ data }) => data.buffer));
    await dispatch('initialize', { langs: language, oem: 1, config: { user_defined_dpi: '200' } });
  } catch (error) {
    stop(error instanceof Error ? error : new Error('The text recognition engine could not start.'));
    throw error;
  }
  return {
    async recognize(blob: Blob): Promise<OcrPage> {
      if (recognizing) throw new Error('Wait for the current page to finish recognition.');
      recognizing = true;
      let canvas: HTMLCanvasElement | undefined;
      try {
        signal?.throwIfAborted();
        const pixels = await loadPixels(blob);
        let width: number, height: number;
        let input: Blob;
        try {
          const scale = Math.min(1, 6000 / Math.max(pixels.width, pixels.height), Math.sqrt(12_000_000 / (pixels.width * pixels.height)));
          width = Math.max(1, Math.floor(pixels.width * scale)); height = Math.max(1, Math.floor(pixels.height * scale));
          if (scale < 1) {
            canvas = makeCanvas(width, height);
            const context = canvasContext(canvas);
            context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
            context.drawImage(pixels.source, 0, 0, width, height);
            input = await canvasBlob(canvas);
          } else input = blob;
        } finally { pixels.release(); }
        signal?.throwIfAborted();
        const image = new Uint8Array(await input.arrayBuffer());
        const result = await dispatch('recognize', { image, options: { rotateAuto: false }, output: { text: true, blocks: true } }, [image.buffer]) as RecognizedPage;
        const words = (result.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words)))
          .filter((word) => word.text.trim() && [word.bbox.x0, word.bbox.y0, word.bbox.x1, word.bbox.y1].every(Number.isFinite))
          .map(({ text, confidence, bbox }) => ({ text, confidence, bbox: { ...bbox } }));
        return { text: result.text ?? '', confidence: result.confidence ?? 0, width, height, words };
      } finally { recognizing = false; if (canvas) releaseCanvas(canvas); }
    },
    async terminate(): Promise<void> { stop(new Error('Text recognition finished.')); },
  };
}
