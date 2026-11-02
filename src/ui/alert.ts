/** Short alert tones and browser notifications, shared by the SCTE and picture/sound alarms. */

let ctx: AudioContext | null = null;

/** Plays a sequence of short tones (Hz). */
export function beep(tones: number[]) {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
    tones.forEach((f, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      const t = ctx!.currentTime + i * 0.16;
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t);
      osc.stop(t + 0.15);
    });
  } catch {
    /* no Web Audio */
  }
}

export function notify(title: string, body: string, tag: string) {
  if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, tag });
}

/** Asks for notification permission; returns a message if notifications can't be shown. */
export async function enableNotifications(): Promise<string | null> {
  if (!('Notification' in window)) return 'This browser has no notifications';
  if (Notification.permission === 'default') return (await Notification.requestPermission()) === 'granted' ? null : 'Notifications are blocked for this page';
  return Notification.permission === 'denied' ? 'Notifications are blocked for this page: allow them in the browser settings' : null;
}
