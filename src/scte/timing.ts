import type { ScteEvent } from './monitor';
import { ticksToSeconds, type SpliceInfoSection, type SpliceTime } from './scte35';

/**
 * Splice timing of a marker: where the message says the splice is (PTS),
 * how early it arrived, and how it lines up with the video segments.
 */

/** Below this lead time an ad decision or SSAI system may not have time to react. */
export const DEFAULT_MIN_LEAD = 4;

const PTS_WRAP = 2 ** 33;

export interface MarkerTiming {
  /** splice_time + pts_adjustment, in seconds (33-bit PTS clock). */
  spliceSeconds?: number;
  /** splice_immediate set: no splice time in the message. */
  immediate?: boolean;
  /** How many seconds before its splice time the marker was first seen (live only). */
  lead?: number;
  /** How the lead time was measured. */
  leadBasis?: 'live edge' | 'buffered media' | 'segment tag';
  /** Seconds after the start of the video segment containing the splice. */
  segmentOffset?: number;
  segmentDuration?: number;
  /** Seconds to the nearest segment boundary (0 = aligned). */
  boundaryDistance?: number;
  /** HLS DATERANGE: START-DATE minus the program date time of its segment. */
  dateRangeOffset?: number;
}

/** The splice time carried by a splice_insert / time_signal, before adjustment. */
function spliceTimeOf(section: SpliceInfoSection): SpliceTime | undefined {
  const cmd = section.command;
  if (cmd.type === 'time_signal') return cmd.spliceTime;
  if (cmd.type === 'splice_insert') return cmd.spliceTime ?? cmd.components?.find((c) => c.spliceTime)?.spliceTime;
  return undefined;
}

/** splice_time + pts_adjustment in seconds, or undefined (immediate / no time). */
export function spliceSeconds(section: SpliceInfoSection | undefined): number | undefined {
  if (!section) return undefined;
  const t = spliceTimeOf(section);
  if (!t?.timeSpecified || t.ptsTime === undefined) return undefined;
  return ticksToSeconds((t.ptsTime + section.ptsAdjustment) % PTS_WRAP);
}

/** Difference a − b on the 33-bit PTS clock, in seconds (handles the wrap). */
export function ptsDiff(a: number, b: number): number {
  const wrap = PTS_WRAP / 90000;
  let d = (a - b) % wrap;
  if (d > wrap / 2) d -= wrap;
  if (d < -wrap / 2) d += wrap;
  return d;
}

/** HLS tags that sit on the segment where the splice happens (they arrive with it). */
const SEGMENT_TAGS = new Set(['HLS CUE-OUT', 'HLS CUE-OUT-CONT', 'HLS CUE-IN', 'HLS EXT-X-SCTE35', 'HLS OATCLS', 'HLS SPLICEPOINT']);

export function markerTiming(e: ScteEvent): MarkerTiming {
  const out: MarkerTiming = {};
  out.spliceSeconds = spliceSeconds(e.section);
  const cmd = e.section?.command;
  if (cmd?.type === 'splice_insert' && cmd.spliceImmediate) out.immediate = true;

  // Lead time: live only, measured against what the player could see when the marker appeared.
  if (e.observed?.live && e.startTime !== null) {
    if (SEGMENT_TAGS.has(e.source)) {
      out.leadBasis = 'segment tag';
    } else if (e.source === 'In-band emsg' && e.observed.bufferEnd !== null) {
      // emsg arrives inside a segment: compare with the end of the media buffered so far.
      out.lead = e.startTime - e.observed.bufferEnd;
      out.leadBasis = 'buffered media';
    } else if (e.observed.availabilityEnd !== null) {
      out.lead = e.startTime - e.observed.availabilityEnd;
      out.leadBasis = 'live edge';
    }
  }

  if (e.alignment) {
    const { segmentStart, segmentEnd, offset } = e.alignment;
    out.segmentOffset = offset;
    out.segmentDuration = segmentEnd - segmentStart;
    out.boundaryDistance = Math.min(Math.abs(offset), Math.abs(segmentEnd - (segmentStart + offset)));
  }
  if (e.source === 'HLS DATERANGE' && e.hls?.date && e.hls.segmentDate) {
    out.dateRangeOffset = (e.hls.date.getTime() - e.hls.segmentDate.getTime()) / 1000;
  }
  return out;
}

/** Median of a list (for the PTS-to-timeline offset shared by a stream's markers). */
export function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
