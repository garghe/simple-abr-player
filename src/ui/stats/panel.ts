import type { AudioEngine } from '../../audio/engine';
import type { PlayerController } from '../../player/controller';
import { AudioTab } from './audio';
import type { ScteEvent } from '../../scte/monitor';
import { h } from '../dom';
import { DeviceTab } from './device';
import { DrmTab } from './drm';
import { LogTab } from './log';
import { ManifestTab } from './manifest';
import { NetworkTab } from './network';
import { OverviewTab } from './overview';
import { ScteTab } from './scte';
import { TracksTab } from './tracks';

interface Tab {
  id: string;
  label: string;
  view: { el: HTMLElement; render(): void };
  /** Controller events that should re-render this tab. */
  events: string[];
  count?: () => number;
}

const TAB_KEY = 'sap.tab.v1';

/** Tabbed "stats for nerds" side panel. Only the visible tab re-renders. */
export class StatsPanel {
  private tabs: Tab[];
  private active: Tab;
  private buttons = new Map<string, HTMLButtonElement>();
  readonly scteTab: ScteTab;
  private pending = false;

  constructor(
    ctrl: PlayerController,
    nav: HTMLElement,
    private readonly body: HTMLElement,
    audio: AudioEngine,
    openDrmSettings: () => void,
  ) {
    this.scteTab = new ScteTab(ctrl);
    this.tabs = [
      { id: 'overview', label: 'Overview', view: new OverviewTab(ctrl), events: ['tick', 'loaded', 'tracks'] },
      { id: 'tracks', label: 'Tracks', view: new TracksTab(ctrl), events: ['tracks', 'loaded'] },
      { id: 'audio', label: 'Audio', view: new AudioTab(ctrl, audio), events: ['audio', 'tracks', 'loaded', 'documents'] },
      { id: 'drm', label: 'DRM', view: new DrmTab(ctrl, openDrmSettings), events: ['drm', 'loaded', 'tracks'], count: () => ctrl.drm.exchanges.filter((x) => x.error).length },
      { id: 'scte', label: 'SCTE-35', view: this.scteTab, events: ['scte', 'tick', 'loaded'], count: () => ctrl.scte.size },
      { id: 'network', label: 'Network', view: new NetworkTab(ctrl), events: ['network'], count: () => ctrl.network.filter((e) => e.error).length },
      { id: 'manifest', label: 'Manifest', view: new ManifestTab(ctrl), events: ['documents'] },
      { id: 'device', label: 'Device', view: new DeviceTab(), events: [] },
      { id: 'log', label: 'Log', view: new LogTab(ctrl), events: ['log'] },
    ];
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(TAB_KEY);
    } catch {
      /* storage unavailable */
    }
    this.active = this.tabs.find((t) => t.id === saved) ?? this.tabs[0];

    for (const tab of this.tabs) {
      const btn = h('button', { type: 'button', role: 'tab', class: 'tab', onclick: () => this.show(tab.id) }, tab.label);
      this.buttons.set(tab.id, btn);
      nav.append(btn);
    }

    const events = new Set(this.tabs.flatMap((t) => t.events));
    for (const name of events) {
      ctrl.on(name, () => {
        if (this.active.events.includes(name)) this.schedule();
        this.renderCounts();
      });
    }
    this.show(this.active.id);
  }

  show(id: string) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.active = tab;
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch {
      /* storage unavailable */
    }
    for (const [tid, btn] of this.buttons) {
      btn.setAttribute('aria-selected', String(tid === id));
    }
    this.body.replaceChildren(tab.view.el);
    tab.view.render();
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
      const btn = this.buttons.get(tab.id)!;
      btn.replaceChildren(tab.label, n ? h('span', { class: `count ${tab.id === 'network' || tab.id === 'drm' ? 'warn' : ''}` }, String(n)) : '');
    }
  }
}
