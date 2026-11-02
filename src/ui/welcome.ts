import { h } from './dom';

export const WELCOME_KEY = 'sap.welcome.v1';

/** Whether the guide opens by itself: until someone ticks "Don't show this" and closes it. */
export function shouldShowWelcome(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(WELCOME_KEY) !== 'hide';
  } catch {
    return true;
  }
}

function remember(hide: boolean) {
  try {
    if (hide) localStorage.setItem(WELCOME_KEY, 'hide');
    else localStorage.removeItem(WELCOME_KEY);
  } catch {
    /* private mode: the guide just shows again next time */
  }
}

const cap = (icon: string, color: string, title: string, text: string) =>
  h('div', { class: 'wl-cap' }, h('b', null, h('i', { style: `background:${color}`, 'aria-hidden': 'true' }, icon), title), h('p', null, text));
const chip = (t: string) => h('span', { class: 'wl-chip' }, t);
const kbd = (t: string) => h('kbd', null, t);
const key = (keys: (HTMLElement | string)[], what: string) => h('span', { class: 'wl-key' }, ...keys, ` ${what}`);

/** The welcome guide: what PlayProbe is, what it checks and how to use it. */
export class WelcomeGuide {
  readonly el: HTMLDialogElement;
  private dontShow: HTMLInputElement;

  constructor(opts: { version: string; logo: string; onDemo: () => void }) {
    this.dontShow = h('input', { type: 'checkbox', checked: true });
    const close = () => this.close();
    this.el = h(
      'dialog',
      { class: 'welcome', 'aria-labelledby': 'welcome-title' },
      h(
        'div',
        { class: 'wl-hero' },
        h('button', { type: 'button', class: 'wl-close', 'aria-label': 'Close the guide', onclick: close }, '✕'),
        h(
          'div',
          { class: 'wl-brand' },
          h('img', { src: opts.logo, alt: '', width: 40, height: 40 }),
          h('h2', { id: 'welcome-title' }, 'Welcome to PlayProbe'),
          h('span', { class: 'wl-version' }, `v${opts.version}`),
        ),
        h(
          'p',
          { class: 'wl-lead' },
          'PlayProbe plays MPEG-DASH and HLS streams in your browser and checks them while they play, so you see what viewers get and what’s wrong with the stream, the ads, the audio or the DRM.',
        ),
      ),
      h(
        'div',
        { class: 'wl-body' },
        h(
          'div',
          null,
          h('h3', { class: 'wl-h' }, 'What it checks'),
          h(
            'div',
            { class: 'wl-caps' },
            cap('✓', '#10b981', 'Stream health', 'Playlists and segments, keyframes, codecs, bitrates, alignment between qualities.'),
            cap('▮', '#f59e0b', 'SCTE-35 & ads', 'Ad markers decoded, breaks, inserted ads, signalling errors.'),
            cap('♪', '#06b6d4', 'Picture & sound', 'Loudness (EBU R128 / ATSC A/85), channels, black, frozen and silent alarms.'),
            cap('🔒', '#6366f1', 'DRM', 'Widevine, PlayReady and FairPlay licences and key status.'),
            cap('⇅', '#64748b', 'Network & manifests', 'Every request, and the raw MPD and playlists.'),
            cap('▭', '#94a3b8', 'Device', 'What this browser can decode and protect.'),
          ),
          h(
            'p',
            { class: 'wl-privacy' },
            '🔐 Everything runs in your browser: streams are fetched directly (or through the optional CORS proxy) and never stored, and DRM settings and tokens stay on this device.',
          ),
        ),
        h(
          'div',
          null,
          h('h3', { class: 'wl-h' }, 'How to use it'),
          h(
            'ol',
            { class: 'wl-steps' },
            h('li', null, h('span', null, 'Paste a ', chip('.mpd'), ' or ', chip('.m3u8'), ' URL, or pick one from ', h('b', null, 'Test streams'), ', and press ', h('b', null, 'Probe stream'), '.')),
            h('li', null, h('span', null, 'Pick a view: ', h('b', null, 'Inspect'), ' for a summary of the stream, ', h('b', null, 'Monitor'), ' to watch a live channel. Live streams open in Monitor by default.')),
            h('li', null, h('span', null, 'Click a card or a tab for the detail. Hover over a value or label to see what it means.')),
            h('li', null, h('span', null, 'Protected stream? Set it up with ', h('b', null, 'DRM'), '. Blocked by CORS? Use the ', h('b', null, 'Proxy'), ' setting.')),
            h('li', null, h('span', null, h('b', null, 'Copy link'), ' reopens the same stream and view; ', h('b', null, 'Export'), ' saves everything as JSON.')),
          ),
          h('h3', { class: 'wl-h' }, 'Handy keys'),
          h(
            'p',
            { class: 'wl-keys' },
            key([kbd('Space')], 'play/pause'),
            key([kbd('n'), '/', kbd('p')], 'next/previous marker'),
            key([kbd('s')], 'skip break'),
            key([kbd('i')], 'stats overlay'),
            key([kbd('?')], 'this guide'),
          ),
        ),
      ),
      h(
        'div',
        { class: 'wl-foot' },
        h('label', null, this.dontShow, ' Don’t show this when PlayProbe opens'),
        h('span', { class: 'wl-sp' }),
        h('button', { type: 'button', class: 'wl-demo', onclick: () => (this.close(), opts.onDemo()) }, 'Try the demo stream'),
        h('button', { type: 'button', class: 'primary wl-start', onclick: close }, 'Get started'),
      ),
    );
    // Click on the backdrop (outside the box) closes it.
    this.el.addEventListener('click', (e) => e.target === this.el && this.close());
    // Esc closes the native dialog; remember the checkbox then too.
    this.el.addEventListener('close', () => remember(this.dontShow.checked));
    // Keys typed in the guide don't reach the player shortcuts behind it.
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.append(this.el);
  }

  get open(): boolean {
    return this.el.open;
  }

  show(): void {
    if (this.el.open) return;
    this.el.showModal();
    (this.el.querySelector('.wl-start') as HTMLElement).focus({ preventScroll: true });
    this.el.scrollTop = 0;
  }

  close(): void {
    if (this.el.open) this.el.close();
  }
}
