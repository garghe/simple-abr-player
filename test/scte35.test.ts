import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS helper shared with the sample generator
import { encodeScte35, toBase64, toHex } from '../scripts/lib/scte35-encode.mjs';
import {
  crc32Mpeg2,
  cueDirection,
  cueDuration,
  parseScte35,
  summarizeScte35,
  type SegmentationDescriptor,
  type SpliceInsert,
} from '../src/scte/scte35';

describe('parseScte35 — published samples', () => {
  it('decodes a time_signal with a Placement Opportunity Start descriptor', () => {
    const s = parseScte35('/DA0AAAAAAAA///wBQb+cr0AUAAeAhxDVUVJSAAAjn/PAAGlmbAICAAAAAAsoKGKNAIAmsnRfg==');
    expect(s.crcValid).toBe(true);
    expect(s.spliceCommandName).toBe('time_signal');
    expect(s.command).toEqual({ type: 'time_signal', spliceTime: { timeSpecified: true, ptsTime: 0x072bd0050 } });
    const d = s.descriptors[0] as SegmentationDescriptor;
    expect(d.identifier).toBe('CUEI');
    expect(d.segmentationEventId).toBe(0x4800008e);
    expect(d.segmentationTypeId).toBe(0x34);
    expect(d.segmentationTypeName).toBe('Provider Placement Opportunity Start');
    expect(d.segmentationDuration).toBe(0x0001a599b0);
    expect(d.upidTypeName).toBe('TI (AiringID)');
    expect(d.upid).toBe('0x000000002ca0a18a');
    expect(d.segmentNum).toBe(2);
    expect(cueDirection(s)).toBe('out');
    expect(cueDuration(s)).toBeCloseTo(307, 0);
  });

  it('decodes a splice_insert with break_duration and avail descriptor', () => {
    const s = parseScte35('/DAvAAAAAAAA///wFAVIAACPf+/+c2nALv4AUsz1AAAAAAAKAAhDVUVJAAABNWLbowo=');
    expect(s.crcValid).toBe(true);
    const cmd = s.command as SpliceInsert;
    expect(cmd.type).toBe('splice_insert');
    expect(cmd.spliceEventId).toBe(0x4800008f);
    expect(cmd.outOfNetwork).toBe(true);
    expect(cmd.programSplice).toBe(true);
    expect(cmd.spliceTime?.ptsTime).toBe(0x07369c02e);
    expect(cmd.breakDuration).toEqual({ autoReturn: true, duration: 0x00052ccf5 });
    expect(s.descriptors[0]).toMatchObject({ name: 'avail_descriptor', providerAvailId: 0x135 });
    expect(summarizeScte35(s)).toContain('OUT #1207959695');
  });

  it('accepts hex input and flags a bad CRC', () => {
    const bytes = encodeScte35({ command: 'time_signal', pts: 10 });
    const hex = toHex(bytes);
    expect(parseScte35(hex).crcValid).toBe(true);
    bytes[bytes.length - 1] ^= 0xff;
    expect(parseScte35(bytes).crcValid).toBe(false);
  });

  it('rejects data that is not a splice_info_section', () => {
    expect(() => parseScte35('AAAA')).toThrow(/table_id/);
  });
});

describe('parseScte35 — round trip with the sample encoder', () => {
  it('splice_insert out with duration', () => {
    const b64 = toBase64(
      encodeScte35({ command: 'splice_insert', pts: 6, insert: { eventId: 1001, out: true, duration: 8 } }),
    );
    const s = parseScte35(b64);
    expect(s.crcValid).toBe(true);
    expect(cueDirection(s)).toBe('out');
    expect(cueDuration(s)).toBe(8);
    expect((s.command as SpliceInsert).spliceTime?.ptsTime).toBe(6 * 90000);
  });

  it('splice_insert in (immediate)', () => {
    const s = parseScte35(encodeScte35({ command: 'splice_insert', insert: { eventId: 1002, out: false } }));
    expect(cueDirection(s)).toBe('in');
    expect((s.command as SpliceInsert).spliceImmediate).toBe(true);
  });

  it('time_signal with Ad-ID UPID', () => {
    const s = parseScte35(
      encodeScte35({
        command: 'time_signal',
        pts: 20,
        segmentation: { eventId: 7, typeId: 0x30, duration: 15, upidType: 0x03, upid: 'ABCD0123456H' },
      }),
    );
    const d = s.descriptors[0] as SegmentationDescriptor;
    expect(d.upidTypeName).toBe('Ad-ID');
    expect(d.upid).toBe('ABCD0123456H');
    expect(d.segmentationTypeName).toBe('Provider Advertisement Start');
    expect(cueDuration(s)).toBe(15);
  });
});

describe('crc32Mpeg2', () => {
  it('matches the CRC-32/MPEG-2 check value', () => {
    expect(crc32Mpeg2(new TextEncoder().encode('123456789'))).toBe(0x0376e6e7);
  });
});
