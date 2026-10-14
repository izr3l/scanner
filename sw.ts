/// <reference lib="webworker" />
import { Serwist, type PrecacheEntry } from 'serwist';
declare const self: ServiceWorkerGlobalScope & { __SW_MANIFEST: Array<PrecacheEntry | string> };
const serwist = new Serwist({ precacheEntries: self.__SW_MANIFEST, skipWaiting: false, clientsClaim: true, navigationPreload: false, runtimeCaching: [], precacheOptions: { ignoreURLParametersMatching: [/^_rsc$/] } });
// Next uses HEAD to check static routes. Answer from the same public-asset
// precache so those checks also work with the network disabled.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'HEAD') return;
  event.respondWith((async () => {
    const url = new URL(event.request.url);
    url.searchParams.delete('_rsc');
    if (url.pathname.endsWith('/')) url.pathname += 'index.html';
    const cached = await serwist.matchPrecache(url.href);
    if (cached) return new Response(null, { status: cached.status, statusText: cached.statusText, headers: cached.headers });
    return fetch(event.request);
  })());
});
serwist.addEventListeners();
self.addEventListener('message', (event) => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
