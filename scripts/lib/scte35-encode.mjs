// Minimal SCTE-35 splice_info_section encoder used to build the bundled
// sample stream and the unit tests. Supports splice_insert and time_signal
// with an optional segmentation_descriptor.

class BitWriter {
  constructor() {
    this.bits = [];
  }
  write(value, n) {
    for (let i = n - 1; i >= 0; i--) {
      this.bits.push(Math.floor(value / 2 ** i) % 2);
    }
  }
  bytes(arr) {
    for (const b of arr) this.write(b, 8);
  }
  toBytes() {
    const out = new Uint8Array(this.bits.length / 8);
    for (let i = 0; i < out.length; i++) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | this.bits[i * 8 + j];
      out[i] = v;
    }
    return out;
  }
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte << 24;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
    }
    crc >>>= 0;
  }
  return crc >>> 0;
}

function spliceTime(w, pts) {
  if (pts === undefined) {
    w.write(0, 1);
    w.write(0x7f, 7);
  } else {
    w.write(1, 1);
    w.write(0x3f, 6);
    w.write(pts, 33);
  }
}

function spliceInsert({ eventId, out, pts, duration, autoReturn = true, availNum = 0, availsExpected = 0 }) {
  const w = new BitWriter();
  w.write(eventId, 32);
  w.write(0, 1); // cancel
  w.write(0x7f, 7);
  w.write(out ? 1 : 0, 1);
  w.write(1, 1); // program_splice_flag
  w.write(duration !== undefined ? 1 : 0, 1);
  w.write(pts === undefined ? 1 : 0, 1); // splice_immediate_flag
  w.write(1, 1); // event_id_compliance_flag
  w.write(0x7, 3);
  if (pts !== undefined) spliceTime(w, pts);
  if (duration !== undefined) {
    w.write(autoReturn ? 1 : 0, 1);
    w.write(0x3f, 6);
    w.write(Math.round(duration * 90000), 33);
  }
  w.write(1, 16); // unique_program_id
  w.write(availNum, 8);
  w.write(availsExpected, 8);
  return w.toBytes();
}

function segmentationDescriptor({ eventId, typeId, duration, upidType = 0x0f, upid = '', segmentNum = 1, segmentsExpected = 1 }) {
  const w = new BitWriter();
  w.bytes([0x43, 0x55, 0x45, 0x49]); // "CUEI"
  w.write(eventId, 32);
  w.write(0, 1); // cancel
  w.write(0x7f, 7);
  w.write(1, 1); // program_segmentation_flag
  w.write(duration !== undefined ? 1 : 0, 1);
  w.write(1, 1); // delivery_not_restricted_flag
  w.write(0x1f, 5);
  if (duration !== undefined) w.write(Math.round(duration * 90000), 40);
  const upidBytes = new TextEncoder().encode(upid);
  w.write(upidType, 8);
  w.write(upidBytes.length, 8);
  w.bytes(upidBytes);
  w.write(typeId, 8);
  w.write(segmentNum, 8);
  w.write(segmentsExpected, 8);
  if ([0x34, 0x36, 0x38, 0x3a, 0x44, 0x46].includes(typeId)) {
    w.write(0, 8);
    w.write(0, 8);
  }
  const body = w.toBytes();
  return Uint8Array.from([0x02, body.length, ...body]);
}

/**
 * @param {{command: 'splice_insert'|'time_signal', pts?: number, insert?: object, segmentation?: object}} opts
 *   pts is in seconds; durations are in seconds.
 */
export function encodeScte35(opts) {
  const ptsTicks = opts.pts === undefined ? undefined : Math.round(opts.pts * 90000);
  let commandType;
  let command;
  if (opts.command === 'splice_insert') {
    commandType = 0x05;
    command = spliceInsert({ ...opts.insert, pts: ptsTicks });
  } else {
    commandType = 0x06;
    const w = new BitWriter();
    spliceTime(w, ptsTicks);
    command = w.toBytes();
  }
  const descriptors = opts.segmentation ? segmentationDescriptor(opts.segmentation) : new Uint8Array();

  const w = new BitWriter();
  w.write(0, 8); // protocol_version
  w.write(0, 1); // encrypted_packet
  w.write(0, 6); // encryption_algorithm
  w.write(0, 33); // pts_adjustment
  w.write(0, 8); // cw_index
  w.write(0xfff, 12); // tier
  w.write(command.length, 12);
  w.write(commandType, 8);
  w.bytes(command);
  w.write(descriptors.length, 16);
  w.bytes(descriptors);
  const body = w.toBytes();

  const sectionLength = body.length + 4;
  const header = new BitWriter();
  header.write(0xfc, 8);
  header.write(0, 1); // section_syntax_indicator
  header.write(0, 1); // private_indicator
  header.write(3, 2); // sap_type: not specified
  header.write(sectionLength, 12);
  const withoutCrc = Uint8Array.from([...header.toBytes(), ...body]);
  const crc = crc32(withoutCrc);
  return Uint8Array.from([...withoutCrc, crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff]);
}

export const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');
export const toHex = (bytes) => '0x' + Buffer.from(bytes).toString('hex').toUpperCase();
