import type { AudioEngine } from '../../audio/engine';
import type { PlayerController } from '../../player/controller';
import { AudioTab } from './audio';
import type { ScteEvent } from '../../scte/monitor';
import { h } from '../dom';
import { DeviceTab } from './device';
import { DrmTab, type DrmActions } from './drm';
import { HealthTab } from './health';
import { LogTab } from './log';
import { ManifestTab } from './manifest';
import { NetworkTab } from './network';
import { OverviewTab } from './overview';
import { ScteTab } from './scte';
import { TracksTab } from './tracks';

const svg = (d: string) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

/** Icons for the side rail (Monitor view). */
const TAB_ICONS: Record<string, string> = {
  dashboard: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  overview: svg('<path d="M4 19V9M10 19V5M16 19v-6M22 19H2"/>'),
  tracks: svg('<path d="M4 6h16M4 12h16M4 18h10"/>'),
  audio: svg('<path d="M6 18V8M10 18V4M14 18v-7M18 18v-4"/>'),
  drm: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  scte: svg('<path d="M4 7h16M4 12h10M4 17h7"/><circle cx="18" cy="16" r="3"/>'),
  health: svg('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
  alarms: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  network: svg('<path d="M4 20 10 4l4 10 2-4 4 10"/>'),
  manifest: svg('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>'),
  device: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/>'),
  log: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
};

interface Tab {
  id: string;
  label: string;
  view: { el: HTMLElement; render(): void };
  /** Controller events that should re-render this tab. */
  events: string[];
  count?: () => number;
}

const TAB_KEY = 'sap.tab.v2';

/** Tabbed "stats for nerds" side panel. Only the visible tab re-renders. */
export class StatsPanel {
  private tabs: Tab[];
  private active: Tab;
  private buttons = new Map<string, HTMLButtonElement>();
  readonly scteTab: ScteTab;
  readonly healthTab: HealthTab;
  private pending = false;
  /** The tab chosen last time (restored once that tab exists). */
  private savedTab: string | null = null;

  constructor(
    private readonly ctrl: PlayerController,
    private readonly nav: HTMLElement,
    private readonly body: HTMLElement,
    audio: AudioEngine,
    drmActions: DrmActions,
  ) {
    this.scteTab = new ScteTab(ctrl);
    this.healthTab = new HealthTab(ctrl);
    this.tabs = [
      { id: 'overview', label: 'Stats', view: new OverviewTab(ctrl), events: ['tick', 'loaded', 'tracks'] },
      { id: 'tracks', label: 'Tracks', view: new TracksTab(ctrl), events: ['tracks', 'loaded'] },
      { id: 'audio', label: 'Audio', view: new AudioTab(ctrl, audio), events: ['audio', 'tracks', 'loaded', 'documents'] },
      { id: 'drm', label: 'DRM', view: new DrmTab(ctrl, drmActions), events: ['drm', 'loaded', 'tracks'], count: () => ctrl.drm.exchanges.filter((x) => x.error).length },
      { id: 'scte', label: 'SCTE-35', view: this.scteTab, events: ['scte', 'tick', 'loaded'], count: () => ctrl.scte.size },
      { id: 'health', label: 'Health', view: this.healthTab, events: ['stream', 'tick', 'loaded', 'alignment'], count: () => this.healthTab.cache.count() },
      { id: 'network', label: 'Network', view: new NetworkTab(ctrl), events: ['network'], count: () => ctrl.network.filter((e) => e.error).length },
      { id: 'manifest', label: 'Manifest', view: new ManifestTab(ctrl), events: ['documents'] },
      { id: 'device', label: 'Device', view: new DeviceTab(), events: [] },
      { id: 'log', label: 'Log', view: new LogTab(ctrl), events: ['log'] },
    ];
    try {
      this.savedTab = localStorage.getItem(TAB_KEY);
    } catch {
      /* storage unavailable */
    }
    this.active = this.tabs.find((t) => t.id === this.savedTab) ?? this.tabs[0];

    for (const tab of this.tabs) nav.append(this.button(tab));

    const events = new Set(this.tabs.flatMap((t) => t.events));
    for (const name of events) {
      ctrl.on(name, () => {
        if (this.active.events.includes(name)) this.schedule();
        this.renderCounts();
      });
    }
    this.show(this.active.id, false);
  }

  private button(tab: Tab): HTMLButtonElement {
    const btn = h('button', { type: 'button', role: 'tab', class: 'tab', title: tab.label, onclick: () => this.show(tab.id) });
    btn.dataset.tab = tab.id;
    btn.innerHTML = TAB_ICONS[tab.id] ?? TAB_ICONS.overview;
    btn.append(h('span', { class: 'tab-label' }, tab.label), h('span', { class: 'count', hidden: true }));
    this.buttons.set(tab.id, btn);
    return btn;
  }

  /** The tab on screen. */
  get current(): string {
    return this.active.id;
  }

  show(id: string, remember = true) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.active = tab;
    if (remember) {
      this.savedTab = id;
      try {
        localStorage.setItem(TAB_KEY, id);
      } catch {
        /* storage unavailable */
      }
    }
    for (const [tid, btn] of this.buttons) {
      btn.setAttribute('aria-selected', String(tid === id));
    }
    this.body.replaceChildren(tab.view.el);
    tab.view.render();
    this.renderCounts();
  }

  /** Adds a tab created outside the panel (e.g. Alarms, which needs the audio engine). `afterId` null = first. */
  addTab(tab: Tab, afterId?: string | null) {
    const i = afterId ? this.tabs.findIndex((t) => t.id === afterId) : -1;
    this.tabs.splice(afterId === null ? 0 : i >= 0 ? i + 1 : this.tabs.length, 0, tab);
    const btn = this.button(tab);
    const after = afterId ? this.buttons.get(afterId) : undefined;
    if (afterId === null) this.nav.prepend(btn);
    else if (after) after.after(btn);
    else this.nav.append(btn);
    for (const name of tab.events) {
      this.ctrl.on(name, () => {
        if (this.active === tab) this.schedule();
        this.renderCounts();
      });
    }
    // A saved tab choice may point at this tab; the dashboard is the default.
    if (this.savedTab === tab.id || (!this.savedTab && tab.id === 'dashboard')) this.show(tab.id, false);
    this.renderCounts();
  }

  showScteEvent(e: ScteEvent) {
    this.show('scte');
    this.scteTab.select(e);
  }

  private schedule() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.active.view.render();
    });
  }

  private renderCounts() {
    for (const tab of this.tabs) {
      if (!tab.count) continue;
      const n = tab.count();
      const count = this.buttons.get(tab.id)!.querySelector<HTMLElement>('.count')!;
      count.hidden = !n;
      count.textContent = n ? String(n) : '';
      count.classList.toggle('warn', ['network', 'drm', 'alarms'].includes(tab.id));
    }
  }
}
