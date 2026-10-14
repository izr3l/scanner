'use client';
import type { toast as SonnerToast } from 'sonner';
type Message = Parameters<typeof SonnerToast>[0];
type Options = Parameters<typeof SonnerToast>[1];
type Api = typeof SonnerToast;
let requested = false;
let ready = false;
let listener: (() => void) | null = null;
const queue: Array<(api: Api) => void> = [];
export function subscribeToToastLayer(callback: () => void) { listener = callback; if (requested) callback(); return () => { if (listener === callback) listener = null; }; }
export function markToastLayerReady() { ready = true; void import('sonner').then(({ toast }) => { queue.splice(0).forEach((notify) => notify(toast)); }); }
function notify(kind: 'message' | 'success' | 'error', message: Message, options?: Options) {
  const id = options?.id ?? crypto.randomUUID();
  const show = (api: Api) => { if (kind === 'message') api(message, { ...options, id }); else api[kind](message, { ...options, id }); };
  if (ready) void import('sonner').then(({ toast }) => show(toast));
  else { queue.push(show); requested = true; listener?.(); }
  return id;
}
export const toast = Object.assign((message: Message, options?: Options) => notify('message', message, options), { success: (message: Message, options?: Options) => notify('success', message, options), error: (message: Message, options?: Options) => notify('error', message, options) });
