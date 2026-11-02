import { crc32Mpeg2, toHex } from './scte35';

/**
 * SCTE-35 encoder: builds a splice_info_section (splice_insert, time_signal
 * or splice_null, with segmentation descriptors) for the builder and tests.
 * The output parses back with parseScte35.
 */

export interface SpliceInsertSpec {
  type: 'splice_insert';
  eventId: number;
  cancel?: boolean;
  /** OUT (true) or IN (false). */
  outOfNetwork: boolean;
  immediate?: boolean;
  /** Splice time in 90 kHz ticks (ignored when immediate). */
  pts?: number;
  /** Break duration in 90 kHz ticks. */
  duration?: number;
  autoReturn?: boolean;
  uniqueProgramId?: number;
  availNum?: number;
  availsExpected?: number;
}

export interface TimeSignalSpec {
  type: 'time_signal';
  /** 90 kHz ticks; omitted = time not specified. */
  pts?: number;
}

export type CommandSpec = SpliceInsertSpec | TimeSignalSpec | { type: 'splice_null' };

export interface SegmentationSpec {
  eventId: number;
  cancel?: boolean;
  typeId: number;
  /** 90 kHz ticks. */
  duration?: number;
  upidType?: number;
  /** UPID bytes: text, or hex with a 0x prefix. */
  upid?: string;
  segmentNum?: number;
  segmentsExpected?: number;
  subSegmentNum?: number;
  subSegmentsExpected?: number;
  /** Restrictions; all false = delivery not restricted. */
  webDeliveryAllowed?: boolean;
  noRegionalBlackout?: boolean;
  archiveAllowed?: boolean;
  deviceRestrictions?: number;
  restricted?: boolean;
}

export interface SectionSpec {
  command: CommandSpec;
  descriptors?: SegmentationSpec[];
  /** 90 kHz ticks added to every splice time. */
  ptsAdjustment?: number;
  tier?: number;
}

const SUB_SEGMENT_TYPES = new Set([0x34, 0x36, 0x38, 0x3a, 0x44, 0x46]);
const MAX_33 = 2 ** 33;

class BitWriter {
  private bytes: number[] = [];
  private cur = 0;
  private n = 0;

  bits(count: number, value: number): this {
    for (let i = count - 1; i >= 0; i--) {
      const bit = Math.floor(value / 2 ** i) % 2;
      this.cur = (this.cur << 1) | bit;
      if (++this.n === 8) {
        this.bytes.push(this.cur);
        this.cur = 0;
        this.n = 0;
      }
    }
    return this;
  }

  flag(v: boolean | undefined): this {
    return this.bits(1, v ? 1 : 0);
  }

  raw(data: Uint8Array | number[]): this {
    if (this.n !== 0) throw new Error('Unaligned write');
    this.bytes.push(...data);
    return this;
  }

  done(): Uint8Array {
    if (this.n !== 0) throw new Error('Unaligned end');
    return Uint8Array.from(this.bytes);
  }
}

function spliceTime(w: BitWriter, pts: number | undefined) {
  if (pts === undefined) return w.flag(false).bits(7, 0x7f);
  return w.flag(true).bits(6, 0x3f).bits(33, ((pts % MAX_33) + MAX_33) % MAX_33);
}

/** UPID text, or 0x-prefixed hex, to bytes. */
export function upidBytes(upid: string | undefined): Uint8Array {
  if (!upid) return new Uint8Array();
  const hex = upid.match(/^0x([0-9a-f]*)$/i)?.[1];
  if (hex !== undefined) {
    if (hex.length % 2) throw new Error('UPID hex needs an even number of digits');
    return Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
  }
  return new TextEncoder().encode(upid);
}

function command(spec: CommandSpec): Uint8Array {
  const w = new BitWriter();
  if (spec.type === 'time_signal') spliceTime(w, spec.pts);
  if (spec.type === 'splice_insert') {
    w.bits(32, spec.eventId).flag(spec.cancel).bits(7, 0x7f);
    if (!spec.cancel) {
      const hasDuration = spec.duration !== undefined;
      w.flag(spec.outOfNetwork).flag(true).flag(hasDuration).flag(spec.immediate).flag(true).bits(3, 0x7);
      if (!spec.immediate) spliceTime(w, spec.pts ?? 0);
      if (hasDuration) w.flag(spec.autoReturn ?? true).bits(6, 0x3f).bits(33, spec.duration!);
      w.bits(16, spec.uniqueProgramId ?? 0).bits(8, spec.availNum ?? 0).bits(8, spec.availsExpected ?? 0);
    }
  }
  return w.done();
}

function segmentation(spec: SegmentationSpec): Uint8Array {
  const w = new BitWriter();
  w.raw([0x43, 0x55, 0x45, 0x49]); // "CUEI"
  w.bits(32, spec.eventId).flag(spec.cancel).flag(true).bits(6, 0x3f);
  if (!spec.cancel) {
    const hasDuration = spec.duration !== undefined;
    w.flag(true).flag(hasDuration).flag(!spec.restricted);
    if (spec.restricted) {
      w.flag(spec.webDeliveryAllowed).flag(spec.noRegionalBlackout).flag(spec.archiveAllowed).bits(2, spec.deviceRestrictions ?? 3);
    } else {
      w.bits(5, 0x1f);
    }
    if (hasDuration) w.bits(40, spec.duration!);
    const upid = upidBytes(spec.upid);
    if (upid.length > 255) throw new Error('UPID is longer than 255 bytes');
    w.bits(8, upid.length ? (spec.upidType ?? 0x0f) : 0).bits(8, upid.length).raw(upid);
    w.bits(8, spec.typeId).bits(8, spec.segmentNum ?? 0).bits(8, spec.segmentsExpected ?? 0);
    if (SUB_SEGMENT_TYPES.has(spec.typeId)) w.bits(8, spec.subSegmentNum ?? 0).bits(8, spec.subSegmentsExpected ?? 0);
  }
  const body = w.done();
  return Uint8Array.from([0x02, body.length, ...body]);
}

const COMMAND_TYPES = { splice_null: 0x00, splice_insert: 0x05, time_signal: 0x06 } as const;

/** Builds the binary splice_info_section, CRC included. */
export function encodeScte35(spec: SectionSpec): Uint8Array {
  const cmd = command(spec.command);
  const descriptors = (spec.descriptors ?? []).map(segmentation);
  const loop = descriptors.reduce((n, d) => n + d.length, 0);
  // Bytes after section_length: 11 fixed + command + 2 loop length + descriptors + 4 CRC.
  const sectionLength = 11 + cmd.length + 2 + loop + 4;
  const w = new BitWriter();
  w.bits(8, 0xfc).flag(false).flag(false).bits(2, 3).bits(12, sectionLength);
  w.bits(8, 0).flag(false).bits(6, 0).bits(33, spec.ptsAdjustment ?? 0);
  w.bits(8, 0).bits(12, spec.tier ?? 0xfff).bits(12, cmd.length).bits(8, COMMAND_TYPES[spec.command.type]);
  w.raw(cmd).bits(16, loop);
  for (const d of descriptors) w.raw(d);
  const body = w.done();
  const crc = crc32Mpeg2(body);
  return Uint8Array.from([...body, (crc >>> 24) & 255, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255]);
}

export const toBase64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
export const toHexString = (b: Uint8Array): string => `0x${toHex(b).toUpperCase()}`;

/** Seconds to 90 kHz ticks. */
export const ticks = (seconds: number): number => Math.round(seconds * 90000);

export interface TagInfo {
  /** OUT / IN / other, picks SCTE35-OUT / -IN / -CMD and CUE-OUT / CUE-IN. */
  direction: 'out' | 'in' | 'other';
  /** Seconds. */
  duration?: number;
  id: string;
  /** DATERANGE START-DATE. */
  startDate: Date;
}

/** The message as the common HLS tags. */
export function hlsTags(bytes: Uint8Array, info: TagInfo): string[] {
  const hex = toHexString(bytes);
  const b64 = toBase64(bytes);
  const attr = info.direction === 'out' ? 'SCTE35-OUT' : info.direction === 'in' ? 'SCTE35-IN' : 'SCTE35-CMD';
  const dur = info.duration !== undefined ? `,PLANNED-DURATION=${+info.duration.toFixed(3)}` : '';
  const tags = [`#EXT-X-DATERANGE:ID="${info.id}",START-DATE="${info.startDate.toISOString()}"${dur},${attr}=${hex}`];
  if (info.direction === 'out') tags.push(`#EXT-X-CUE-OUT:${info.duration !== undefined ? `DURATION=${+info.duration.toFixed(3)}` : ''}`.replace(/:$/, ''));
  if (info.direction === 'in') tags.push('#EXT-X-CUE-IN');
  tags.push(`#EXT-OATCLS-SCTE35:${b64}`, `#EXT-X-SCTE35:CUE="${b64}"${info.id ? `,ID="${info.id}"` : ''}`);
  return tags;
}

/** The message as a DASH EventStream (SCTE 214 xml+bin), times in 90 kHz. */
export function dashEventStream(bytes: Uint8Array, info: { presentationTime: number; duration?: number; id: string }): string {
  const dur = info.duration !== undefined ? ` duration="${ticks(info.duration)}"` : '';
  return [
    '<EventStream schemeIdUri="urn:scte:scte35:2014:xml+bin" timescale="90000">',
    `  <Event presentationTime="${ticks(info.presentationTime)}"${dur} id="${info.id}">`,
    '    <Signal xmlns="http://www.scte.org/schemas/35/2016">',
    `      <Binary>${toBase64(bytes)}</Binary>`,
    '    </Signal>',
    '  </Event>',
    '</EventStream>',
  ].join('\n');
}
