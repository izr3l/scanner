import { expect, type Page } from "@playwright/test";

type ObjectUrlAudit = {
  created: Record<string, { type: string; revokes: number }>;
  violations: string[];
};

declare global {
  interface Window { testObjectUrls: ObjectUrlAudit }
}

/** Observe native browser URLs without changing resource loading or cleanup timing. */
export async function monitorObjectUrls(page: Page) {
  await page.addInitScript(() => {
    const audit: ObjectUrlAudit = window.testObjectUrls = { created: {}, violations: [] };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (source) => {
      const url = create(source);
      audit.created[url] = { type: source instanceof Blob ? source.type : "MediaSource", revokes: 0 };
      return url;
    };
    URL.revokeObjectURL = (url) => {
      const owner = audit.created[url];
      if (owner) {
        owner.revokes += 1;
        if (owner.revokes > 1) audit.violations.push(`URL revoked more than once: ${url}`);
      }
      for (const image of document.querySelectorAll("img")) {
        if (image.getAttribute("src") === url) audit.violations.push(`Connected image still references revoked URL: ${image.alt || image.className} (${url})`);
      }
      revoke(url);
    };
    const checkSource = (image: Element, source: string) => {
      if (image.tagName === "IMG" && audit.created[source]?.revokes) audit.violations.push(`Image assigned an already revoked URL: ${source}`);
    };
    const setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (name.toLowerCase() === "src") checkSource(this, value);
      setAttribute.call(this, name, value);
    };
    const source = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      ...source,
      set(this: HTMLImageElement, value: string) {
        checkSource(this, value);
        source.set!.call(this, value);
      },
    });
  });
}

export async function assertObjectUrlsSafe(page: Page, allReleased = false) {
  const audit = await page.evaluate(() => window.testObjectUrls);
  expect(audit.violations).toEqual([]);
  if (allReleased) expect(Object.entries(audit.created).filter(([, owner]) => owner.revokes !== 1)).toEqual([]);
}
