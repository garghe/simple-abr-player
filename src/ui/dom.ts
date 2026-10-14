type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string; style?: string; dataset?: Record<string, string> };

/** Tiny hyperscript helper: h('div', {class: 'x', onclick}, 'text', child). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2), value as EventListener);
      } else if (key in el && key !== 'list' && key !== 'style') {
        (el as unknown as Record<string, unknown>)[key] = value;
      } else {
        el.setAttribute(key, value === true ? '' : String(value));
      }
    }
  }
  append(el, children);
  return el;
}

function append(el: Element, children: (Child | Child[])[]) {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

export function clear(el: Element, ...children: (Child | Child[])[]): void {
  el.replaceChildren();
  append(el, children);
}

export function $(selector: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Missing element ${selector}`);
  return el;
}

/** Simple key/value table used across the stats tabs. */
export function kvTable(rows: [string, Child | Child[]][]): HTMLTableElement {
  return h(
    'table',
    { class: 'kv' },
    h('tbody', null, rows.map(([k, v]) => h('tr', null, h('th', null, k), h('td', null, ...(Array.isArray(v) ? v : [v]))))),
  );
}

export function dataTable(headers: string[], rows: (Child | Child[])[][], cls = ''): HTMLTableElement {
  return h(
    'table',
    { class: `grid ${cls}` },
    h('thead', null, h('tr', null, headers.map((x) => h('th', null, x)))),
    h(
      'tbody',
      null,
      rows.length
        ? rows.map((r) => h('tr', null, r.map((c) => h('td', null, ...(Array.isArray(c) ? c : [c])))))
        : h('tr', null, h('td', { colSpan: headers.length, class: 'empty' }, 'Nothing yet')),
    ),
  );
}

export function badge(text: string, kind = ''): HTMLSpanElement {
  return h('span', { class: `badge ${kind}` }, text);
}
