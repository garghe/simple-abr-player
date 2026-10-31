// Injected by vite.config.ts from package.json ("version" and "releaseDate").
declare const __APP_VERSION__: string;
declare const __RELEASE_DATE__: string;

export const APP_VERSION = __APP_VERSION__;
/** YYYY-MM-DD, or '' while the version is not released yet. */
export const RELEASE_DATE = __RELEASE_DATE__;

const CHANGELOG_URL = 'https://github.com/garghe/simple-abr-player/blob/main/CHANGELOG.md';

/** "31 Oct 2026" (UTC, so it reads the same everywhere). */
export function formatReleaseDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Header label: "v1.0.0 · 31 Oct 2026", or "v1.1.0 · pre-release". */
export function renderVersion(el: HTMLAnchorElement): void {
  const date = RELEASE_DATE ? formatReleaseDate(RELEASE_DATE) : 'pre-release';
  el.textContent = `v${APP_VERSION} · ${date}`;
  el.href = CHANGELOG_URL;
  el.title = RELEASE_DATE ? `PlayProbe ${APP_VERSION}, released ${date}. Open the changelog` : `PlayProbe ${APP_VERSION} (not released yet). Open the changelog`;
}
