import type { LoudnessStandard } from './loudness';

const STD_KEY = 'sap.loudness.v1';
const OVERLAY_KEY = 'sap.meters.v1';
const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

let standard: LoudnessStandard = read(STD_KEY) === 'atsc' ? 'atsc' : 'ebu';
let overlay = read(OVERLAY_KEY) !== 'off'; // on by default

export const audioPrefs = {
  get standard(): LoudnessStandard {
    return standard;
  },
  set standard(v: LoudnessStandard) {
    standard = v;
    write(STD_KEY, v);
    listeners.forEach((fn) => fn());
  },
  get overlay(): boolean {
    return overlay;
  },
  set overlay(v: boolean) {
    overlay = v;
    write(OVERLAY_KEY, v ? 'on' : 'off');
    listeners.forEach((fn) => fn());
  },
  onChange(fn: () => void) {
    listeners.add(fn);
  },
};
