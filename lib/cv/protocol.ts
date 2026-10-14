import type { DetectionResult, ScanMode, ScanPage } from '../types';

export type Request =
  | { id: number; action: 'warm' }
  | { id: number; action: 'detect'; source: Blob | ImageBitmap; mode: ScanMode }
  | { id: number; action: 'render'; page: ScanPage };

export type Response =
  | { id: number; ok: true; result: DetectionResult | Blob | null }
  | { id: number; ok: false; error: string };

export interface TrustedPolicy {
  createScriptURL(value: string): string;
}

export interface TrustedTypesFactory {
  createPolicy(name: string, rules: { createScriptURL(value: string): string }): TrustedPolicy;
}

const policies = new WeakMap<TrustedTypesFactory, Map<string, { policy: TrustedPolicy; allowed: Set<string> }>>();

export function verifiedScriptUrl(url: string, name: string, factory?: TrustedTypesFactory): string {
  if (!factory) return url;
  let registry = policies.get(factory);
  if (!registry) { registry = new Map(); policies.set(factory, registry); }
  let entry = registry.get(name);
  if (!entry) {
    const allowed = new Set<string>();
    const policy = factory.createPolicy(name, { createScriptURL(value) {
      if (!allowed.has(value) || !value.startsWith('blob:')) throw new TypeError('Unverified script URL.');
      return value;
    } });
    entry = { allowed, policy }; registry.set(name, entry);
  }
  entry.allowed.add(url);
  return entry.policy.createScriptURL(url);
}

export async function verifyBytes(bytes: ArrayBuffer, expected: string): Promise<void> {
  if (!expected) throw new Error('The scanner integrity manifest is missing.');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actual = btoa(String.fromCharCode(...new Uint8Array(digest)));
  if (actual !== expected.replace(/^sha256-/, '')) throw new Error('Scanner integrity verification failed. Reload the app to install a complete update.');
}
