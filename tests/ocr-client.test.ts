import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OcrLanguage } from '../lib/ocr/types';

const mocked = vi.hoisted(() => ({
  verify: vi.fn(), scriptUrl: vi.fn(), loadPixels: vi.fn(), makeCanvas: vi.fn(),
  canvasBlob: vi.fn(), canvasContext: vi.fn(), releaseCanvas: vi.fn(),
  releasePixels: vi.fn(), drawImage: vi.fn(), fillRect: vi.fn(),
}));

vi.mock('../lib/asset-integrity', () => ({ ASSET_INTEGRITY: {
  '/ocr/worker.js': 'verified-worker', '/ocr/lang/eng.traineddata.gz': 'verified-english', '/ocr/lang/fra.traineddata.gz': 'verified-french',
} }));
vi.mock('../lib/cv/protocol', () => ({ verifyBytes: mocked.verify, verifiedScriptUrl: mocked.scriptUrl }));
vi.mock('../lib/export/strip', () => ({
  loadPixels: mocked.loadPixels, makeCanvas: mocked.makeCanvas, canvasBlob: mocked.canvasBlob,
  canvasContext: mocked.canvasContext, releaseCanvas: mocked.releaseCanvas,
}));

import { createOcrEngine } from '../lib/ocr/client';

interface Packet { workerId: string; jobId: string; action: string; payload: Record<string, unknown> }
interface Reply { jobId: string; status: string; data: unknown }
const recognition = { text: 'Readable words', confidence: 92, blocks: [{ paragraphs: [{ lines: [{ words: [
  { text: 'Readable', confidence: 94, bbox: { x0: 10, y0: 20, x1: 100, y1: 40 } },
  { text: 'words', confidence: 90, bbox: { x0: 120, y0: 20, x1: 170, y1: 40 } },
] }] }] }] };

class MockWorker {
  static instances: MockWorker[] = [];
  static held = new Set<string>();
  static throwOn: string | null = null;
  onmessage: ((event: MessageEvent<Reply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: { packet: Packet; transfer: Transferable[] }[] = [];
  terminate = vi.fn();
  constructor(public url: string, public options?: WorkerOptions) { MockWorker.instances.push(this); }
  postMessage(packet: Packet, transfer: Transferable[] = []) {
    if (packet.action === MockWorker.throwOn) throw new DOMException('Cannot clone input.', 'DataCloneError');
    this.messages.push({ packet, transfer });
    if (!MockWorker.held.has(packet.action)) queueMicrotask(() => this.reply(packet, 'resolve', packet.action === 'recognize' ? recognition : {}));
  }
  reply(packet: Packet, status: string, data: unknown) { this.onmessage?.({ data: { jobId: packet.jobId, status, data } } as MessageEvent<Reply>); }
  packet(action: string): Packet {
    const packet = this.messages.findLast((message) => message.packet.action === action)?.packet;
    if (!packet) throw new Error(`No pending ${action} request.`);
    return packet;
  }
}

const assetBytes: Record<string, Uint8Array> = {
  '/ocr/worker.js': new Uint8Array([1, 11]),
  '/ocr/lang/eng.traineddata.gz': new Uint8Array([2, 22]),
  '/ocr/lang/fra.traineddata.gz': new Uint8Array([3, 33]),
};
const fetchAsset = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
let createdUrl: ReturnType<typeof vi.spyOn>;
let revokedUrl: ReturnType<typeof vi.spyOn>;

function worker() { return MockWorker.instances.at(-1)!; }
async function posted(action: string) {
  await vi.waitFor(() => expect(worker()?.messages.some((message) => message.packet.action === action)).toBe(true));
  return worker().packet(action);
}

beforeEach(() => {
  vi.clearAllMocks();
  MockWorker.instances = []; MockWorker.held = new Set(); MockWorker.throwOn = null;
  vi.stubGlobal('Worker', MockWorker);
  fetchAsset.mockImplementation(async (input) => {
    const bytes = assetBytes[String(input)];
    if (!bytes) throw new Error(`Unexpected network request: ${String(input)}`);
    return new Response(bytes.slice().buffer);
  });
  vi.stubGlobal('fetch', fetchAsset);
  createdUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:verified-ocr');
  revokedUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  mocked.verify.mockResolvedValue(undefined);
  mocked.scriptUrl.mockImplementation((url: string) => url);
  mocked.loadPixels.mockResolvedValue({ source: { pixels: true }, width: 1000, height: 1400, release: mocked.releasePixels });
  mocked.makeCanvas.mockImplementation((width: number, height: number) => ({ width, height }));
  mocked.canvasContext.mockReturnValue({ fillStyle: '', fillRect: mocked.fillRect, drawImage: mocked.drawImage });
  mocked.canvasBlob.mockResolvedValue(new Blob(['downscaled-pixels'], { type: 'image/png' }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('verified local OCR startup', () => {
  it('rejects unsupported languages and pre-cancelled work before fetching or creating a worker', async () => {
    await expect(createOcrEngine('eng+remote' as OcrLanguage)).rejects.toThrow('Choose English');
    const controller = new AbortController(); controller.abort();
    await expect(createOcrEngine('eng', undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchAsset).not.toHaveBeenCalled();
    expect(MockWorker.instances).toHaveLength(0);
  });

  it('refuses to execute an unverified worker and creates no object URL', async () => {
    mocked.verify.mockRejectedValueOnce(new Error('Worker integrity mismatch.'));
    await expect(createOcrEngine('eng')).rejects.toThrow('integrity mismatch');
    expect(mocked.verify).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'verified-worker');
    expect(MockWorker.instances).toHaveLength(0);
    expect(createdUrl).not.toHaveBeenCalled();
  });

  it('passes verified bilingual bytes directly with caching disabled, and never requests a remote asset', async () => {
    const controller = new AbortController();
    const engine = await createOcrEngine('eng+fra', undefined, controller.signal);
    const instance = worker();
    expect(mocked.verify.mock.calls.map(([, hash]) => hash)).toEqual(['verified-worker', 'verified-english', 'verified-french']);
    expect(fetchAsset.mock.calls.map(([path]) => path)).toEqual(['/ocr/worker.js', '/ocr/lang/eng.traineddata.gz', '/ocr/lang/fra.traineddata.gz']);
    expect(fetchAsset.mock.calls.every(([, init]) => init?.credentials === 'same-origin' && init.signal === controller.signal)).toBe(true);
    expect(instance.messages.map(({ packet }) => packet.action)).toEqual(['load', 'loadLanguage', 'initialize']);
    const language = instance.messages[1];
    expect(language.packet.payload).toEqual({ langs: [
      { code: 'eng', data: new Uint8Array([2, 22]) }, { code: 'fra', data: new Uint8Array([3, 33]) },
    ], options: { cacheMethod: 'none', gzip: true, lstmOnly: true } });
    expect(language.transfer).toHaveLength(2);
    const langs = language.packet.payload.langs as { code: string; data: Uint8Array }[];
    expect(language.transfer).toEqual(langs.map(({ data }) => data.buffer));
    expect(instance.packet('initialize').payload).toEqual({ langs: 'eng+fra', oem: 1, config: { user_defined_dpi: '200' } });
    expect(mocked.scriptUrl).toHaveBeenCalledWith('blob:verified-ocr', 'vaultscan-ocr-worker', undefined);
    expect(revokedUrl).toHaveBeenCalledWith('blob:verified-ocr');
    await engine.terminate();
    expect(instance.terminate).toHaveBeenCalledTimes(1);
  });

  it('terminates the worker if a language model fails verification before any model bytes reach it', async () => {
    mocked.verify.mockImplementation(async (_bytes: ArrayBuffer, hash: string) => {
      if (hash === 'verified-french') throw new Error('French model integrity mismatch.');
    });
    await expect(createOcrEngine('fra')).rejects.toThrow('model integrity mismatch');
    expect(worker().messages.map(({ packet }) => packet.action)).toEqual(['load']);
    expect(worker().terminate).toHaveBeenCalledTimes(1);
    expect(revokedUrl).toHaveBeenCalledWith('blob:verified-ocr');
  });

  it('explains missing offline assets and releases an already started worker', async () => {
    fetchAsset.mockImplementation(async (path) => String(path).endsWith('worker.js') ? new Response(assetBytes['/ocr/worker.js'].slice().buffer) : new Response(null, { status: 404 }));
    await expect(createOcrEngine('eng')).rejects.toThrow('Offline-ready');
    expect(worker().terminate).toHaveBeenCalledTimes(1);
    expect(worker().messages.map(({ packet }) => packet.action)).toEqual(['load']);
  });

  it('cancels a pending initialization immediately and ignores replies after termination', async () => {
    MockWorker.held.add('load');
    const controller = new AbortController();
    const progress = vi.fn();
    const pending = createOcrEngine('eng', progress, controller.signal);
    const failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const load = await posted('load');
    controller.abort();
    await failure;
    worker().reply(load, 'progress', { status: 'late private status', progress: 1 });
    worker().reply(load, 'resolve', {});
    expect(progress).not.toHaveBeenCalled();
    expect(worker().terminate).toHaveBeenCalledTimes(1);
    expect(fetchAsset).toHaveBeenCalledTimes(1);
  });

  it('handles a worker crash during initialization without exposing browser or document error details', async () => {
    MockWorker.held.add('load');
    const pending = createOcrEngine('eng');
    const failure = expect(pending).rejects.toThrow('engine stopped');
    await posted('load');
    const preventDefault = vi.fn();
    worker().onerror?.({ preventDefault, message: 'private source contents' } as unknown as ErrorEvent);
    await failure;
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(worker().terminate).toHaveBeenCalledTimes(1);
  });
});

describe('bounded OCR worker requests', () => {
  it('correlates progress and results to the current request and rejects overlapping pages', async () => {
    MockWorker.held.add('recognize');
    const progress = vi.fn();
    const engine = await createOcrEngine('eng', progress);
    const pending = engine.recognize(new Blob(['redacted-page']));
    const packet = await posted('recognize');
    await expect(engine.recognize(new Blob(['another-page']))).rejects.toThrow('current page');
    worker().reply({ ...packet, jobId: 'unrelated-request' }, 'progress', { status: 'unrelated', progress: 0.5 });
    worker().reply(packet, 'progress', { status: 'recognizing text', progress: 2 });
    expect(progress.mock.calls).toEqual([[{ status: 'recognizing text', progress: 1 }]]);
    worker().reply(packet, 'resolve', recognition);
    await expect(pending).resolves.toMatchObject({ text: 'Readable words', confidence: 92, width: 1000, height: 1400, words: recognition.blocks[0].paragraphs[0].lines[0].words });
    expect(mocked.loadPixels).toHaveBeenCalledTimes(1);
    expect(mocked.releasePixels).toHaveBeenCalledTimes(1);
    await engine.terminate();
  });

  it('turns worker rejection into a safe retryable error and clears the in-flight page lock', async () => {
    MockWorker.held.add('recognize');
    const engine = await createOcrEngine('eng');
    const pending = engine.recognize(new Blob(['page']));
    const failure = expect(pending).rejects.toThrow('Try a clearer scan');
    worker().reply(await posted('recognize'), 'reject', 'secret document OCR debug output');
    await failure;
    MockWorker.held.delete('recognize');
    await expect(engine.recognize(new Blob(['retry']))).resolves.toMatchObject({ text: 'Readable words' });
    expect(mocked.releasePixels).toHaveBeenCalledTimes(2);
    await engine.terminate();
  });

  it('rejects an unreadable worker response instead of leaving the request pending', async () => {
    MockWorker.held.add('recognize');
    const engine = await createOcrEngine('eng');
    const pending = engine.recognize(new Blob(['page']));
    const failure = expect(pending).rejects.toThrow('unreadable result');
    await posted('recognize');
    worker().onmessageerror?.();
    await failure;
    expect(worker().terminate).toHaveBeenCalledTimes(1);
    await engine.terminate();
    expect(worker().terminate).toHaveBeenCalledTimes(1);
  });

  it.each<{ name: string; corrupt: (packet: Packet) => unknown }>([
    { name: 'null packet', corrupt: () => null },
    { name: 'missing job ID', corrupt: () => ({ status: 'resolve', data: {} }) },
    { name: 'unknown response status', corrupt: (packet) => ({ jobId: packet.jobId, status: 'unexpected', data: {} }) },
    { name: 'null progress data', corrupt: (packet) => ({ jobId: packet.jobId, status: 'progress', data: null }) },
    { name: 'non-finite progress', corrupt: (packet) => ({ jobId: packet.jobId, status: 'progress', data: { status: 'recognizing', progress: NaN } }) },
  ])('rejects a $name promptly and terminates the worker', async ({ corrupt }) => {
    MockWorker.held.add('recognize');
    const engine = await createOcrEngine('eng');
    const pending = engine.recognize(new Blob(['page']));
    const failure = expect(pending).rejects.toThrow('unreadable result');
    const packet = await posted('recognize');
    expect(() => worker().onmessage?.({ data: corrupt(packet) } as MessageEvent<Reply>)).not.toThrow();
    await failure;
    expect(worker().terminate).toHaveBeenCalledTimes(1);
  });

  it('aborts an active recognition, rejects the caller, and ignores late results', async () => {
    MockWorker.held.add('recognize');
    const controller = new AbortController();
    const progress = vi.fn();
    const engine = await createOcrEngine('eng', progress, controller.signal);
    const pending = engine.recognize(new Blob(['page']));
    const failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const packet = await posted('recognize');
    controller.abort();
    await failure;
    worker().reply(packet, 'resolve', recognition);
    worker().reply(packet, 'progress', { status: 'late', progress: 1 });
    expect(progress).not.toHaveBeenCalled();
    expect(worker().terminate).toHaveBeenCalledTimes(1);
    expect(mocked.releasePixels).toHaveBeenCalledTimes(1);
    await expect(engine.recognize(new Blob(['retry']))).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('terminates a stuck request at the time limit and rejects further worker jobs', async () => {
    MockWorker.held.add('recognize');
    const engine = await createOcrEngine('eng');
    vi.useFakeTimers();
    const pending = engine.recognize(new Blob(['page']));
    const failure = expect(pending).rejects.toThrow('took too long');
    await posted('recognize');
    await vi.advanceTimersByTimeAsync(180_000);
    await failure;
    expect(worker().terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await expect(engine.recognize(new Blob(['retry']))).rejects.toThrow('closed');
  });

  it('cleans up a failed postMessage and permits a later valid page', async () => {
    const engine = await createOcrEngine('eng');
    MockWorker.throwOn = 'recognize';
    await expect(engine.recognize(new Blob(['page']))).rejects.toThrow('could not be sent');
    MockWorker.throwOn = null;
    await expect(engine.recognize(new Blob(['retry']))).resolves.toMatchObject({ text: 'Readable words' });
    expect(mocked.releasePixels).toHaveBeenCalledTimes(2);
    await engine.terminate();
  });

  it('downscales large decoded pages before sending image bytes and releases both resources', async () => {
    mocked.loadPixels.mockResolvedValue({ source: { pixels: true }, width: 12000, height: 4000, release: mocked.releasePixels });
    const engine = await createOcrEngine('fra');
    const result = await engine.recognize(new Blob(['large-redacted-source']));
    expect(result.width).toBe(6000);
    expect(result.height).toBe(2000);
    expect(result.width * result.height).toBeLessThanOrEqual(12_000_000);
    expect(mocked.fillRect).toHaveBeenCalledWith(0, 0, 6000, 2000);
    const packet = worker().packet('recognize');
    expect(new TextDecoder().decode(packet.payload.image as Uint8Array)).toBe('downscaled-pixels');
    expect(worker().messages.at(-1)?.transfer).toEqual([(packet.payload.image as Uint8Array).buffer]);
    expect(mocked.releasePixels).toHaveBeenCalledTimes(1);
    expect(mocked.releaseCanvas).toHaveBeenCalledWith(expect.objectContaining({ width: 6000, height: 2000 }));
    await engine.terminate();
  });
});
