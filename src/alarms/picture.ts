import { frameStats, type AlarmMonitor } from './monitor';

export type PictureState = 'idle' | 'ok' | 'drm' | 'blocked';

const W = 64;
const H = 36;

/**
 * Samples the picture four times a second into a 64×36 canvas and feeds the
 * black / freeze alarms. Protected (DRM) video can't be read back, and nor can
 * cross-origin video played natively without CORS: then it reports why.
 */
export class PictureSampler {
  state: PictureState = 'idle';
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  private previous: Float32Array | null = null;
  private lastTime = -1;
  private timer = 0;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly alarms: AlarmMonitor,
    private readonly isProtected: () => boolean,
  ) {
    this.canvas.width = W;
    this.canvas.height = H;
  }

  start() {
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.sample(), 250);
  }

  reset() {
    this.previous = null;
    this.lastTime = -1;
    this.state = 'idle';
  }

  private sample() {
    const v = this.video;
    const now = Date.now();
    const playing = !v.paused && !v.ended && !v.seeking && v.readyState >= 2;
    if (!playing || !this.ctx) {
      this.alarms.picture(null, now, v.currentTime, false);
      return;
    }
    if (this.isProtected()) {
      this.state = 'drm';
      this.alarms.picture(null, now, v.currentTime, false);
      return;
    }
    let data: Uint8ClampedArray;
    try {
      this.ctx.drawImage(v, 0, 0, W, H);
      data = this.ctx.getImageData(0, 0, W, H).data;
    } catch {
      this.state = 'blocked';
      this.alarms.picture(null, now, v.currentTime, false);
      return;
    }
    this.state = 'ok';
    const { stats, luma } = frameStats(data, this.previous, W);
    const advancing = this.lastTime >= 0 && v.currentTime > this.lastTime + 0.05;
    this.previous = luma;
    this.lastTime = v.currentTime;
    this.alarms.picture(stats, now, v.currentTime, advancing);
  }
}
