import { MeterCore, type SubBlock } from './dsp';
import { parseAudioInit, parseMediaSamples, type AudioTrackConfig } from './mp4';

export interface TimedBlock {
  /** Presentation time (seconds) at which this 100 ms block ends. */
  time: number;
  /** Shaka stream id the audio came from. */
  streamId: number;
  block: SubBlock;
}

interface StreamState {
  id: number;
  config: AudioTrackConfig | null;
  decoder: AudioDecoder | null;
  supported: boolean | null;
  core: MeterCore | null;
  /** Expected start time of the next segment, to detect gaps and seeks. */
  nextStart: number | null;
  /** Segments waiting for the decoder to be configured. */
  pending: { data: Uint8Array; start: number }[];
}

/**
 * Measures audio straight from the downloaded fMP4 segments using WebCodecs,
 * independently of playback. Unlike tapping the <video> element through Web
 * Audio, this sees every encoded channel (a 5.1 track stays 5.1 even when
 * the browser plays it as stereo) and needs no user gesture or unmuted audio.
 *
 * Measurements are timestamped with the segment's presentation time; the
 * engine releases them as the playhead reaches them.
 */
export class StreamMeter {
  private streams = new Map<number, StreamState>();
  status: 'idle' | 'active' | 'unsupported' = 'idle';
  reason = '';
  config: AudioTrackConfig | null = null;

  constructor(private readonly onBlock: (b: TimedBlock) => void) {}

  static get available(): boolean {
    return typeof AudioDecoder !== 'undefined' && typeof EncodedAudioChunk !== 'undefined';
  }

  reset(): void {
    for (const s of this.streams.values()) {
      try {
        s.decoder?.close();
      } catch {
        /* already closed */
      }
    }
    this.streams.clear();
    this.status = 'idle';
    this.reason = '';
    this.config = null;
  }

  private state(id: number): StreamState {
    let s = this.streams.get(id);
    if (!s) {
      s = { id, config: null, decoder: null, supported: null, core: null, nextStart: null, pending: [] };
      this.streams.set(id, s);
    }
    return s;
  }

  init(streamId: number, data: Uint8Array): void {
    if (!StreamMeter.available) {
      this.markUnsupported('this browser has no WebCodecs AudioDecoder');
      return;
    }
    const cfg = parseAudioInit(data);
    if (!cfg) {
      this.markUnsupported(notFmp4Reason(data));
      return;
    }
    const s = this.state(streamId);
    if (s.config && s.config.codec === cfg.codec && s.decoder) return; // same init repeated
    s.config = cfg;
    if (cfg.unsupported) {
      s.supported = false;
      this.markUnsupported(cfg.unsupported);
      return;
    }
    const config: AudioDecoderConfig = {
      codec: cfg.codec,
      sampleRate: cfg.sampleRate,
      numberOfChannels: cfg.channels,
      ...(cfg.description ? { description: cfg.description } : {}),
    };
    AudioDecoder.isConfigSupported(config)
      .then((r) => {
        if (!r.supported) {
          s.supported = false;
          this.markUnsupported(`WebCodecs cannot decode ${cfg.codec} (${cfg.channels} ch) in this browser`);
          return;
        }
        s.decoder?.close();
        s.decoder = new AudioDecoder({
          output: (audio) => this.onAudio(s, audio),
          error: (e) => {
            s.supported = false;
            this.markUnsupported(`decoder error: ${e.message}`);
          },
        });
        s.decoder.configure(config);
        s.supported = true;
        s.core = new MeterCore(cfg.sampleRate);
        this.config = cfg;
        for (const p of s.pending.splice(0)) this.decode(s, p.data, p.start);
      })
      .catch((e) => this.markUnsupported(String(e)));
  }

  segment(streamId: number, data: Uint8Array, startTime: number): void {
    const s = this.streams.get(streamId);
    if (!s) {
      // No init segment seen: MPEG-2 TS, packed audio (ADTS/AC-3) or similar.
      this.markUnsupported(notFmp4Reason(data));
      return;
    }
    if (s.supported === false) return;
    if (s.supported === null) {
      if (s.pending.length < 4) s.pending.push({ data, start: startTime });
      return;
    }
    this.decode(s, data, startTime);
  }

  private decode(s: StreamState, data: Uint8Array, startTime: number) {
    const cfg = s.config!;
    const decoder = s.decoder;
    if (!decoder || decoder.state !== 'configured') return;
    // A gap or jump (seek, track switch) restarts filters so old state doesn't leak in.
    if (s.nextStart === null || Math.abs(startTime - s.nextStart) > 0.1) {
      s.core = new MeterCore(cfg.sampleRate);
    }
    let t = startTime;
    for (const sample of parseMediaSamples(data, cfg)) {
      decoder.decode(
        new EncodedAudioChunk({
          type: 'key',
          timestamp: Math.round(t * 1e6),
          data: data.subarray(sample.offset, sample.offset + sample.size),
        }),
      );
      t += sample.duration / cfg.timescale;
    }
    s.nextStart = t;
  }

  private onAudio(s: StreamState, audio: AudioData) {
    try {
      const channels = audio.numberOfChannels;
      const planes: Float32Array[] = [];
      for (let c = 0; c < channels; c++) {
        const buf = new Float32Array(audio.numberOfFrames);
        audio.copyTo(buf, { planeIndex: c, format: 'f32-planar' });
        planes.push(buf);
      }
      const end = (audio.timestamp + audio.duration) / 1e6;
      for (const block of s.core!.process(planes)) this.onBlock({ time: end, block, streamId: s.id });
      if (this.status !== 'active') {
        this.status = 'active';
        this.reason = '';
      }
    } finally {
      audio.close();
    }
  }

  private markUnsupported(reason: string) {
    if (this.status === 'active') return;
    this.status = 'unsupported';
    this.reason = reason;
  }
}

function notFmp4Reason(data: Uint8Array): string {
  if (data[0] === 0x47 && (data.length < 189 || data[188] === 0x47)) return 'MPEG-2 TS segments are not supported for direct measuring';
  if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) return 'WebM segments are not supported for direct measuring';
  return 'audio segments are not fragmented MP4';
}
