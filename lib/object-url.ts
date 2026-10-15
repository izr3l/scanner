type Entry = { url: string; owners: number };
const entries = new WeakMap<Blob, Entry>();

/** A URL stays valid until every image using this Blob has detached its source. */
export function acquireObjectUrl(blob: Blob) {
  let entry = entries.get(blob);
  if (!entry) {
    entry = { url: URL.createObjectURL(blob), owners: 0 };
    entries.set(blob, entry);
  }
  entry.owners++;
  let released = false;
  return {
    url: entry.url,
    release() {
      if (released) return;
      released = true;
      if (--entry.owners === 0) {
        entries.delete(blob);
        URL.revokeObjectURL(entry.url);
      }
    },
  };
}
