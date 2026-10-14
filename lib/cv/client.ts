'use client';

import { ASSET_INTEGRITY } from '../asset-integrity';
import type { DetectionResult, ScanMode, ScanPage } from '../types';
import { assertDimensions } from './geometry';
import { verifiedScriptUrl, verifyBytes, type Request, type Response, type TrustedTypesFactory } from './protocol';

type Payload = Request extends infer R ? R extends Request ? Omit<R, 'id'> : never : never;
type Result = DetectionResult | Blob | null;
interface Pending { resolve(value: Result): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }

let worker: Worker | null = null;
let starting: Promise<Worker> | null = null;
let generation = 0;
let nextId = 0;
const pending = new Map<number, Pending>();

function dispatch(target: Worker, payload: Payload, transfer: Transferable[] = []): Promise<Result> {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      disposeCV('The scanner took too long. Try a smaller image or reload the app.');
    }, payload.action === 'render' ? 120_000 : 45_000);
    pending.set(id, { resolve, reject, timer });
    try { target.postMessage({ ...payload, id }, transfer); }
    catch {
      clearTimeout(timer); pending.delete(id);
      reject(new Error('The scan could not be sent to the offline engine.'));
    }
  });
}

async function ensureWorker(): Promise<Worker> {
  if (starting) return starting;
  if (worker) return worker;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') throw new Error('This browser needs an update to use the offline scanner.');
  const currentGeneration = generation;
  const promise = (async () => {
    const workerPath = '/cv/worker.js';
    const response = await fetch(workerPath, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('The scanner engine is unavailable. Connect once to finish installing the app.');
    const bytes = await response.arrayBuffer();
    await verifyBytes(bytes, ASSET_INTEGRITY[workerPath]);
    if (generation !== currentGeneration) throw new Error('The scanner session was cleared.');
    const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
    try {
      const factory = (globalThis as unknown as { trustedTypes?: TrustedTypesFactory }).trustedTypes;
      const target = new Worker(verifiedScriptUrl(url, 'vaultscan-cv-worker', factory), { name: 'Vaultscan offline scanner' });
      worker = target;
      target.onmessage = (event: MessageEvent<Response>) => {
        const response = event.data;
        const request = pending.get(response.id);
        if (!request) return;
        clearTimeout(request.timer); pending.delete(response.id);
        if (response.ok) request.resolve(response.result);
        else request.reject(new Error(response.error));
      };
      target.onerror = (event) => {
        event.preventDefault();
        disposeCV('The offline scanner stopped. Reload the app and try again.');
      };
      target.onmessageerror = () => disposeCV('The scanner returned an unreadable result. Try again.');
      await dispatch(target, { action: 'warm' });
      if (generation !== currentGeneration) throw new Error('The scanner session was cleared.');
      return target;
    } finally { URL.revokeObjectURL(url); }
  })();
  starting = promise;
  try { return await promise; }
  catch (error) {
    if (generation === currentGeneration) disposeCV();
    throw error;
  } finally {
    if (starting === promise) starting = null;
  }
}

export async function warmCV(): Promise<void> { await ensureWorker(); }

export async function detectBlob(blob: Blob, mode: ScanMode): Promise<DetectionResult> {
  const target = await ensureWorker();
  return await dispatch(target, { action: 'detect', source: blob, mode }) as DetectionResult;
}

/** Ownership transfers to the worker; the caller must not reuse the bitmap. */
export async function detectFrame(bitmap: ImageBitmap, mode: ScanMode): Promise<DetectionResult> {
  try {
    assertDimensions(bitmap.width, bitmap.height);
    const target = await ensureWorker();
    return await dispatch(target, { action: 'detect', source: bitmap, mode }, [bitmap]) as DetectionResult;
  } catch (error) { bitmap.close(); throw error; }
}

/** Only crop and recipe are rendered here. Export burns redactions and watermark. */
export async function renderPage(page: ScanPage): Promise<Blob> {
  const target = await ensureWorker();
  return await dispatch(target, { action: 'render', page: { ...page, redactions: [] } }) as Blob;
}

export function disposeCV(reason = 'The scanner session was cleared.'): void {
  generation++;
  worker?.terminate(); worker = null; starting = null;
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(reason)); }
  pending.clear();
}
