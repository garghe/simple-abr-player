import { icons } from './icons';

export type ThemeMode = 'system' | 'light' | 'dark';

const KEY = 'sap.theme.v1';
const ORDER: ThemeMode[] = ['system', 'light', 'dark'];
const LABEL: Record<ThemeMode, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const ICON: Record<ThemeMode, string> = { system: icons.auto, light: icons.sun, dark: icons.moon };

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Header button cycling System → Light → Dark. "System" follows the OS
 * (prefers-color-scheme); the choice is remembered. index.html applies the
 * saved value before first paint.
 */
export function installThemeToggle(button: HTMLButtonElement, onChange: () => void): void {
  let mode = readMode();

  const apply = () => {
    if (mode === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = mode;
    button.innerHTML = `${ICON[mode]}<span>${LABEL[mode]}</span>`;
    const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    button.title = `Theme: ${LABEL[mode]} (click for ${LABEL[next]})`;
    button.setAttribute('aria-label', button.title);
    onChange();
  };

  button.addEventListener('click', () => {
    mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    try {
      if (mode === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, mode);
    } catch {
      /* storage unavailable */
    }
    apply();
  });
  window.matchMedia?.('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (mode === 'system') onChange();
  });
  apply();
}
