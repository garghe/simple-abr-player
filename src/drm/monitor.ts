import type { DeclaredProtection } from './inspect';
import { toBase64, toHex } from './transform';

export interface LicenseExchange {
  id: number;
  at: Date;
  kind: 'license' | 'certificate';
  keySystem: string;
  url: string;
  proxied: boolean;
  /** Names only: values can be secrets. */
  requestHeaders: string[];
  requestFormat: string;
  requestBytes: number;
  requestPreview: string;
  status: number | null;
  ms: number | null;
  responseBytes: number;
  responsePreview: string;
  /** How the license was found in the response. */
  detected?: string;
  error?: string;
  /** Still waiting for a response. */
  pending: boolean;
}

const MAX_EXCHANGES = 100;
const PREVIEW_BYTES = 1500;

/** Text if the bytes are readable text, otherwise base64 + hex of the start. */
export function preview(bytes: Uint8Array): string {
  if (!bytes.length) return '(empty)';
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, PREVIEW_BYTES));
    // eslint-disable-next-line no-control-regex
    if (!/[\x00-\x08\x0e-\x1f]/.test(text)) return text + (bytes.length > PREVIEW_BYTES ? ' …' : '');
  } catch {
    /* binary */
  }
  const head = bytes.subarray(0, Math.min(bytes.length, 600));
  return `binary, ${bytes.length} B\nbase64: ${toBase64(head)}${bytes.length > head.length ? '…' : ''}\nhex: ${toHex(bytes.subarray(0, 32))}${bytes.length > 32 ? '…' : ''}`;
}

/**
 * Everything the DRM tab shows: protection declared by the stream, every
 * license/certificate exchange, key statuses and expiry.
 */
export class DrmMonitor {
  readonly declared = new Map<string, DeclaredProtection>();
  readonly exchanges: LicenseExchange[] = [];
  keyStatuses: Record<string, string> = {};
  expiration = Infinity;
  /** Safari path actually used for FairPlay (MSE or native HLS). */
  safariPath: 'mse' | 'native' | null = null;
  private seq = 0;
  private listeners = new Set<() => void>();

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  reset(): void {
    this.declared.clear();
    this.exchanges.length = 0;
    this.keyStatuses = {};
    this.expiration = Infinity;
    this.safariPath = null;
    this.emit();
  }

  addDeclared(list: DeclaredProtection[]): void {
    let changed = false;
    for (const p of list) {
      const key = `${p.source}|${p.system}|${p.scheme ?? ''}`;
      const prev = this.declared.get(key);
      if (!prev) {
        this.declared.set(key, { ...p, keyIds: [...p.keyIds], details: [...p.details] });
        changed = true;
        continue;
      }
      for (const k of p.keyIds) if (!prev.keyIds.includes(k)) (prev.keyIds.push(k), (changed = true));
      for (const d of p.details) if (!prev.details.includes(d) && prev.details.length < 8) (prev.details.push(d), (changed = true));
    }
    if (changed) this.emit();
  }

  start(e: Omit<LicenseExchange, 'id' | 'at' | 'status' | 'ms' | 'responseBytes' | 'responsePreview' | 'pending'>): LicenseExchange {
    const x: LicenseExchange = { ...e, id: ++this.seq, at: new Date(), status: null, ms: null, responseBytes: 0, responsePreview: '', pending: true };
    this.exchanges.push(x);
    if (this.exchanges.length > MAX_EXCHANGES) this.exchanges.shift();
    this.emit();
    return x;
  }

  finish(x: LicenseExchange, update: Partial<LicenseExchange>): void {
    Object.assign(x, update, { pending: false });
    if (x.ms === null) x.ms = Date.now() - x.at.getTime();
    this.emit();
  }
}
