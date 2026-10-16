import { toDb, type SubBlock } from './dsp';

/**
 * Turns 100 ms sub-blocks into broadcast loudness figures (ITU-R BS.1770-4,
 * EBU R128 / Tech 3341 / 3342, ATSC A/85):
 *
 *  - momentary   400 ms sliding window
 *  - short-term  3 s sliding window
 *  - integrated  gated (−70 LUFS absolute, −10 LU relative) over 400 ms
 *                blocks with 75 % overlap, i.e. one block per 100 ms
 *  - LRA         10th–95th percentile of gated short-term values
 *                (−70 absolute, −20 LU relative)
 *
 * Integrated loudness and LRA use 0.1 LU histograms so memory stays
 * constant however long the stream plays.
 */

export type LoudnessStandard = 'ebu' | 'atsc';

export const STANDARDS: Record<
  LoudnessStandard,
  { name: string; unit: string; target: number; tolerance: number; maxTruePeak: number }
> = {
  ebu: { name: 'EBU R128', unit: 'LUFS', target: -23, tolerance: 1, maxTruePeak: -1 },
  atsc: { name: 'ATSC A/85', unit: 'LKFS', target: -24, tolerance: 2, maxTruePeak: -2 },
};

/** Web Audio's discrete channel order for common layouts. */
export function channelLabels(count: number): string[] {
  switch (count) {
    case 1:
      return ['M'];
    case 2:
      return ['L', 'R'];
    case 4:
      return ['L', 'R', 'Ls', 'Rs'];
    case 6:
      return ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'];
    case 8:
      return ['L', 'R', 'C', 'LFE', 'Ls', 'Rs', 'Lb', 'Rb'];
    default:
      return Array.from({ length: count }, (_, i) => `Ch${i + 1}`);
  }
}

/** BS.1770 channel weights: surrounds +1.5 dB (×1.41), LFE excluded. */
export function channelWeights(count: number): number[] {
  return channelLabels(count).map((l) => (l === 'LFE' ? 0 : /^(Ls|Rs|Lb|Rb)$/.test(l) ? 1.41 : 1));
}

const LOUDNESS_OFFSET = -0.691;
const loudnessOf = (energy: number) => (energy > 0 ? LOUDNESS_OFFSET + 10 * Math.log10(energy) : -Infinity);
const energyOf = (loudness: number) => Math.pow(10, (loudness - LOUDNESS_OFFSET) / 10);

const HIST_MIN = -70;
const HIST_MAX = 10;
const HIST_STEP = 0.1;
const HIST_BINS = Math.round((HIST_MAX - HIST_MIN) / HIST_STEP);

class Histogram {
  readonly counts = new Float64Array(HIST_BINS);
  total = 0;
  add(loudness: number) {
    if (!(loudness >= HIST_MIN)) return; // absolute gate (also drops -Infinity/NaN)
    const i = Math.min(HIST_BINS - 1, Math.floor((loudness - HIST_MIN) / HIST_STEP));
    this.counts[i]++;
    this.total++;
  }
  static centre(i: number) {
    return HIST_MIN + (i + 0.5) * HIST_STEP;
  }
  clear() {
    this.counts.fill(0);
    this.total = 0;
  }
}

export interface ChannelLevel {
  label: string;
  /** Sample peak in this 100 ms (dBFS). */
  peak: number;
  /** Peak hold (dBFS), held 2 s then released. */
  hold: number;
  /** RMS in this 100 ms (dBFS). */
  rms: number;
}

export interface LoudnessReading {
  channels: ChannelLevel[];
  momentary: number;
  shortTerm: number;
  integrated: number;
  lra: number;
  /** Max true peak since reset (dBTP). */
  truePeakMax: number;
  /** Max sample peak since reset (dBFS). */
  samplePeakMax: number;
  /** L/R correlation over the last 400 ms (−1…+1), null if not stereo+. */
  correlation: number | null;
  /** Seconds of audio measured since reset. */
  duration: number;
}

const HOLD_BLOCKS = 20; // 2 s

export class LoudnessMeter {
  private recent: SubBlock[] = [];
  private integratedHist = new Histogram();
  private lraHist = new Histogram();
  private truePeakMax = 0;
  private samplePeakMax = 0;
  private hold: { value: number; age: number }[] = [];
  private blocks = 0;
  private channels = 0;
  private last: LoudnessReading | null = null;

  reset(): void {
    this.recent = [];
    this.integratedHist.clear();
    this.lraHist.clear();
    this.truePeakMax = 0;
    this.samplePeakMax = 0;
    this.hold = [];
    this.blocks = 0;
    this.last = null;
  }

  get reading(): LoudnessReading | null {
    return this.last;
  }

  /** Weighted energy of the last `n` sub-blocks (or null if not enough yet). */
  private windowEnergy(n: number): number | null {
    if (this.recent.length < n) return null;
    const slice = this.recent.slice(-n);
    const w = channelWeights(this.channels);
    let e = 0;
    for (let c = 0; c < this.channels; c++) {
      let sum = 0;
      for (const b of slice) sum += b.kMeanSquare[c] ?? 0;
      e += w[c] * (sum / n);
    }
    return e;
  }

  push(block: SubBlock): LoudnessReading {
    if (block.channels !== this.channels) {
      // Layout changed (track switch): restart the sliding windows only.
      this.channels = block.channels;
      this.recent = [];
      this.hold = [];
    }
    this.recent.push(block);
    if (this.recent.length > 30) this.recent.shift();
    this.blocks++;

    const mE = this.windowEnergy(4);
    const sE = this.windowEnergy(30);
    const momentary = mE === null ? -Infinity : loudnessOf(mE);
    const shortTerm = sE === null ? -Infinity : loudnessOf(sE);
    if (mE !== null) this.integratedHist.add(momentary);
    if (sE !== null) this.lraHist.add(shortTerm);

    for (let c = 0; c < block.channels; c++) {
      this.truePeakMax = Math.max(this.truePeakMax, block.truePeak[c], block.samplePeak[c]);
      this.samplePeakMax = Math.max(this.samplePeakMax, block.samplePeak[c]);
    }

    const labels = channelLabels(block.channels);
    const channels = labels.map((label, c) => {
      const peak = toDb(block.samplePeak[c]);
      const h = this.hold[c];
      if (!h || peak >= h.value || h.age >= HOLD_BLOCKS) this.hold[c] = { value: peak, age: 0 };
      else h.age++;
      return { label, peak, hold: this.hold[c].value, rms: toDb(block.rms[c]) };
    });

    let correlation: number | null = null;
    if (block.channels >= 2) {
      let lr = 0;
      let ll = 0;
      let rr = 0;
      for (const b of this.recent.slice(-4)) {
        lr += b.corr.lr;
        ll += b.corr.ll;
        rr += b.corr.rr;
      }
      correlation = ll > 0 && rr > 0 ? lr / Math.sqrt(ll * rr) : null;
    }

    this.last = {
      channels,
      momentary,
      shortTerm,
      integrated: gatedLoudness(this.integratedHist, -10),
      lra: loudnessRange(this.lraHist),
      truePeakMax: toDb(this.truePeakMax),
      samplePeakMax: toDb(this.samplePeakMax),
      correlation,
      duration: this.blocks / 10,
    };
    return this.last;
  }
}

/** Mean loudness of blocks above the absolute gate and `relative` LU below their mean. */
function gatedLoudness(h: Histogram, relative: number): number {
  if (h.total === 0) return -Infinity;
  let e = 0;
  for (let i = 0; i < HIST_BINS; i++) if (h.counts[i]) e += h.counts[i] * energyOf(Histogram.centre(i));
  const threshold = loudnessOf(e / h.total) + relative;
  let e2 = 0;
  let n = 0;
  for (let i = 0; i < HIST_BINS; i++) {
    if (h.counts[i] && Histogram.centre(i) >= threshold) {
      e2 += h.counts[i] * energyOf(Histogram.centre(i));
      n += h.counts[i];
    }
  }
  return n ? loudnessOf(e2 / n) : -Infinity;
}

/** EBU Tech 3342 loudness range. */
function loudnessRange(h: Histogram): number {
  if (h.total === 0) return 0;
  let e = 0;
  for (let i = 0; i < HIST_BINS; i++) if (h.counts[i]) e += h.counts[i] * energyOf(Histogram.centre(i));
  const threshold = loudnessOf(e / h.total) - 20;
  const start = Math.max(0, Math.ceil((threshold - HIST_MIN) / HIST_STEP - 0.5));
  let n = 0;
  for (let i = start; i < HIST_BINS; i++) n += h.counts[i];
  if (!n) return 0;
  const percentile = (p: number) => {
    const target = p * n;
    let acc = 0;
    for (let i = start; i < HIST_BINS; i++) {
      acc += h.counts[i];
      if (acc >= target) return Histogram.centre(i);
    }
    return Histogram.centre(HIST_BINS - 1);
  };
  return Math.max(0, percentile(0.95) - percentile(0.1));
}
