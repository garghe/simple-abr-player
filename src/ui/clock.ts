import type { PlayerController } from '../player/controller';
import { mediaTimeLabel } from './format';

/** Formatter for player times of the current stream: clock time on live streams, position on demand. */
export function timeLabel(ctrl: PlayerController): (t: number) => string {
  const p = ctrl.player;
  const live = !!ctrl.loadedUrl && p.isLive();
  return mediaTimeLabel(live, live ? p.getPlayheadTimeAsDate() : null, ctrl.video.currentTime);
}
