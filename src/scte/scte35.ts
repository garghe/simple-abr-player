/**
 * SCTE-35 splice_info_section decoder (ANSI/SCTE 35 2023r1).
 *
 * Decodes the binary form that reaches the player through DASH EventStream
 * <Binary>, in-band `emsg` boxes and the HLS SCTE35-OUT/IN/CMD, CUE, and
 * OATCLS tags. Encrypted sections are reported but not decrypted.
 */

export interface SpliceTime {
  timeSpecified: boolean;
  /** 33-bit PTS in 90 kHz ticks, before pts_adjustment. */
  ptsTime?: number;
}

export interface BreakDuration {
  autoReturn: boolean;
  /** 90 kHz ticks. */
  duration: number;
}

export interface SpliceInsert {
  type: 'splice_insert';
  spliceEventId: number;
  cancel: boolean;
  outOfNetwork?: boolean;
  programSplice?: boolean;
  spliceImmediate?: boolean;
  eventIdCompliance?: boolean;
  spliceTime?: SpliceTime;
  components?: { tag: number; spliceTime?: SpliceTime }[];
  breakDuration?: BreakDuration;
  uniqueProgramId?: number;
  availNum?: number;
  availsExpected?: number;
}

export interface TimeSignal {
  type: 'time_signal';
  spliceTime: SpliceTime;
}

export interface SpliceSchedule {
  type: 'splice_schedule';
  spliceCount: number;
}

export interface GenericCommand {
  type: 'splice_null' | 'bandwidth_reservation' | 'private_command' | 'unknown';
  identifier?: string;
}

export type SpliceCommand = SpliceInsert | TimeSignal | SpliceSchedule | GenericCommand;

export interface SegmentationDescriptor {
  tag: 0x02;
  name: 'segmentation_descriptor';
  identifier: string;
  segmentationEventId: number;
  cancel: boolean;
  programSegmentation?: boolean;
  deliveryNotRestricted?: boolean;
  webDeliveryAllowed?: boolean;
  noRegionalBlackout?: boolean;
  archiveAllowed?: boolean;
  deviceRestrictions?: number;
  /** 90 kHz ticks. */
  segmentationDuration?: number;
  upidType?: number;
  upidTypeName?: string;
  upid?: string;
  segmentationTypeId?: number;
  segmentationTypeName?: string;
  segmentNum?: number;
  segmentsExpected?: number;
  subSegmentNum?: number;
  subSegmentsExpected?: number;
}

export interface OtherDescriptor {
  tag: number;
  name: string;
  identifier: string;
  providerAvailId?: number;
  dtmfChars?: string;
  taiSeconds?: number;
  raw: string;
}

export type SpliceDescriptor = SegmentationDescriptor | OtherDescriptor;

export interface SpliceInfoSection {
  tableId: number;
  sectionLength: number;
  sapType: number;
  protocolVersion: number;
  encrypted: boolean;
  encryptionAlgorithm: number;
  /** 33-bit, 90 kHz ticks. */
  ptsAdjustment: number;
  cwIndex: number;
  tier: number;
  spliceCommandType: number;
  spliceCommandName: string;
  command: SpliceCommand;
  descriptors: SpliceDescriptor[];
  crc32: number;
  crcValid: boolean;
}

export const COMMAND_NAMES: Record<number, string> = {
  0x00: 'splice_null',
  0x04: 'splice_schedule',
  0x05: 'splice_insert',
  0x06: 'time_signal',
  0x07: 'bandwidth_reservation',
  0xff: 'private_command',
};

export const SEGMENTATION_TYPES: Record<number, string> = {
  0x00: 'Not Indicated',
  0x01: 'Content Identification',
  0x02: 'Call Ad Server',
  0x10: 'Program Start',
  0x11: 'Program End',
  0x12: 'Program Early Termination',
  0x13: 'Program Breakaway',
  0x14: 'Program Resumption',
  0x15: 'Program Runover Planned',
  0x16: 'Program Runover Unplanned',
  0x17: 'Program Overlap Start',
  0x18: 'Program Blackout Override',
  0x19: 'Program Join',
  0x20: 'Chapter Start',
  0x21: 'Chapter End',
  0x22: 'Break Start',
  0x23: 'Break End',
  0x24: 'Opening Credit Start',
  0x25: 'Opening Credit End',
  0x26: 'Closing Credit Start',
  0x27: 'Closing Credit End',
  0x30: 'Provider Advertisement Start',
  0x31: 'Provider Advertisement End',
  0x32: 'Distributor Advertisement Start',
  0x33: 'Distributor Advertisement End',
  0x34: 'Provider Placement Opportunity Start',
  0x35: 'Provider Placement Opportunity End',
  0x36: 'Distributor Placement Opportunity Start',
  0x37: 'Distributor Placement Opportunity End',
  0x38: 'Provider Overlay Placement Opportunity Start',
  0x39: 'Provider Overlay Placement Opportunity End',
  0x3a: 'Distributor Overlay Placement Opportunity Start',
  0x3b: 'Distributor Overlay Placement Opportunity End',
  0x3c: 'Provider Promo Start',
  0x3d: 'Provider Promo End',
  0x3e: 'Distributor Promo Start',
  0x3f: 'Distributor Promo End',
  0x40: 'Unscheduled Event Start',
  0x41: 'Unscheduled Event End',
  0x42: 'Alternate Content Opportunity Start',
  0x43: 'Alternate Content Opportunity End',
  0x44: 'Provider Ad Block Start',
  0x45: 'Provider Ad Block End',
  0x46: 'Distributor Ad Block Start',
  0x47: 'Distributor Ad Block End',
  0x50: 'Network Start',
  0x51: 'Network End',
};

export const UPID_TYPES: Record<number, string> = {
  0x00: 'Not Used',
  0x01: 'User Defined (deprecated)',
  0x02: 'ISCI (deprecated)',
  0x03: 'Ad-ID',
  0x04: 'UMID',
  0x05: 'ISAN (deprecated)',
  0x06: 'ISAN',
  0x07: 'TID',
  0x08: 'TI (AiringID)',
  0x09: 'ADI',
  0x0a: 'EIDR',
  0x0b: 'ATSC Content Identifier',
  0x0c: 'MPU',
  0x0d: 'MID',
  0x0e: 'ADS Information',
  0x0f: 'URI',
  0x10: 'UUID',
  0x11: 'SCR',
};

const DESCRIPTOR_NAMES: Record<number, string> = {
  0x00: 'avail_descriptor',
  0x01: 'DTMF_descriptor',
  0x02: 'segmentation_descriptor',
  0x03: 'time_descriptor',
  0x04: 'audio_descriptor',
};

/** Segmentation types that mark the start of an ad/placement opportunity. */
export const OUT_SEGMENTATION_TYPES = new Set([
  0x22, 0x30, 0x32, 0x34, 0x36, 0x38, 0x3a, 0x3c, 0x3e, 0x40, 0x42, 0x44, 0x46,
]);
/** Segmentation types that mark the end of an ad/placement opportunity. */
export const IN_SEGMENTATION_TYPES = new Set([
  0x23, 0x31, 0x33, 0x35, 0x37, 0x39, 0x3b, 0x3d, 0x3f, 0x41, 0x43, 0x45, 0x47,
]);
/** Types that carry sub_segment_num / sub_segments_expected. */
const SUB_SEGMENT_TYPES = new Set([0x34, 0x36, 0x38, 0x3a, 0x44, 0x46]);

export class Scte35Error extends Error {}

class BitReader {
  private bytePos = 0;
  private bitPos = 0;
  constructor(private readonly data: Uint8Array) {}

  get offset(): number {
    return this.bytePos;
  }

  get remaining(): number {
    return this.data.length - this.bytePos;
  }

  /** Reads up to 53 bits as an unsigned number (exact for doubles). */
  bits(n: number): number {
    let value = 0;
    for (let i = 0; i < n; i++) {
      if (this.bytePos >= this.data.length) {
        throw new Scte35Error('Unexpected end of SCTE-35 data');
      }
      const bit = (this.data[this.bytePos] >> (7 - this.bitPos)) & 1;
      value = value * 2 + bit;
      if (++this.bitPos === 8) {
        this.bitPos = 0;
        this.bytePos++;
      }
    }
    return value;
  }

  flag(): boolean {
    return this.bits(1) === 1;
  }

  bytes(n: number): Uint8Array {
    if (this.bitPos !== 0) throw new Scte35Error('Unaligned byte read');
    if (this.bytePos + n > this.data.length) {
      throw new Scte35Error('Unexpected end of SCTE-35 data');
    }
    const out = this.data.subarray(this.bytePos, this.bytePos + n);
    this.bytePos += n;
    return out;
  }

  seek(byteOffset: number): void {
    this.bytePos = byteOffset;
    this.bitPos = 0;
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let j = 0; j < 8; j++) {
      c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/** CRC-32/MPEG-2 as used by MPEG-TS sections. */
export function crc32Mpeg2(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
  }
  return crc >>> 0;
}

export function toHex(data: Uint8Array): string {
  return Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('');
}

function ascii(data: Uint8Array): string {
  return Array.from(data, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
}

/**
 * Accepts base64, hex (with or without 0x prefix) or raw bytes and returns
 * the bytes of the splice_info_section.
 */
export function decodeScte35Input(input: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  const text = input.trim().replace(/^"|"$/g, '');
  const hex = text.replace(/^0x/i, '');
  if (/^([0-9a-f]{2})+$/i.test(hex) && (/^0x/i.test(text) || /^fc/i.test(hex))) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  const b64 = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function readSpliceTime(r: BitReader): SpliceTime {
  const timeSpecified = r.flag();
  if (timeSpecified) {
    r.bits(6);
    return { timeSpecified, ptsTime: r.bits(33) };
  }
  r.bits(7);
  return { timeSpecified };
}

function readBreakDuration(r: BitReader): BreakDuration {
  const autoReturn = r.flag();
  r.bits(6);
  return { autoReturn, duration: r.bits(33) };
}

function readSpliceInsert(r: BitReader): SpliceInsert {
  const cmd: SpliceInsert = {
    type: 'splice_insert',
    spliceEventId: r.bits(32),
    cancel: r.flag(),
  };
  r.bits(7);
  if (cmd.cancel) return cmd;
  cmd.outOfNetwork = r.flag();
  cmd.programSplice = r.flag();
  const durationFlag = r.flag();
  cmd.spliceImmediate = r.flag();
  cmd.eventIdCompliance = r.flag();
  r.bits(3);
  if (cmd.programSplice && !cmd.spliceImmediate) {
    cmd.spliceTime = readSpliceTime(r);
  }
  if (!cmd.programSplice) {
    const count = r.bits(8);
    cmd.components = [];
    for (let i = 0; i < count; i++) {
      const tag = r.bits(8);
      cmd.components.push({
        tag,
        spliceTime: cmd.spliceImmediate ? undefined : readSpliceTime(r),
      });
    }
  }
  if (durationFlag) cmd.breakDuration = readBreakDuration(r);
  cmd.uniqueProgramId = r.bits(16);
  cmd.availNum = r.bits(8);
  cmd.availsExpected = r.bits(8);
  return cmd;
}

function formatUpid(type: number, data: Uint8Array): string {
  if (data.length === 0) return '';
  switch (type) {
    case 0x01:
    case 0x02:
    case 0x03:
    case 0x07:
    case 0x09:
    case 0x0e:
    case 0x0f:
    case 0x11:
      return ascii(data);
    case 0x08:
      return '0x' + toHex(data);
    case 0x0a: {
      // EIDR: 2-byte sub-prefix + 10-byte binary suffix.
      if (data.length === 12) {
        const prefix = (data[0] << 8) | data[1];
        const suffix = toHex(data.subarray(2)).toUpperCase().match(/.{1,4}/g)!.join('-');
        return `10.${prefix}/${suffix}`;
      }
      return '0x' + toHex(data);
    }
    case 0x10: {
      const h = toHex(data);
      return h.length === 32
        ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
        : '0x' + h;
    }
    case 0x0d: {
      // MID: a sequence of (type, length, upid) tuples.
      const parts: string[] = [];
      let i = 0;
      while (i + 2 <= data.length) {
        const t = data[i];
        const len = data[i + 1];
        parts.push(`${UPID_TYPES[t] ?? t}: ${formatUpid(t, data.subarray(i + 2, i + 2 + len))}`);
        i += 2 + len;
      }
      return parts.join(' | ');
    }
    default:
      return '0x' + toHex(data);
  }
}

function readSegmentationDescriptor(
  r: BitReader,
  identifier: string,
  end: number,
): SegmentationDescriptor {
  const d: SegmentationDescriptor = {
    tag: 0x02,
    name: 'segmentation_descriptor',
    identifier,
    segmentationEventId: r.bits(32),
    cancel: r.flag(),
  };
  r.bits(7);
  if (d.cancel) return d;
  d.programSegmentation = r.flag();
  const durationFlag = r.flag();
  d.deliveryNotRestricted = r.flag();
  if (!d.deliveryNotRestricted) {
    d.webDeliveryAllowed = r.flag();
    d.noRegionalBlackout = r.flag();
    d.archiveAllowed = r.flag();
    d.deviceRestrictions = r.bits(2);
  } else {
    r.bits(5);
  }
  if (!d.programSegmentation) {
    const count = r.bits(8);
    for (let i = 0; i < count; i++) {
      r.bits(8);
      r.bits(7);
      r.bits(33);
    }
  }
  if (durationFlag) d.segmentationDuration = r.bits(40);
  d.upidType = r.bits(8);
  d.upidTypeName = UPID_TYPES[d.upidType] ?? `Reserved (0x${d.upidType.toString(16)})`;
  const upidLength = r.bits(8);
  d.upid = formatUpid(d.upidType, r.bytes(upidLength));
  d.segmentationTypeId = r.bits(8);
  d.segmentationTypeName =
    SEGMENTATION_TYPES[d.segmentationTypeId] ?? `Reserved (0x${d.segmentationTypeId.toString(16)})`;
  d.segmentNum = r.bits(8);
  d.segmentsExpected = r.bits(8);
  if (SUB_SEGMENT_TYPES.has(d.segmentationTypeId) && end - r.offset >= 2) {
    d.subSegmentNum = r.bits(8);
    d.subSegmentsExpected = r.bits(8);
  }
  return d;
}

function readDescriptor(r: BitReader): SpliceDescriptor {
  const tag = r.bits(8);
  const length = r.bits(8);
  const start = r.offset;
  const end = start + length;
  const body = r.bytes(length);
  r.seek(start);
  const identifier = length >= 4 ? ascii(r.bytes(4)) : '';
  let result: SpliceDescriptor;
  if (tag === 0x02 && identifier === 'CUEI') {
    result = readSegmentationDescriptor(r, identifier, end);
  } else {
    const d: OtherDescriptor = {
      tag,
      name: DESCRIPTOR_NAMES[tag] ?? `private_descriptor (0x${tag.toString(16)})`,
      identifier,
      raw: toHex(body),
    };
    if (tag === 0x00 && length >= 8) d.providerAvailId = r.bits(32);
    if (tag === 0x01 && length >= 6) {
      r.bits(8); // preroll
      const count = r.bits(3);
      r.bits(5);
      d.dtmfChars = ascii(r.bytes(Math.min(count, end - r.offset)));
    }
    if (tag === 0x03 && length >= 10) d.taiSeconds = r.bits(48);
    result = d;
  }
  r.seek(end);
  return result;
}

export function parseScte35(input: string | Uint8Array | ArrayBuffer): SpliceInfoSection {
  const data = decodeScte35Input(input);
  const r = new BitReader(data);
  const tableId = r.bits(8);
  if (tableId !== 0xfc) {
    throw new Scte35Error(`Not a splice_info_section (table_id 0x${tableId.toString(16)})`);
  }
  r.bits(2); // section_syntax_indicator, private_indicator
  const sapType = r.bits(2);
  const sectionLength = r.bits(12);
  const totalLength = 3 + sectionLength;
  const protocolVersion = r.bits(8);
  const encrypted = r.flag();
  const encryptionAlgorithm = r.bits(6);
  const ptsAdjustment = r.bits(33);
  const cwIndex = r.bits(8);
  const tier = r.bits(12);
  const spliceCommandLength = r.bits(12);
  const spliceCommandType = r.bits(8);
  const spliceCommandName =
    COMMAND_NAMES[spliceCommandType] ?? `reserved (0x${spliceCommandType.toString(16)})`;

  const crcOffset = totalLength - 4;
  const crcAvailable = data.length >= totalLength;
  const crc32 = crcAvailable
    ? ((data[crcOffset] << 24) | (data[crcOffset + 1] << 16) | (data[crcOffset + 2] << 8) | data[crcOffset + 3]) >>> 0
    : 0;
  const crcValid = crcAvailable && crc32Mpeg2(data.subarray(0, crcOffset)) === crc32;

  const base = {
    tableId,
    sectionLength,
    sapType,
    protocolVersion,
    encrypted,
    encryptionAlgorithm,
    ptsAdjustment,
    cwIndex,
    tier,
    spliceCommandType,
    spliceCommandName,
    crc32,
    crcValid,
  };
  if (encrypted) {
    return { ...base, command: { type: 'unknown' }, descriptors: [] };
  }

  const commandStart = r.offset;
  let command: SpliceCommand;
  switch (spliceCommandType) {
    case 0x00:
      command = { type: 'splice_null' };
      break;
    case 0x05:
      command = readSpliceInsert(r);
      break;
    case 0x06:
      command = { type: 'time_signal', spliceTime: readSpliceTime(r) };
      break;
    case 0x04:
      command = { type: 'splice_schedule', spliceCount: r.bits(8) };
      break;
    case 0x07:
      command = { type: 'bandwidth_reservation' };
      break;
    case 0xff:
      command = { type: 'private_command', identifier: ascii(r.bytes(4)) };
      break;
    default:
      command = { type: 'unknown' };
  }
  // splice_command_length may be 0xFFF in legacy streams; otherwise trust it.
  if (spliceCommandLength !== 0xfff) r.seek(commandStart + spliceCommandLength);

  const descriptors: SpliceDescriptor[] = [];
  const loopLength = r.bits(16);
  const loopEnd = r.offset + loopLength;
  while (r.offset < loopEnd && r.offset < data.length - 4) {
    descriptors.push(readDescriptor(r));
  }

  return { ...base, command, descriptors };
}

/** PTS ticks (90 kHz) to seconds. */
export function ticksToSeconds(ticks: number): number {
  return ticks / 90000;
}

export type CueDirection = 'out' | 'in' | 'other';

/** Out/in classification of a decoded section, used for ad-break tracking. */
export function cueDirection(section: SpliceInfoSection): CueDirection {
  const cmd = section.command;
  if (cmd.type === 'splice_insert' && !cmd.cancel) return cmd.outOfNetwork ? 'out' : 'in';
  for (const d of section.descriptors) {
    if (d.tag === 0x02 && 'segmentationTypeId' in d && d.segmentationTypeId !== undefined) {
      if (OUT_SEGMENTATION_TYPES.has(d.segmentationTypeId)) return 'out';
      if (IN_SEGMENTATION_TYPES.has(d.segmentationTypeId)) return 'in';
    }
  }
  return 'other';
}

/** Duration in seconds advertised by the section, if any. */
export function cueDuration(section: SpliceInfoSection): number | undefined {
  const cmd = section.command;
  if (cmd.type === 'splice_insert' && cmd.breakDuration) {
    return ticksToSeconds(cmd.breakDuration.duration);
  }
  for (const d of section.descriptors) {
    if (d.tag === 0x02 && 'segmentationDuration' in d && d.segmentationDuration !== undefined) {
      return ticksToSeconds(d.segmentationDuration);
    }
  }
  return undefined;
}

/** One-line human readable summary, e.g. "splice_insert OUT #1 · 30.0s". */
export function summarizeScte35(section: SpliceInfoSection): string {
  const parts: string[] = [section.spliceCommandName];
  const cmd = section.command;
  if (cmd.type === 'splice_insert') {
    if (cmd.cancel) parts.push(`CANCEL #${cmd.spliceEventId}`);
    else parts.push(`${cmd.outOfNetwork ? 'OUT' : 'IN'} #${cmd.spliceEventId}`);
    if (cmd.spliceImmediate) parts.push('immediate');
  }
  for (const d of section.descriptors) {
    if (d.tag === 0x02 && 'segmentationTypeName' in d) {
      if (d.cancel) parts.push(`seg #${d.segmentationEventId} CANCEL`);
      else parts.push(`${d.segmentationTypeName} (0x${d.segmentationTypeId!.toString(16).padStart(2, '0')})`);
    }
  }
  const dur = cueDuration(section);
  if (dur !== undefined) parts.push(`${dur.toFixed(1)}s`);
  return parts.join(' · ');
}
