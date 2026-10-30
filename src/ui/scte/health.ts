import type { PlayerController } from '../../player/controller';
import type { HealthIssue, Severity } from '../../scte/health';
import { DEFAULT_MIN_LEAD } from '../../scte/timing';
import { badge, h } from '../dom';
import { formatTime } from '../format';

const LEAD_KEY = 'sap.scteMinLead.v1';

export const SEVERITY_BADGE: Record<Severity, [string, string]> = {
  error: ['error', 'warn'],
  warn: ['warning', 'out'],
  info: ['note', 'other'],
};

/**
 * Cached health checks: recomputed when the markers change, and every few
 * seconds for live streams (lead times and open breaks depend on the edge).
 */
export class HealthCache {
  private issues: HealthIssue[] = [];
  private version = -1;
  private at = 0;
  minLead = DEFAULT_MIN_LEAD;

  constructor(private readonly ctrl: PlayerController) {
    try {
      const v = Number(localStorage.getItem(LEAD_KEY));
      if (v > 0) this.minLead = v;
    } catch {
      /* storage unavailable */
    }
  }

  setMinLead(v: number) {
    this.minLead = v;
    this.version = -1;
    try {
      localStorage.setItem(LEAD_KEY, String(v));
    } catch {
      /* storage unavailable */
    }
  }

  get(): HealthIssue[] {
    const v = this.ctrl.scte.version;
    if (v !== this.version || Date.now() - this.at > 5000) {
      this.issues = this.ctrl.scteHealth(this.minLead);
      this.version = v;
      this.at = Date.now();
    }
    return this.issues;
  }

  /** Issues per marker key. */
  byMarker(): Map<string, HealthIssue[]> {
    const map = new Map<string, HealthIssue[]>();
    for (const i of this.get()) for (const k of i.keys) map.set(k, [...(map.get(k) ?? []), i]);
    return map;
  }
}

export function countBySeverity(issues: HealthIssue[]): Record<Severity, number> {
  const c = { error: 0, warn: 0, info: 0 };
  for (const i of issues) c[i.severity]++;
  return c;
}

export function severitySummary(issues: HealthIssue[]): HTMLElement {
  const c = countBySeverity(issues);
  if (!c.error && !c.warn && !c.info) return h('span', null, badge('no issues', 'ok'));
  const parts: HTMLElement[] = [];
  if (c.error) parts.push(badge(`${c.error} error${c.error > 1 ? 's' : ''}`, 'warn'));
  if (c.warn) parts.push(badge(`${c.warn} warning${c.warn > 1 ? 's' : ''}`, 'out'));
  if (c.info) parts.push(badge(`${c.info} note${c.info > 1 ? 's' : ''}`, 'other'));
  return h('span', { class: 'sev-summary' }, parts);
}

/** Health sub-view: issues grouped by check, each linking to its marker. */
export class HealthView {
  readonly el = h('div', { class: 'scte-health' });
  private lead = h('input', { type: 'number', min: '0', step: '0.5', class: 'lead-input', 'aria-label': 'Minimum lead time in seconds' });
  private head = h('div', { class: 'toolbar' });
  private body = h('div');
  private open = new Set<string>();

  constructor(
    private readonly ctrl: PlayerController,
    private readonly cache: HealthCache,
    private readonly select: (key: string) => void,
  ) {
    this.lead.value = String(cache.minLead);
    this.lead.addEventListener('change', () => {
      const v = Number(this.lead.value);
      if (v >= 0) cache.setMinLead(v);
      this.render();
    });
    this.el.append(this.head, this.body);
  }

  render() {
    const issues = this.cache.get();
    this.head.replaceChildren(
      severitySummary(issues),
      h('span', { class: 'spacer' }),
      h('label', { class: 'small muted' }, 'Warn below ', this.lead, ' s lead time'),
    );
    if (!this.ctrl.scte.size) {
      this.body.replaceChildren(h('p', { class: 'muted' }, 'Checks run once markers arrive.'));
      return;
    }
    const groups = new Map<string, HealthIssue[]>();
    for (const i of issues) groups.set(`${i.severity}|${i.title}`, [...(groups.get(`${i.severity}|${i.title}`) ?? []), i]);
    this.body.replaceChildren(
      ...(issues.length
        ? [...groups].map(([id, list]) => {
            const [label, kind] = SEVERITY_BADGE[list[0].severity];
            const details = h(
              'details',
              { class: `issue-group ${list[0].severity}`, open: this.open.has(id) || list.length === 1 },
              h('summary', null, badge(label, kind), ' ', h('strong', null, list[0].title), list.length > 1 ? h('span', { class: 'muted' }, ` ×${list.length}`) : ''),
              h(
                'ul',
                { class: 'issues' },
                list.slice(0, 100).map((i) =>
                  h(
                    'li',
                    null,
                    i.time !== null
                      ? h('button', { type: 'button', class: 'linklike mono', title: 'Show this marker', onclick: () => i.keys[0] && this.select(i.keys[0]) }, formatTime(i.time))
                      : h('span', { class: 'mono muted' }, '?'),
                    ' ',
                    i.detail,
                  ),
                ),
                list.length > 100 ? h('li', { class: 'muted' }, `… and ${list.length - 100} more`) : '',
              ),
            );
            details.addEventListener('toggle', () => (details.open ? this.open.add(id) : this.open.delete(id)));
            return details;
          })
        : [h('p', null, 'All checks pass for the markers seen so far.')]),
      h(
        'p',
        { class: 'muted small' },
        'Checks: OUT/IN pairing and advertised durations, segmentation start/end pairs, event IDs, CRC, CUE-OUT-CONT elapsed times, DATERANGE attributes, markers missing from some playlists, lead time (live), segment alignment and splice_time consistency.',
      ),
    );
  }
}
