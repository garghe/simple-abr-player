import {
  dashEventStream,
  encodeScte35,
  hlsTags,
  ticks,
  toBase64,
  toHexString,
  type CommandSpec,
  type SectionSpec,
  type SegmentationSpec,
} from '../../scte/encode';
import { SEGMENTATION_TYPES, UPID_TYPES, cueDirection, parseScte35, summarizeScte35 } from '../../scte/scte35';
import { badge, h } from '../dom';

type Field = HTMLInputElement | HTMLSelectElement;

interface DescriptorForm {
  eventId: string;
  typeId: string;
  duration: string;
  upidType: string;
  upid: string;
  segmentNum: string;
  segmentsExpected: string;
  subSegmentNum: string;
  subSegmentsExpected: string;
  cancel: boolean;
  restricted: boolean;
  webDeliveryAllowed: boolean;
  noRegionalBlackout: boolean;
  archiveAllowed: boolean;
}

export interface BuilderForm {
  command: 'splice_insert' | 'time_signal' | 'splice_null';
  eventId: string;
  direction: 'out' | 'in';
  cancel: boolean;
  immediate: boolean;
  spliceTime: string;
  duration: string;
  autoReturn: boolean;
  uniqueProgramId: string;
  availNum: string;
  availsExpected: string;
  ptsAdjustment: string;
  /** HLS DATERANGE ID / DASH Event id. */
  tagId: string;
  /** DASH Event presentationTime, seconds. */
  presentationTime: string;
  descriptors: DescriptorForm[];
}

const SUB_TYPES = new Set([0x34, 0x36, 0x38, 0x3a, 0x44, 0x46]);

const descriptor = (o: Partial<DescriptorForm> = {}): DescriptorForm => ({
  eventId: '1',
  typeId: '52',
  duration: '30',
  upidType: '9',
  upid: '',
  segmentNum: '0',
  segmentsExpected: '0',
  subSegmentNum: '0',
  subSegmentsExpected: '0',
  cancel: false,
  restricted: false,
  webDeliveryAllowed: true,
  noRegionalBlackout: true,
  archiveAllowed: true,
  ...o,
});

const BASE: BuilderForm = {
  command: 'splice_insert',
  eventId: '1',
  direction: 'out',
  cancel: false,
  immediate: false,
  spliceTime: '10',
  duration: '30',
  autoReturn: true,
  uniqueProgramId: '1',
  availNum: '0',
  availsExpected: '0',
  ptsAdjustment: '0',
  tagId: 'ad-1',
  presentationTime: '10',
  descriptors: [],
};

const PRESETS: [string, Partial<BuilderForm>][] = [
  ['Ad break OUT — splice_insert, 30 s', {}],
  ['Ad break IN — splice_insert', { direction: 'in', duration: '' }],
  ['Placement opportunity start — time_signal 0x34, 30 s', { command: 'time_signal', descriptors: [descriptor({ upid: 'SIGNAL:demo-po-1' })] }],
  ['Placement opportunity end — time_signal 0x35', { command: 'time_signal', descriptors: [descriptor({ typeId: '53', duration: '', upid: 'SIGNAL:demo-po-1' })] }],
  ['Break start — time_signal 0x22 + provider ad 0x30', { command: 'time_signal', descriptors: [descriptor({ typeId: '34', duration: '60' }), descriptor({ eventId: '2', typeId: '48', duration: '30', upidType: '3', upid: 'ABCD0123456H' })] }],
  ['Programme start — time_signal 0x10 with EIDR', { command: 'time_signal', descriptors: [descriptor({ typeId: '16', duration: '', upidType: '10', upid: '0x14780123456789ABCDEF0123' })] }],
  ['Splice null (heartbeat)', { command: 'splice_null' }],
];

/** Parses a number field: '' → undefined, otherwise a finite number or an error. */
function num(label: string, v: string, opts: { int?: boolean; min?: number; max?: number } = {}): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || (opts.int && !Number.isInteger(n)) || (opts.min !== undefined && n < opts.min) || (opts.max !== undefined && n > opts.max)) {
    throw new Error(`${label}: "${v}" is not valid`);
  }
  return n;
}
const int = (label: string, v: string, max = 2 ** 32 - 1) => num(label, v, { int: true, min: 0, max }) ?? 0;

/** Turns the form into an encoder spec. */
export function formToSpec(f: BuilderForm): SectionSpec {
  let command: CommandSpec;
  const time = num('Splice time', f.spliceTime, { min: 0 });
  if (f.command === 'splice_insert') {
    const duration = num('Duration', f.duration, { min: 0 });
    command = {
      type: 'splice_insert',
      eventId: int('Event ID', f.eventId),
      cancel: f.cancel,
      outOfNetwork: f.direction === 'out',
      immediate: f.immediate,
      pts: time !== undefined ? ticks(time) : 0,
      duration: duration !== undefined ? ticks(duration) : undefined,
      autoReturn: f.autoReturn,
      uniqueProgramId: int('Unique program ID', f.uniqueProgramId, 0xffff),
      availNum: int('Avail num', f.availNum, 255),
      availsExpected: int('Avails expected', f.availsExpected, 255),
    };
  } else if (f.command === 'time_signal') {
    command = { type: 'time_signal', pts: time !== undefined ? ticks(time) : undefined };
  } else {
    command = { type: 'splice_null' };
  }
  const descriptors: SegmentationSpec[] = f.descriptors.map((d, i) => {
    const n = `Descriptor ${i + 1}`;
    const duration = num(`${n} duration`, d.duration, { min: 0 });
    return {
      eventId: int(`${n} event ID`, d.eventId),
      cancel: d.cancel,
      typeId: int(`${n} type`, d.typeId, 255),
      duration: duration !== undefined ? ticks(duration) : undefined,
      upidType: int(`${n} UPID type`, d.upidType, 255),
      upid: d.upid,
      segmentNum: int(`${n} segment_num`, d.segmentNum, 255),
      segmentsExpected: int(`${n} segments_expected`, d.segmentsExpected, 255),
      subSegmentNum: int(`${n} sub_segment_num`, d.subSegmentNum, 255),
      subSegmentsExpected: int(`${n} sub_segments_expected`, d.subSegmentsExpected, 255),
      restricted: d.restricted,
      webDeliveryAllowed: d.webDeliveryAllowed,
      noRegionalBlackout: d.noRegionalBlackout,
      archiveAllowed: d.archiveAllowed,
    };
  });
  return { command, descriptors, ptsAdjustment: ticks(num('pts_adjustment', f.ptsAdjustment, { min: 0 }) ?? 0) };
}

/**
 * Builder sub-view: compose a splice_insert / time_signal with segmentation
 * descriptors and copy it as base64, hex, HLS tags or a DASH EventStream.
 */
export class BuilderView {
  readonly el = h('div', { class: 'scte-builder' });
  private form: BuilderForm = structuredClone(BASE);
  private fields = h('div', { class: 'builder-fields' });
  private out = h('div', { class: 'builder-out' });

  constructor(private readonly toast: (msg: string) => void) {
    const preset = h('select', { 'aria-label': 'Start from a preset' }, h('option', { value: '' }, 'Start from a preset…'), PRESETS.map(([name], i) => h('option', { value: String(i) }, name)));
    preset.addEventListener('change', () => {
      const p = PRESETS[Number(preset.value)];
      if (p) this.form = { ...structuredClone(BASE), ...structuredClone(p[1]) };
      preset.value = '';
      this.build();
    });
    this.el.append(
      h('div', { class: 'toolbar' }, preset, h('button', { type: 'button', onclick: () => ((this.form = structuredClone(BASE)), this.build()) }, 'Reset')),
      this.fields,
      this.out,
    );
    this.build();
  }

  render() {
    /* static form: nothing to refresh on ticks */
  }

  private input(obj: object, key: string, attrs: Record<string, unknown> = {}, rebuild = false): Field {
    const o = obj as Record<string, unknown>;
    const isBool = typeof o[key] === 'boolean';
    const el = h('input', { type: isBool ? 'checkbox' : 'text', ...attrs }) as HTMLInputElement;
    if (isBool) el.checked = Boolean(o[key]);
    else el.value = String(o[key] ?? '');
    el.addEventListener(isBool ? 'change' : 'input', () => {
      o[key] = isBool ? el.checked : el.value;
      if (rebuild) this.build();
      else this.update();
    });
    return el;
  }

  private select(obj: object, key: string, options: [string, string][], label: string, rebuild = false): HTMLSelectElement {
    const o = obj as Record<string, unknown>;
    const el = h('select', { 'aria-label': label }, options.map(([v, t]) => h('option', { value: v, selected: String(o[key]) === v }, t)));
    el.addEventListener('change', () => {
      o[key] = el.value;
      if (rebuild) this.build();
      else this.update();
    });
    return el;
  }

  private build() {
    const f = this.form;
    const field = (label: string, control: HTMLElement, hint?: string) => h('label', { class: 'bfield' }, h('span', null, label, hint ? h('small', { class: 'muted' }, ` ${hint}`) : ''), control);
    const check = (label: string, control: HTMLElement) => h('label', { class: 'bcheck' }, control, ` ${label}`);

    const common = [
      field('Command', this.select(f, 'command', [['splice_insert', 'splice_insert'], ['time_signal', 'time_signal'], ['splice_null', 'splice_null']], 'Command', true)),
      field('pts_adjustment', this.input(f, 'ptsAdjustment', { inputmode: 'decimal' }), 's'),
    ];
    const insert =
      f.command === 'splice_insert'
        ? [
            field('splice_event_id', this.input(f, 'eventId', { inputmode: 'numeric' })),
            field('Direction', this.select(f, 'direction', [['out', 'OUT (to the break)'], ['in', 'IN (back to programme)']], 'Direction')),
            field('Splice time', this.input(f, 'spliceTime', { inputmode: 'decimal', disabled: f.immediate }), 's (PTS)'),
            field('Break duration', this.input(f, 'duration', { inputmode: 'decimal', placeholder: 'none' }), 's'),
            field('unique_program_id', this.input(f, 'uniqueProgramId', { inputmode: 'numeric' })),
            field('avail_num / expected', h('span', { class: 'pair' }, this.input(f, 'availNum', { inputmode: 'numeric' }), this.input(f, 'availsExpected', { inputmode: 'numeric' }))),
            h('div', { class: 'bchecks' }, check('splice_immediate', this.input(f, 'immediate', {}, true)), check('auto_return', this.input(f, 'autoReturn')), check('cancel', this.input(f, 'cancel'))),
          ]
        : f.command === 'time_signal'
          ? [field('Splice time', this.input(f, 'spliceTime', { inputmode: 'decimal', placeholder: 'not specified' }), 's (PTS)')]
          : [];

    const typeOptions = Object.entries(SEGMENTATION_TYPES).map(([v, n]) => [String(Number(v)), `0x${Number(v).toString(16).padStart(2, '0')} ${n}`] as [string, string]);
    const upidOptions = Object.entries(UPID_TYPES).map(([v, n]) => [String(Number(v)), `0x${Number(v).toString(16).padStart(2, '0')} ${n}`] as [string, string]);
    const descriptors = f.descriptors.map((d, i) =>
      h(
        'fieldset',
        { class: 'bdesc' },
        h('legend', null, `segmentation_descriptor ${i + 1} `, h('button', { type: 'button', class: 'linklike', onclick: () => (f.descriptors.splice(i, 1), this.build()) }, 'remove')),
        field('segmentation_event_id', this.input(d, 'eventId', { inputmode: 'numeric' })),
        field('Type', this.select(d, 'typeId', typeOptions, 'Segmentation type', true)),
        field('Duration', this.input(d, 'duration', { inputmode: 'decimal', placeholder: 'none' }), 's'),
        field('UPID type', this.select(d, 'upidType', upidOptions, 'UPID type')),
        field('UPID', this.input(d, 'upid', { placeholder: 'text, or 0x… hex', spellcheck: false })),
        field('segment_num / expected', h('span', { class: 'pair' }, this.input(d, 'segmentNum', { inputmode: 'numeric' }), this.input(d, 'segmentsExpected', { inputmode: 'numeric' }))),
        SUB_TYPES.has(Number(d.typeId))
          ? field('sub_segment_num / expected', h('span', { class: 'pair' }, this.input(d, 'subSegmentNum', { inputmode: 'numeric' }), this.input(d, 'subSegmentsExpected', { inputmode: 'numeric' })))
          : '',
        h(
          'div',
          { class: 'bchecks' },
          check('cancel', this.input(d, 'cancel')),
          check('delivery restricted', this.input(d, 'restricted', {}, true)),
          ...(d.restricted
            ? [check('web delivery allowed', this.input(d, 'webDeliveryAllowed')), check('no regional blackout', this.input(d, 'noRegionalBlackout')), check('archive allowed', this.input(d, 'archiveAllowed'))]
            : []),
        ),
      ),
    );

    this.fields.replaceChildren(
      h('div', { class: 'bgrid' }, ...common, ...insert),
      ...descriptors,
      h('button', { type: 'button', onclick: () => (f.descriptors.push(descriptor({ eventId: String(f.descriptors.length + 1) })), this.build()) }, '+ Segmentation descriptor'),
      h('div', { class: 'bgrid tags' }, field('DATERANGE / Event ID', this.input(f, 'tagId', { spellcheck: false })), field('DASH presentationTime', this.input(f, 'presentationTime', { inputmode: 'decimal' }), 's')),
    );
    this.update();
  }

  private update() {
    const f = this.form;
    let bytes: Uint8Array;
    try {
      bytes = encodeScte35(formToSpec(f));
    } catch (err) {
      this.out.replaceChildren(h('p', { class: 'error' }, err instanceof Error ? err.message : String(err)));
      return;
    }
    const section = parseScte35(bytes);
    const direction = cueDirection(section);
    const firstDur = f.command === 'splice_insert' ? f.duration : f.descriptors.find((d) => d.duration.trim())?.duration;
    const duration = firstDur && Number.isFinite(Number(firstDur)) ? Number(firstDur) : undefined;
    const copy = (label: string, text: string) =>
      h(
        'div',
        { class: 'bout' },
        h('div', { class: 'bout-head' }, h('strong', null, label), h('button', { type: 'button', onclick: () => this.copy(text, label) }, 'Copy')),
        h('pre', { class: 'code' }, text),
      );
    const presentation = Number(f.presentationTime);
    this.out.replaceChildren(
      h('p', null, badge(section.crcValid ? 'decodes · CRC OK' : 'CRC mismatch', section.crcValid ? 'ok' : 'warn'), ' ', summarizeScte35(section), ` · ${bytes.length} bytes`),
      copy('Base64', toBase64(bytes)),
      copy('Hex', toHexString(bytes)),
      copy('HLS tags (use one)', hlsTags(bytes, { direction, duration, id: f.tagId || 'ad-1', startDate: new Date() }).join('\n')),
      copy('DASH EventStream', dashEventStream(bytes, { presentationTime: Number.isFinite(presentation) ? presentation : 0, duration, id: f.tagId || '1' })),
    );
  }

  private copy(text: string, label: string) {
    navigator.clipboard?.writeText(text).then(
      () => this.toast(`${label} copied`),
      () => this.toast('Copy failed: select the text instead'),
    );
  }
}
