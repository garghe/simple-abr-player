import { tipFor } from './glossary';

/** Elements whose label text is looked up in the glossary, with an optional context. */
const TARGETS: [selector: string, context?: string][] = [
  ['[data-tip]'],
  ['.subnav button', 'scte'],
  ['.fact', 'fact'],
  ['button.tab'],
  ['.view-toggle button'],
  ['table.kv th'],
  ['table th'],
  ['h3'],
  ['h4'],
  ['.kv-grid small'],
  ['.loud-tile small'],
  ['.score-parts .linklike'],
  ['.drm-facts .muted'],
  ['.bfield > span'],
  ['.drm-field > span'],
  ['td > label'],
];
export const SELECTOR_LIST = TARGETS.map(([s]) => s).join(',');
const SELECTOR = SELECTOR_LIST;
/** Labels shown with a dotted underline when they have an explanation. */
const UNDERLINED = 'table.kv th, .kv-grid small, .loud-tile small, .drm-facts .muted, .fact';

/** The label of an element: its own text, without counts, badges or hints in child elements. */
export function labelOf(el: Element): string {
  if (el.matches('button.tab')) return el.querySelector('.tab-label')?.textContent ?? '';
  if (el.matches('.fact')) return el.querySelector('small')?.textContent ?? '';
  let own = '';
  for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) own += n.textContent;
  return (own.trim() || el.textContent || '').trim();
}

/** Tooltip text for an element, or undefined if it has none. */
export function tipOf(el: Element): string | undefined {
  const own = el.getAttribute('data-tip');
  if (own) return own;
  const context = TARGETS.find(([s]) => el.matches(s))?.[1];
  return tipFor(labelOf(el), context);
}

/**
 * One floating tooltip for the whole page. Labels known to the glossary (and
 * anything with data-tip) explain themselves on hover, keyboard focus, or a tap
 * on touch screens. Elements with a native title keep the browser's tooltip.
 */
export function installTooltips(root: HTMLElement = document.body): void {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.id = 'tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);

  let target: Element | null = null;
  let timer = 0;
  let pointer: { x: number; y: number } | null = null;

  const find = (node: EventTarget | null): [Element, string] | null => {
    let el = node instanceof Element ? node.closest(SELECTOR) : null;
    while (el && root.contains(el)) {
      if (!el.closest('[title]') || el.hasAttribute('data-tip')) {
        const text = tipOf(el);
        if (text) return [el, text];
      }
      el = el.parentElement?.closest(SELECTOR) ?? null;
    }
    return null;
  };

  const hide = () => {
    window.clearTimeout(timer);
    if (target) target.removeAttribute('aria-describedby');
    target = null;
    tip.hidden = true;
  };

  const show = (el: Element, text: string) => {
    target = el;
    tip.textContent = text;
    tip.hidden = false;
    el.setAttribute('aria-describedby', tip.id);
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const gap = 8;
    let top = r.top - t.height - gap;
    let below = false;
    if (top < 4) {
      top = r.bottom + gap;
      below = true;
    }
    const left = Math.min(Math.max(4, r.left + r.width / 2 - t.width / 2), window.innerWidth - t.width - 4);
    tip.style.top = `${Math.round(top)}px`;
    tip.style.left = `${Math.round(left)}px`;
    tip.classList.toggle('below', below);
  };

  /**
   * Cards and tabs redraw every second, replacing the element under the mouse.
   * When the tooltip's element is replaced by one with the same explanation,
   * move the tooltip over to it instead of hiding and showing it again.
   */
  const adopt = (hit: [Element, string] | null): boolean => {
    if (!hit || tip.hidden || !target || target.isConnected || hit[1] !== tip.textContent) return false;
    target = hit[0];
    target.setAttribute('aria-describedby', tip.id);
    return true;
  };

  const schedule = (node: EventTarget | null, delay: number) => {
    const hit = find(node);
    if (!hit) return hide();
    if (hit[0] === target || adopt(hit)) return;
    hide();
    timer = window.setTimeout(() => {
      if (hit[0].isConnected) return show(hit[0], hit[1]);
      // Redrawn while waiting: use what is under the pointer now.
      const again = pointer ? find(document.elementFromPoint(pointer.x, pointer.y)) : null;
      if (again) show(again[0], again[1]);
    }, delay);
  };

  root.addEventListener('mouseover', (e) => schedule(e.target, 350));
  root.addEventListener('mousemove', (e) => (pointer = { x: e.clientX, y: e.clientY }), { passive: true });
  root.addEventListener('mouseleave', () => {
    pointer = null;
    hide();
  });
  root.addEventListener('focusin', (e) => {
    // Only keyboard focus: a mouse click on a button shouldn't pop a tooltip.
    if ((e.target as Element).matches(':focus-visible')) schedule(e.target, 0);
  });
  root.addEventListener('focusout', hide);
  // Touch: tapping a plain label shows its explanation (buttons keep working as usual).
  root.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch') return;
    const hit = find(e.target);
    if (hit && !hit[0].closest('button, a, input, select, textarea, label')) show(hit[0], hit[1]);
    else hide();
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && hide());
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  // Tabs re-render often; drop the tooltip when its element goes away.
  // Labels that have an explanation get a dotted underline (data-has-tip), so
  // the hint never promises a tooltip that isn't there. Checked once per frame at most.
  let marking = 0;
  const mark = () => {
    marking = 0;
    for (const el of root.querySelectorAll(UNDERLINED)) {
      if (el.hasAttribute('data-has-tip')) continue;
      if (tipOf(el)) el.setAttribute('data-has-tip', '');
    }
  };
  const scheduleMark = () => (marking ||= requestAnimationFrame(mark));
  scheduleMark();

  new MutationObserver(() => {
    scheduleMark();
    if (!target || target.isConnected) return;
    const under = pointer ? document.elementFromPoint(pointer.x, pointer.y) : null;
    if (!adopt(find(under))) hide();
  }).observe(root, { childList: true, subtree: true });
}
