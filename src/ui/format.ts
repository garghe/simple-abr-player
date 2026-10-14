const displayNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' });
  } catch {
    return null;
  }
})();

export function languageName(code: string | null | undefined): string {
  if (!code || code === 'und') return 'Unknown';
  try {
    const name = displayNames?.of(code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

/** Short language label for menus: "English", or the code when unknown. */
export function languageShort(code: string | null | undefined): string {
  if (!code || code === 'und') return 'Unknown';
  try {
    return displayNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '--:--';
  const sign = seconds < 0 ? '-' : '';
  const s = Math.abs(seconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return hh ? `${sign}${hh}:${pad(mm)}:${pad(ss)}` : `${sign}${pad(mm)}:${pad(ss)}`;
}

export function formatPrecise(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  return `${seconds.toFixed(3)}s`;
}

export function formatBitrate(bps: number | null | undefined): string {
  if (!bps || !Number.isFinite(bps)) return '—';
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(2)} Mbps`;
  return `${Math.round(bps / 1e3)} kbps`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function clock(d: Date | null | undefined): string {
  if (!d) return '—';
  return d.toISOString().slice(11, 23);
}

export function shortUri(uri: string, max = 60): string {
  try {
    const u = new URL(uri);
    const tail = u.pathname.split('/').slice(-2).join('/') + u.search;
    return tail.length > max ? '…' + tail.slice(-max) : tail;
  } catch {
    return uri.length > max ? '…' + uri.slice(-max) : uri;
  }
}

export function channels(n: number | null | undefined): string {
  if (!n) return '';
  return ({ 1: 'mono', 2: 'stereo', 6: '5.1', 8: '7.1' } as Record<number, string>)[n] ?? `${n}ch`;
}
