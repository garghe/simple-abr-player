import { h } from './dom';

export type ViewMode = 'inspect' | 'monitor';

const KEY = 'sap.view.v1';

/** Remembered choice per kind of stream, e.g. "always Inspect for live". */
interface Prefs {
  live?: ViewMode;
  vod?: ViewMode;
}

function readPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/** Default view for a stream: the remembered choice, else Monitor for live and Inspect for VOD. */
export function defaultView(live: boolean, prefs: Prefs = readPrefs()): ViewMode {
  return (live ? prefs.live : prefs.vod) ?? (live ? 'monitor' : 'inspect');
}

export const parseView = (v: string | null | undefined): ViewMode | null => (v === 'inspect' || v === 'monitor' ? v : null);

/**
 * Inspect | Monitor. The mode is a data attribute on <body> that the layout
 * CSS follows; switching while a stream plays remembers the choice for that
 * kind of stream (live or VOD).
 */
export class ViewModeSwitch {
  mode: ViewMode = 'inspect';
  private buttons = new Map<ViewMode, HTMLButtonElement>();
  private listeners = new Set<(m: ViewMode) => void>();
  /** Live or VOD of the stream on screen; null when nothing is loaded. */
  live: boolean | null = null;

  constructor(container: HTMLElement) {
    for (const [m, label, title] of [
      ['inspect', 'Inspect', 'Stream summary: health, loudness, ad breaks, bitrate ladder'],
      ['monitor', 'Monitor', 'Live operations: timeline, events feed, alarms'],
    ] as [ViewMode, string, string][]) {
      const b = h('button', { type: 'button', title, onclick: () => this.choose(m) }, label);
      this.buttons.set(m, b);
      container.append(b);
    }
    this.set('inspect');
  }

  onChange(fn: (m: ViewMode) => void) {
    this.listeners.add(fn);
  }

  /** User choice: applied and remembered for the current kind of stream. */
  choose(m: ViewMode) {
    if (this.live !== null) {
      const prefs = readPrefs();
      prefs[this.live ? 'live' : 'vod'] = m;
      try {
        localStorage.setItem(KEY, JSON.stringify(prefs));
      } catch {
        /* storage unavailable */
      }
    }
    this.set(m);
  }

  set(m: ViewMode) {
    this.mode = m;
    document.body.dataset.view = m;
    for (const [k, b] of this.buttons) b.setAttribute('aria-pressed', String(k === m));
    for (const fn of this.listeners) fn(m);
  }
}
