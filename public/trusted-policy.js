/* Only framework-owned, same-origin script paths may reach Trusted Types sinks. */
if (globalThis.trustedTypes && !globalThis.trustedTypes.defaultPolicy) {
  globalThis.trustedTypes.createPolicy('default', {
    createScriptURL(value) {
      const url = new URL(value, globalThis.location.href);
      if (url.origin === globalThis.location.origin && (url.pathname.startsWith('/_next/static/') || url.pathname === '/sw.js' || url.pathname === '/pdf/pdf.worker.min.mjs')) return url.href;
      throw new TypeError('Untrusted script URL blocked');
    },
    createHTML(value) { if (value === '') return ''; throw new TypeError('HTML injection blocked'); }
  });
}
