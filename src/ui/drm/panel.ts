import {
  DEFAULT_DRM,
  deleteProfile,
  loadProfiles,
  loadRememberedDrm,
  normaliseDrm,
  rememberDrm,
  saveProfile,
  type DrmMode,
  type DrmSettings,
  type LicenseFormat,
} from '../../drm/settings';
import { toBase64 } from '../../drm/transform';
import { clear, h } from '../dom';

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const MODES: [DrmMode, string][] = [
  ['off', 'Off'],
  ['auto', 'Auto'],
  ['widevine', 'Widevine'],
  ['fairplay', 'FairPlay'],
];

const select = (options: [string, string][], label: string) =>
  h('select', { 'aria-label': label }, options.map(([v, t]) => h('option', { value: v }, t)));

const labelled = (text: string, control: HTMLElement, hint?: string) =>
  h('label', { class: 'drm-field' }, h('span', null, text, hint ? h('small', null, ` ${hint}`) : ''), control);

/**
 * DRM settings: mode, Widevine and FairPlay license servers, generic
 * request/response formats, license headers, proxy, and saved profiles.
 * Values only leave the browser in license/certificate requests.
 */
export class DrmPanel {
  settings: DrmSettings;
  private remember = h('input', { type: 'checkbox' });
  private profileSel = h('select', { 'aria-label': 'Saved DRM profile' });
  private modeButtons = new Map<DrmMode, HTMLButtonElement>();
  private wvBox!: HTMLFieldSetElement;
  private fpBox!: HTMLFieldSetElement;
  private proxyBox = h('input', { type: 'checkbox' });
  private proxyNote = h('small', { class: 'muted' });
  private certName = h('span', { class: 'muted small' });
  private fields: { path: string; el: Field }[] = [];
  private listeners = new Set<() => void>();

  constructor(
    private readonly el: HTMLElement,
    private readonly hooks: { getUrl(): string; setUrl(url: string): void; toast(msg: string): void },
  ) {
    const remembered = loadRememberedDrm();
    this.settings = remembered ?? normaliseDrm(DEFAULT_DRM);
    this.remember.checked = Boolean(remembered);
    this.build();
    this.render();
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  set proxyAvailable(v: boolean) {
    this.proxyBox.disabled = !v;
    this.proxyNote.textContent = v ? '' : ' (needs the dev/preview server or the Cloudflare Worker proxy)';
  }

  toggle(open?: boolean): void {
    this.el.hidden = open === undefined ? !this.el.hidden : !open;
  }

  /** Replaces all settings (profile, preset). */
  setSettings(s: DrmSettings): void {
    this.settings = normaliseDrm(s);
    this.render();
    this.changed();
  }

  private changed() {
    rememberDrm(this.remember.checked ? this.settings : null);
    for (const fn of this.listeners) fn();
  }

  // ------------------------------------------------------------------ DOM

  private bind<T extends Field>(path: string, el: T): T {
    this.fields.push({ path, el });
    const handler = () => {
      const [group, key] = path.split('.') as [keyof DrmSettings, string?];
      const value = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value;
      if (key) (this.settings[group] as unknown as Record<string, unknown>)[key] = value;
      else (this.settings as unknown as Record<string, unknown>)[group] = value;
      this.render();
      this.changed();
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
    return el;
  }

  private formatControls(prefix: 'widevine' | 'fairplay', requests: [string, string][], responses: [string, string][]) {
    const reqSel = this.bind(`${prefix}.requestFormat`, select(requests, 'Request format'));
    const template = this.bind(
      `${prefix}.template`,
      h('textarea', { rows: 2, spellcheck: false, 'aria-label': 'Request template' }),
    );
    const resSel = this.bind(`${prefix}.responseFormat`, select(responses, 'Response format'));
    const field = this.bind(`${prefix}.responseField`, h('input', { type: 'text', 'aria-label': 'JSON field', placeholder: 'license' }));
    return h(
      'details',
      { class: 'drm-advanced' },
      h('summary', null, 'Advanced: request & response format'),
      labelled('Request body', reqSel),
      h('div', { class: 'drm-template', dataset: { for: `${prefix}.template` } }, labelled('Template', template, 'placeholders: {{challenge}} or {{spc}}, {{contentId}}, {{keyId}}')),
      labelled('Response', resSel),
      h('div', { class: 'drm-jsonfield', dataset: { for: `${prefix}.responseField` } }, labelled('JSON field', field, 'dotted path, e.g. data.license')),
    );
  }

  private build() {
    const modeSeg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'DRM' });
    for (const [mode, label] of MODES) {
      const b = h('button', { type: 'button', onclick: () => this.setMode(mode) }, label);
      this.modeButtons.set(mode, b);
      modeSeg.append(b);
    }

    this.profileSel.addEventListener('change', () => this.applyProfile(this.profileSel.value));
    const profiles = h(
      'div',
      { class: 'drm-profiles' },
      labelled('Profile', this.profileSel),
      h('button', { type: 'button', onclick: () => this.saveAs() }, 'Save as…'),
      h('button', { type: 'button', onclick: () => this.deleteSelected() }, 'Delete'),
    );

    this.wvBox = h(
      'fieldset',
      { class: 'drm-box' },
      h('legend', null, 'Widevine', h('small', null, ' Chrome · Edge · Firefox · Android')),
      labelled('License URL', this.bind('widevine.licenseUrl', h('input', { type: 'url', placeholder: 'https://license.example.com/widevine', spellcheck: false }))),
      labelled(
        'Security level',
        this.bind(
          'widevine.level',
          select(
            [
              ['auto', 'Auto (best available)'],
              ['hw', 'L1 only (hardware)'],
              ['sw', 'L3 only (software)'],
            ],
            'Widevine security level',
          ),
        ),
      ),
      this.formatControls(
        'widevine',
        [
          ['raw', 'Raw (standard)'],
          ['base64', 'Base64 text'],
          ['json', 'JSON template'],
        ],
        [
          ['auto', 'Auto-detect'],
          ['raw', 'Raw'],
          ['base64', 'Base64 text'],
          ['json', 'JSON field'],
        ],
      ),
    );

    const certFile = h('input', { type: 'file', accept: '.der,.cer,.crt,.bin,.txt,application/octet-stream', 'aria-label': 'Upload FairPlay certificate' });
    certFile.addEventListener('change', async () => {
      const f = certFile.files?.[0];
      if (!f) return;
      const bytes = new Uint8Array(await f.arrayBuffer());
      const text = new TextDecoder().decode(bytes).trim();
      // Accept binary or base64 certificate files.
      this.settings.fairplay.certificateData = /^[A-Za-z0-9+/=\s]+$/.test(text) && text.length > 100 ? text.replace(/\s+/g, '') : toBase64(bytes);
      this.settings.fairplay.certificateName = f.name;
      certFile.value = '';
      this.render();
      this.changed();
    });
    const removeCert = h(
      'button',
      {
        type: 'button',
        class: 'linklike',
        onclick: () => {
          this.settings.fairplay.certificateData = '';
          this.settings.fairplay.certificateName = '';
          this.render();
          this.changed();
        },
      },
      'remove',
    );
    const customId = this.bind('fairplay.customContentId', h('input', { type: 'text', placeholder: 'asset ID', 'aria-label': 'Custom content ID' }));

    this.fpBox = h(
      'fieldset',
      { class: 'drm-box' },
      h('legend', null, 'FairPlay', h('small', null, ' Safari (macOS · iOS · iPadOS)')),
      labelled('License URL', this.bind('fairplay.licenseUrl', h('input', { type: 'url', placeholder: 'https://license.example.com/fairplay', spellcheck: false }))),
      labelled('Certificate URL', this.bind('fairplay.certificateUrl', h('input', { type: 'url', placeholder: 'https://license.example.com/fairplay.cer', spellcheck: false }))),
      h('div', { class: 'drm-cert' }, h('span', null, 'or upload: '), certFile, this.certName, removeCert),
      labelled(
        'Content ID',
        this.bind(
          'fairplay.contentId',
          select(
            [
              ['skd-host', 'From skd:// URI (host part)'],
              ['skd-uri', 'Whole skd:// URI'],
              ['key-id', 'Key ID'],
              ['custom', 'Custom value'],
            ],
            'FairPlay content ID',
          ),
        ),
      ),
      h('div', { class: 'drm-custom-id', dataset: { for: 'fairplay.customContentId' } }, customId),
      labelled(
        'Safari playback',
        this.bind(
          'fairplay.playback',
          select(
            [
              ['auto', 'Auto: player first, native fallback'],
              ['mse', 'Player only (full stats)'],
              ['native', "Safari's native HLS (fewer stats)"],
            ],
            'Safari playback',
          ),
        ),
      ),
      this.formatControls(
        'fairplay',
        [
          ['raw', 'Raw SPC (standard)'],
          ['base64', 'Base64 SPC'],
          ['form', 'Form (spc=…)'],
          ['json', 'JSON template'],
        ],
        [
          ['auto', 'Auto-detect'],
          ['raw', 'Raw CKC'],
          ['base64', 'Base64 CKC'],
          ['ckc-tags', '<ckc>…</ckc>'],
          ['json', 'JSON field'],
        ],
      ),
    );

    const headers = this.bind(
      'headers',
      h('textarea', { rows: 3, spellcheck: false, placeholder: 'Authorization: Bearer …\nx-dt-custom-data: …' }),
    );
    this.bind('useProxy', this.proxyBox);
    this.remember.addEventListener('change', () => this.changed());

    clear(
      this.el,
      h('div', { class: 'drm-top' }, h('div', { class: 'drm-mode' }, h('strong', null, 'DRM'), modeSeg), profiles),
      h('div', { class: 'drm-grid' }, this.wvBox, this.fpBox),
      h(
        'div',
        { class: 'drm-bottom' },
        labelled('License request headers', headers, 'one per line, Name: value (also sent with the certificate request)'),
        h(
          'div',
          { class: 'drm-checks' },
          h('label', null, this.proxyBox, ' Send license requests through the CORS proxy', this.proxyNote),
          h('label', null, this.remember, ' Remember these settings on this browser'),
          h('small', { class: 'muted' }, 'DRM settings and tokens never go into "Copy link" URLs or "Export JSON". Profiles are stored in this browser only.'),
        ),
      ),
    );
  }

  private setMode(mode: DrmMode) {
    this.settings.mode = mode;
    this.render();
    this.changed();
  }

  render(): void {
    const s = this.settings;
    for (const [mode, b] of this.modeButtons) b.setAttribute('aria-pressed', String(mode === s.mode));
    for (const { path, el } of this.fields) {
      const [group, key] = path.split('.') as [keyof DrmSettings, string?];
      const value = key ? (s[group] as unknown as Record<string, unknown>)[key] : s[group];
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(value);
      else if (document.activeElement !== el) el.value = String(value ?? '');
    }
    this.wvBox.disabled = s.mode === 'off' || s.mode === 'fairplay';
    this.fpBox.disabled = s.mode === 'off' || s.mode === 'widevine';
    const show = (selector: string, visible: boolean) => this.el.querySelectorAll<HTMLElement>(selector).forEach((e) => (e.hidden = !visible));
    for (const ks of ['widevine', 'fairplay'] as const) {
      const f: LicenseFormat = s[ks];
      show(`[data-for="${ks}.template"]`, f.requestFormat === 'json' || f.requestFormat === 'form');
      show(`[data-for="${ks}.responseField"]`, f.responseFormat === 'json');
    }
    show('[data-for="fairplay.customContentId"]', s.fairplay.contentId === 'custom');
    this.certName.textContent = s.fairplay.certificateData ? ` ${s.fairplay.certificateName || 'certificate'} loaded (overrides the URL)` : '';
    (this.certName.nextElementSibling as HTMLElement).hidden = !s.fairplay.certificateData;
    this.renderProfiles();
  }

  // ------------------------------------------------------------- profiles

  private renderProfiles(selected = this.profileSel.value) {
    const list = loadProfiles();
    clear(
      this.profileSel,
      h('option', { value: '' }, list.length ? '— choose a saved profile —' : 'No saved profiles yet'),
      list.map((p) => h('option', { value: p.name, selected: p.name === selected }, p.name)),
    );
  }

  private applyProfile(name: string) {
    const p = loadProfiles().find((x) => x.name === name);
    if (!p) return;
    this.setSettings(p.drm);
    if (p.url) this.hooks.setUrl(p.url);
    this.hooks.toast(`Profile "${p.name}" loaded${p.url ? ' (with its stream URL)' : ''}`);
  }

  private saveAs() {
    const current = this.profileSel.value;
    const name = prompt('Save the current DRM settings (and the stream URL) as profile:', current || 'My DRM profile')?.trim();
    if (!name) return;
    saveProfile({ name, url: this.hooks.getUrl(), drm: normaliseDrm(structuredClone(this.settings)), savedAt: new Date().toISOString() });
    this.renderProfiles(name);
    this.hooks.toast(`Profile "${name}" saved in this browser`);
  }

  private deleteSelected() {
    const name = this.profileSel.value;
    if (!name || !confirm(`Delete profile "${name}"?`)) return;
    deleteProfile(name);
    this.renderProfiles('');
  }
}
