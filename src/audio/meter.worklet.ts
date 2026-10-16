/**
 * AudioWorklet processor: measures the decoded audio on the audio thread and
 * posts one SubBlock every 100 ms to the page (see engine.ts).
 */
import { MeterCore } from './dsp';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class LevelMeterProcessor extends AudioWorkletProcessor {
  private core = new MeterCore(sampleRate);

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (input && input.length) {
      for (const block of this.core.process(input)) this.port.postMessage(block);
    }
    return true;
  }
}

registerProcessor('level-meter', LevelMeterProcessor);
