import type { ProxyMode } from './player/proxy';

export interface Settings {
  proxyMode: ProxyMode;
  headers: string;
  lowLatency: boolean;
  autoplay: boolean;
}

const KEY = 'sap.settings.v1';
const HISTORY_KEY = 'sap.history.v1';

const DEFAULTS: Settings = { proxyMode: 'auto', headers: '', lowLatency: false, autoplay: true };

// Storage can be unavailable (private mode, blocked site data): never let it break the app.
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export const loadSettings = (): Settings => read(KEY, DEFAULTS);
export const saveSettings = (s: Settings) => write(KEY, s);

export function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function pushHistory(url: string): string[] {
  const list = [url, ...loadHistory().filter((u) => u !== url)].slice(0, 15);
  write(HISTORY_KEY, list);
  return list;
}

/** Parses "Name: value" lines into a header map. */
export function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) {
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (k) out[k] = v;
    }
  }
  return out;
}
