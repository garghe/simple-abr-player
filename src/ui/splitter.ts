const KEY = 'sap.statsWidth.v1';
const DEFAULT = 460;
const MIN_STATS = 320;
const MIN_PLAYER = 360;

/**
 * Drag handle between the player and the stats panel. Dragging left widens
 * the stats panel and shrinks the player; the width is remembered.
 * Arrow keys resize by 20px, Home/double-click reset.
 */
export function installSplitter(layout: HTMLElement, handle: HTMLElement): void {
  const max = () => Math.max(MIN_STATS, layout.clientWidth - MIN_PLAYER - 60);
  const clamp = (w: number) => Math.round(Math.min(max(), Math.max(MIN_STATS, w)));

  const apply = (w: number, save = true) => {
    const width = clamp(w);
    layout.style.setProperty('--stats-width', `${width}px`);
    handle.setAttribute('aria-valuenow', String(width));
    if (save) {
      try {
        localStorage.setItem(KEY, String(width));
      } catch {
        /* storage unavailable */
      }
    }
    // Let the stats chart redraw at the new size.
    window.dispatchEvent(new Event('resize'));
  };
  const current = () => parseFloat(getComputedStyle(layout).getPropertyValue('--stats-width')) || DEFAULT;

  let saved = DEFAULT;
  try {
    saved = Number(localStorage.getItem(KEY)) || DEFAULT;
  } catch {
    /* storage unavailable */
  }
  handle.setAttribute('aria-valuemin', String(MIN_STATS));
  apply(saved, false);

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    document.body.classList.add('resizing');
    const right = layout.getBoundingClientRect().right - parseFloat(getComputedStyle(layout).paddingRight);
    const move = (ev: PointerEvent) => apply(right - ev.clientX - 10);
    const up = () => {
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });

  handle.addEventListener('dblclick', () => apply(DEFAULT));
  handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 80 : 20;
    if (e.key === 'ArrowLeft') apply(current() + step);
    else if (e.key === 'ArrowRight') apply(current() - step);
    else if (e.key === 'Home') apply(DEFAULT);
    else return;
    e.preventDefault();
  });
  // Keep the saved width valid when the window shrinks.
  window.addEventListener('resize', () => {
    const w = current();
    if (w !== clamp(w)) layout.style.setProperty('--stats-width', `${clamp(w)}px`);
  });
}
