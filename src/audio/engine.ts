import type { SubBlock } from './dsp';
import { LoudnessMeter, type LoudnessReading } from './loudness';
import workletUrl from './meter.worklet.ts?worker&url';
import { StreamMeter, type TimedBlock } from './stream-meter';

export type AudioState = 'idle' | 'starting' | 'running' | 'unsupported' | 'error';

export type MeterSource = 'stream' | 'webaudio';

/**
 * Two measurement sources feed one LoudnessMeter:
 *
 *  1. "stream" (preferred): the downloaded audio segments are decoded with
 *     WebCodecs (see stream-meter.ts). Every encoded channel is measured,
 *     whatever the speakers, and readings are released in step with the
 *     playhead. Works for fMP4/CMAF with Opus, AAC, FLAC (and Dolby where
 *     WebCodecs supports it).
 *  2. "webaudio" (fallback, e.g. MPEG-2 TS or WebM): routes the <video>
 *     element's decoded audio through Web Audio:
 *
 *   video ─► MediaElementSource ─┬─► Gain (player volume) ─► speakers
 *                                └─► level-meter worklet (all channels, pre-volume)
 *
 * The graph is built on the first user gesture (browsers only allow audio
 * processing after one). From then on the player volume is applied by the
 * gain node, so the meters show the stream's level, not the listening level.
 * Before that, volume falls back to the element itself.
 */
export class AudioEngine {
  state: AudioState = 'idle';
  error = '';
  /** Channels currently arriving from the decoder. */
  channels = 0;
  sampleRate = 0;
  outputChannels = 0;
  readonly meter = new LoudnessMeter();

  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private vol = 1;
  private mute = false;
  private lastBlockAt = 0;
  private listeners = new Map<string, Set<() => void>>();
  readonly stream = new StreamMeter((b) => this.enqueue(b));
  private queue: TimedBlock[] = [];
  private streamFedAt = 0;
  /** Shaka stream id of the audio being played; other streams' readings are ignored. */
  activeStreamId: number | null = null;
  /** Which source fed the latest reading. */
  source: MeterSource | null = null;

  constructor(private readonly video: HTMLVideoElement) {
    this.vol = video.volume;
    this.mute = video.muted;
    if (!('AudioContext' in window) || !('AudioWorkletNode' in window)) {
      this.state = 'unsupported';
      this.error = 'This browser has no AudioWorklet support.';
    }
    const gesture = () => void this.start();
    for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, gesture, { capture: true });
    video.addEventListener('volumechange', () => this.onElementVolume());
    video.addEventListener('seeking', () => {
      this.queue = this.queue.filter((b) => b.time > video.currentTime - 0.2);
    });
    // Release stream measurements as the playhead reaches them.
    window.setInterval(() => this.drainQueue(), 50);
    // Show silence when audio stops arriving (paused, ended, no audio track).
    window.setInterval(() => {
      if (this.lastBlockAt && performance.now() - this.lastBlockAt > 400) {
        this.lastBlockAt = 0;
        this.emit('levels');
      }
    }, 200);
  }

  on(name: 'levels' | 'state' | 'volume', fn: () => void): void {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(fn);
  }

  private emit(name: string) {
    for (const fn of this.listeners.get(name) ?? []) fn();
  }

  /** Latest reading, or null when no audio is flowing. */
  get reading(): LoudnessReading | null {
    return this.lastBlockAt ? this.meter.reading : null;
  }

  /** Integrated values keep accumulating while paused; this reads them anyway. */
  get lastReading(): LoudnessReading | null {
    return this.meter.reading;
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') {
      if (this.ctx?.state === 'suspended') await this.ctx.resume().catch(() => undefined);
      return;
    }
    this.state = 'starting';
    this.emit('state');
    try {
      const ctx = new AudioContext({ latencyHint: 'playback' });
      this.ctx = ctx;
      await ctx.audioWorklet.addModule(workletUrl);
      const source = ctx.createMediaElementSource(this.video);
      this.gain = ctx.createGain();
      source.connect(this.gain).connect(ctx.destination);
      const node = new AudioWorkletNode(ctx, 'level-meter', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCountMode: 'max',
        channelInterpretation: 'discrete',
      });
      source.connect(node);
      node.port.onmessage = (e: MessageEvent<SubBlock>) => {
        // The stream source wins while it is producing data.
        if (performance.now() - this.streamFedAt < 1000) return;
        this.push(e.data, 'webaudio');
      };
      this.sampleRate = ctx.sampleRate;
      this.outputChannels = ctx.destination.maxChannelCount;
      // Hand volume over from the element to the gain node.
      this.applyVolume();
      this.video.volume = 1;
      this.video.muted = false;
      ctx.onstatechange = () => this.emit('state');
      if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
      this.state = 'running';
    } catch (err) {
      this.state = 'error';
      this.error = err instanceof Error ? err.message : String(err);
    }
    this.emit('state');
  }

  // ------------------------------------------------------------ volume

  get volume(): number {
    return this.vol;
  }
  get muted(): boolean {
    return this.mute;
  }

  setVolume(v: number): void {
    this.vol = Math.min(1, Math.max(0, v));
    if (this.vol > 0) this.mute = false;
    this.applyVolume();
  }

  setMuted(m: boolean): void {
    this.mute = m;
    this.applyVolume();
  }

  private applyVolume() {
    if (this.gain) {
      this.gain.gain.value = this.mute ? 0 : this.vol;
    } else {
      this.video.volume = this.vol;
      this.video.muted = this.mute;
    }
    this.emit('volume');
  }

  /** Element volume changed by something else (e.g. PiP or media keys). */
  private onElementVolume() {
    if (!this.gain) {
      this.vol = this.video.volume;
      this.mute = this.video.muted;
      this.emit('volume');
      return;
    }
    if (this.video.volume !== 1 || this.video.muted) {
      if (this.video.muted) this.mute = true;
      else this.vol = this.video.volume;
      this.video.volume = 1;
      this.video.muted = false;
      this.applyVolume();
    }
  }

  private push(block: SubBlock, source: MeterSource) {
    this.channels = block.channels;
    this.source = source;
    this.lastBlockAt = performance.now();
    this.meter.push(block);
    this.emit('levels');
  }

  private enqueue(b: TimedBlock) {
    // Keep the queue ordered by time (decoders can finish out of order).
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].time > b.time) i--;
    this.queue.splice(i, 0, b);
    if (this.queue.length > 3000) this.queue.splice(0, this.queue.length - 3000);
  }

  private drainQueue() {
    if (!this.queue.length || this.video.paused) return;
    const t = this.video.currentTime;
    while (this.queue.length && this.queue[0].time <= t + 0.05) {
      const b = this.queue.shift()!;
      if (b.time < t - 1) continue; // stale (e.g. after a seek)
      if (this.activeStreamId !== null && b.streamId !== this.activeStreamId) continue; // other track
      this.streamFedAt = performance.now();
      this.push(b.block, 'stream');
    }
  }

  /** New stream loaded: forget everything measured so far. */
  clearStream(): void {
    this.stream.reset();
    this.queue = [];
    this.streamFedAt = 0;
    this.source = null;
    this.reset();
  }

  /** True when the meters can run without the user starting Web Audio. */
  get needsGesture(): boolean {
    return this.stream.status !== 'active' && this.state === 'idle';
  }

  reset(): void {
    this.meter.reset();
    this.emit('levels');
  }
}
