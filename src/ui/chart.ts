import type { Sample } from '../player/controller';
import { formatBitrate } from './format';

interface Series {
  label: string;
  color: string;
  value: (s: Sample) => number;
  format: (v: number) => string;
  /** Plot on the secondary (right) axis. */
  secondary?: boolean;
}

const SERIES: Series[] = [
  { label: 'Estimated bandwidth', color: '#3b82f6', value: (s) => s.estimatedBandwidth, format: formatBitrate },
  { label: 'Stream bitrate', color: '#db2777', value: (s) => s.streamBandwidth, format: formatBitrate },
  { label: 'Buffer ahead', color: '#10b981', value: (s) => s.bufferAhead, format: (v) => `${v.toFixed(1)}s`, secondary: true },
];

/** Small dependency-free line chart for the last few minutes of samples. */
export function drawChart(canvas: HTMLCanvasElement, samples: Sample[]): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const hgt = canvas.clientHeight;
  if (!w || !hgt) return;
  canvas.width = w * dpr;
  canvas.height = hgt * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, hgt);

  const pad = { l: 8, r: 8, t: 22, b: 8 };
  const plotW = w - pad.l - pad.r;
  const plotH = hgt - pad.t - pad.b;

  // Colours follow the active theme (CSS custom properties).
  const css = getComputedStyle(canvas);
  const grid = css.getPropertyValue('--chart-grid').trim() || 'rgba(148,163,184,0.15)';
  const labelColor = css.getPropertyValue('--chart-text').trim() || '#cbd5e1';
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
  }

  const maxPrimary = Math.max(1, ...samples.flatMap((s) => [s.estimatedBandwidth, s.streamBandwidth])) * 1.1;
  const maxSecondary = Math.max(5, ...samples.map((s) => s.bufferAhead)) * 1.1;
  // Fill the width quickly after load, then scroll through the last 3 minutes.
  const n = Math.max(60, samples.length);

  ctx.font = '11px system-ui, sans-serif';
  let legendX = pad.l;
  for (const series of SERIES) {
    const max = series.secondary ? maxSecondary : maxPrimary;
    ctx.strokeStyle = series.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    samples.forEach((s, i) => {
      const x = pad.l + plotW * ((i + n - samples.length) / (n - 1));
      const y = pad.t + plotH - (series.value(s) / max) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const last = samples.at(-1);
    const text = `${series.label}: ${last ? series.format(series.value(last)) : '—'}`;
    ctx.fillStyle = series.color;
    ctx.fillRect(legendX, 7, 8, 8);
    ctx.fillStyle = labelColor;
    ctx.fillText(text, legendX + 12, 15);
    legendX += ctx.measureText(text).width + 24;
  }
}
