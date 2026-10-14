import { detect } from './detect';
import { render } from './warp';
import { loadRuntime, type CV } from './runtime';
import type { Request, Response } from './protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: Response): void;
}

const scope = globalThis as unknown as WorkerScope;
let cv: CV | undefined;
let queue = Promise.resolve();

scope.onmessage = (event) => {
  const request = event.data;
  // OpenCV operations are serial: multiple live frames never compete with export.
  queue = queue.then(async () => {
    try {
      let result: Response & { ok: true };
      if (request.action === 'warm') {
        cv = (await loadRuntime()).cv;
        result = { id: request.id, ok: true, result: null };
      } else {
        if (!cv) throw new Error('The scanner engine is still starting.');
        if (request.action === 'detect') result = { id: request.id, ok: true, result: await detect(cv, request.source, request.mode) };
        else result = { id: request.id, ok: true, result: await render(cv, request.page) };
      }
      scope.postMessage(result);
    } catch (error) {
      if (request.action === 'detect' && !(request.source instanceof Blob)) request.source.close();
      scope.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : 'The scan could not be processed. Try another photo.' });
    }
  });
};
