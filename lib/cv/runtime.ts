export type CV = typeof import('@techstark/opencv-js');
export type CVMat = InstanceType<CV['Mat']>;

interface RuntimeScope {
  cv?: CV & { then?: (callback: (module: CV) => void, rejected: () => void) => void };
}

let runtime: Promise<{ cv: CV }> | null = null;

/** The engine banner is part of the integrity-verified worker, including WASM. */
export function loadRuntime(): Promise<{ cv: CV }> {
  if (runtime) return runtime;
  runtime = new Promise<{ cv: CV }>((resolve, reject) => {
    const engineModule = (globalThis as unknown as RuntimeScope).cv;
    const timeout = setTimeout(() => reject(new Error('The scanner engine took too long to start. Try reloading.')), 30_000);
    const ready = (cv: CV | undefined) => {
      clearTimeout(timeout);
      if (!cv?.Mat) { reject(new Error('The scanner engine could not start on this browser.')); return; }
      // Wrap modules because some Emscripten builds expose a self-thenable.
      resolve({ cv });
    };
    const failed = () => { clearTimeout(timeout); reject(new Error('The scanner engine could not start on this browser.')); };
    if (engineModule?.then) engineModule.then(ready, failed);
    else ready(engineModule);
  });
  runtime.catch(() => { runtime = null; });
  return runtime;
}
