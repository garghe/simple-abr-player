import { compareCodecs } from '../media/segment';
import type { SegmentRecord, StreamIssue, StreamMonitor } from './monitor';

/**
 * Stream health: problems in the HLS playlists / MPD and in the segments
 * the player downloaded. Events between refreshes come from the monitor;
 * the rest is computed from the current state each time.
 */

export interface StreamHealthContext {
  now?: number;
  /** Video frame duration (s), for timing tolerances. */
  frameDuration?: number;
}

const fmt = (s: number) => `${s.toFixed(s < 10 ? 2 : 1)} s`;
const kbps = (b: number) => `${Math.round(b / 1000)} kbps`;

export function checkStreamHealth(m: StreamMonitor, ctx: StreamHealthContext = {}): StreamIssue[] {
  const now = ctx.now ?? Date.now();
  const frame = Math.max(ctx.frameDuration ?? 0.04, 0.02);
  const issues: StreamIssue[] = [...m.events];
  const add = (i: StreamIssue) => issues.push(i);

  // ---------------------------------------------------------------- HLS playlists
  for (const p of m.playlists.values()) {
    const info = p.info;
    const td = info.targetDuration;
    if (td !== undefined) {
      const long = info.segments.filter((s) => Math.round(s.duration) > td);
      if (long.length) {
        const worst = long.reduce((a, b) => (b.duration > a.duration ? b : a));
        add({ severity: 'error', code: 'over-td', title: 'Segment longer than the target duration', detail: `${long.length} segment(s) longer than EXT-X-TARGETDURATION ${td} s (longest ${fmt(worst.duration)}). Players size their buffers and reloads on it.`, where: p.label });
      }
    }
    // PROGRAM-DATE-TIME should advance by each segment's duration (except across discontinuities).
    for (let i = 0; i + 1 < info.segments.length; i++) {
      const a = info.segments[i];
      const b = info.segments[i + 1];
      if (!a.date || !b.date || b.discontinuity) continue;
      const drift = (b.date.getTime() - a.date.getTime()) / 1000 - a.duration;
      if (Math.abs(drift) > 0.5) {
        add({ severity: 'warn', code: 'pdt-drift', title: 'PROGRAM-DATE-TIME drifts from segment durations', detail: `Between segments ${info.mediaSequence + i} and ${info.mediaSequence + i + 1} the date moves ${fmt(a.duration + drift)} for a ${fmt(a.duration)} segment (${drift > 0 ? '+' : ''}${drift.toFixed(2)} s).`, where: p.label });
        break;
      }
    }
    // Stale: a live playlist the player keeps reloading that has stopped changing.
    if (p.live && td) {
      const unchanged = (now - p.lastChangeAt) / 1000;
      const polled = (now - p.lastFetchAt) / 1000 < 2 * td + 2;
      if (polled && p.refreshes > 1 && unchanged > Math.max(3 * td, 6)) {
        add({ severity: unchanged > 6 * td ? 'error' : 'warn', code: 'stale', title: 'Live playlist is not updating', detail: `No change for ${fmt(unchanged)} (target duration ${td} s): the encoder or packager may have stopped.`, where: p.label });
      }
    }
  }

  // ------------------------------------------------------------------- DASH MPD
  if (m.mpd) {
    const { summary, fetchedAt, timelineEnds } = m.mpd;
    for (const tl of summary.timelines) {
      for (let i = 0; i + 1 < tl.entries.length; i++) {
        const a = tl.entries[i];
        const b = tl.entries[i + 1];
        const gap = (b.t - (a.t + a.d)) / tl.timescale;
        if (Math.abs(gap) > frame / 2) {
          add({ severity: 'warn', code: 'timeline-gap', title: gap > 0 ? 'Gap in the SegmentTimeline' : 'Overlap in the SegmentTimeline', detail: `${fmt(Math.abs(gap))} ${gap > 0 ? 'gap' : 'overlap'} at ${fmt(b.t / tl.timescale)} (media time).`, where: tl.label });
          break;
        }
      }
      if (summary.maxSegmentDuration !== undefined) {
        const longest = Math.max(...tl.entries.map((e) => e.d / tl.timescale));
        if (longest > summary.maxSegmentDuration + frame) {
          add({ severity: 'warn', code: 'over-max-seg', title: 'Segment longer than @maxSegmentDuration', detail: `${fmt(longest)} against ${fmt(summary.maxSegmentDuration)}.`, where: tl.label });
        }
      }
      if (summary.dynamic) {
        const end = timelineEnds.get(tl.label);
        const seg = Math.max(...tl.entries.slice(-3).map((e) => e.d / tl.timescale), 1);
        const unchanged = end ? (now - end.changedAt) / 1000 : 0;
        if (end && (now - fetchedAt) / 1000 < Math.max(2 * (summary.minimumUpdatePeriod ?? seg), 10) && unchanged > Math.max(3 * seg, 6)) {
          add({ severity: unchanged > 6 * seg ? 'error' : 'warn', code: 'stale', title: 'Live MPD is not growing', detail: `The SegmentTimeline hasn't gained a segment for ${fmt(unchanged)} (segments are about ${fmt(seg)}).`, where: tl.label });
        }
      }
    }
    for (let i = 0; i + 1 < summary.periods.length; i++) {
      const a = summary.periods[i];
      const b = summary.periods[i + 1];
      if (a.start === undefined || a.duration === undefined || b.start === undefined) continue;
      const gap = b.start - (a.start + a.duration);
      if (Math.abs(gap) > 0.1) {
        add({ severity: 'warn', code: 'period-gap', title: gap > 0 ? 'Gap between periods' : 'Periods overlap', detail: `Period ${a.id ?? i + 1} ends at ${fmt(a.start + a.duration)}, period ${b.id ?? i + 2} starts at ${fmt(b.start)}.`, where: 'MPD' });
      }
    }
  }

  // ------------------------------------------------------------------ segments
  for (const s of m.streams.values()) {
    const segs = m.segments.filter((r) => r.streamId === s.id).sort((a, b) => a.declaredStart - b.declaredStart);
    const track = s.init?.tracks.find((t) => (s.kind === 'video' ? t.handler === 'vide' : s.kind === 'audio' ? t.handler === 'soun' : true));
    if (track?.codec && s.declaredCodecs) {
      for (const c of compareCodecs(s.declaredCodecs.split(',').map((x) => x.trim()), [track.codec])) {
        add({
          severity: 'warn',
          code: 'codecs',
          title: c.problem === 'differs' ? 'Codec string differs from the media' : 'Codec not declared in the manifest',
          detail: c.problem === 'differs' ? `Manifest says ${c.declared}, the init segment is ${c.codec}. Players choose renditions on the declared codecs.` : `The media is ${c.codec} but the manifest declares ${s.declaredCodecs}.`,
          where: s.label,
        });
      }
    }
    if (s.kind === 'video') {
      const noKey = segs.filter((r) => r.actual?.startsWithKeyframe === false);
      if (noKey.length) {
        add({ severity: 'error', code: 'no-keyframe', title: 'Segment does not start with a keyframe', detail: `${noKey.length} of ${segs.length} segments (first at ${fmt(noKey[0].declaredStart)}). Switching quality or seeking there shows corrupt or frozen video.`, where: s.label, time: noKey[0].declaredStart });
      }
    }
    const off = segs.filter((r) => r.actual && Math.abs(r.actual.duration - (r.declaredEnd - r.declaredStart)) > Math.max(0.1, 0.05 * (r.declaredEnd - r.declaredStart)));
    if (off.length) {
      const r = off[0];
      add({ severity: 'warn', code: 'duration', title: 'Segment duration differs from the manifest', detail: `${off.length} segment(s); e.g. at ${fmt(r.declaredStart)} the manifest says ${fmt(r.declaredEnd - r.declaredStart)}, the media has ${fmt(r.actual!.duration)}.`, where: s.label, time: r.declaredStart });
    }
    const gaps = mediaGaps(segs, frame);
    if (gaps.length) {
      const g = gaps[0];
      add({ severity: 'warn', code: 'media-gap', title: g.gap > 0 ? 'Gap in the media timestamps' : 'Overlap in the media timestamps', detail: `${gaps.length} place(s); at ${fmt(g.at)} the next segment starts ${fmt(Math.abs(g.gap))} ${g.gap > 0 ? 'after' : 'before'} the previous one ends.`, where: s.label, time: g.at });
    }
    // Bitrate: HLS BANDWIDTH is a peak for the whole variant, so video alone above it is a definite error.
    if (s.declaredBandwidth && segs.length >= 2 && s.kind === 'video') {
      const rates = segs.map((r) => (r.bytes * 8) / Math.max(0.1, r.declaredEnd - r.declaredStart));
      const peak = Math.max(...rates);
      const avg = segs.reduce((n, r) => n + r.bytes * 8, 0) / segs.reduce((n, r) => n + (r.declaredEnd - r.declaredStart), 0);
      if (s.format === 'HLS' && peak > s.declaredBandwidth * 1.1) {
        add({ severity: 'warn', code: 'bandwidth', title: 'Segment bitrate above the declared BANDWIDTH', detail: `Peak video segment ${kbps(peak)} against BANDWIDTH ${kbps(s.declaredBandwidth)} for the whole variant. Players may pick a rendition the network can't sustain.`, where: s.label });
      } else if (s.format === 'DASH' && avg > s.declaredBandwidth * 1.25) {
        add({ severity: 'warn', code: 'bandwidth', title: 'Average bitrate above the declared @bandwidth', detail: `Average ${kbps(avg)} against @bandwidth ${kbps(s.declaredBandwidth)}.`, where: s.label });
      }
    }
  }

  const rank = { error: 0, warn: 1, info: 2 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Places where consecutive segments' media timestamps don't join up. */
function mediaGaps(segs: SegmentRecord[], frame: number): { at: number; gap: number }[] {
  const out: { at: number; gap: number }[] = [];
  for (let i = 0; i + 1 < segs.length; i++) {
    const a = segs[i];
    const b = segs[i + 1];
    if (!a.actual || !b.actual || a.actual.format !== b.actual.format) continue;
    // Only neighbours in the manifest (not segments far apart after a seek).
    if (Math.abs(b.declaredStart - a.declaredEnd) > 0.05) continue;
    const gap = b.actual.start - (a.actual.start + a.actual.duration);
    // Large jumps are timestamp resets (discontinuities), not gaps.
    if (Math.abs(gap) > frame && Math.abs(gap) < 30) out.push({ at: b.declaredStart, gap });
  }
  return out;
}
