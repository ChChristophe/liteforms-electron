import { describe, expect, it } from "vitest";
import {
  TIMER_CHIME_DURATION_SECONDS,
  TIMER_CHIME_SAMPLE_RATE,
  TIMER_CHIME_TONES,
  encodeTimerChimeWav,
  playTimerChime,
  renderTimerChimeSamples
} from "./timerChime";

// Reference values computed independently from the web reference formula.
// (Indices deliberately avoid the periodic zero crossings of the sine terms.)
const expectedSamples: Record<number, number> = {
  0: 0, // t = 0 → sin(0) = 0
  5000: -0.36175451976026474, // first tone only
  13231: 0.09376429641140845, // first + second tone overlap
  30000: -0.061232655571242266, // third tone only
  35281: 0.009343833033525368, // third tone only
  40000: 0 // t > 0.9 → silence
};

describe("timer chime synthesis", () => {
  it("renders exactly one second at 44100 Hz", () => {
    const samples = renderTimerChimeSamples();
    expect(samples).toHaveLength(Math.floor(TIMER_CHIME_SAMPLE_RATE * TIMER_CHIME_DURATION_SECONDS));
    expect(samples).toHaveLength(44100);
  });

  it("keeps the reference tone table (880/1100/1320 Hz, overlapping)", () => {
    expect(TIMER_CHIME_TONES).toEqual([
      { freq: 880, start: 0, dur: 0.35 },
      { freq: 1100, start: 0.25, dur: 0.35 },
      { freq: 1320, start: 0.5, dur: 0.4 }
    ]);
  });

  it("applies the 0.8 × fade² × sin(2πft) envelope", () => {
    const samples = renderTimerChimeSamples();
    for (const [index, expected] of Object.entries(expectedSamples)) {
      // Float32Array storage rounds the double-precision sum; 1e-6 is well
      // inside float32 noise while still catching any envelope/tone mistake.
      expect(samples[Number(index)]).toBeCloseTo(expected, 6);
    }
  });

  it("wraps the samples in a valid 16-bit mono PCM WAV container", () => {
    const wav = encodeTimerChimeWav();
    const view = new DataView(wav);
    const ascii = (offset: number, length: number) =>
      Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join("");

    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(12, 4)).toBe("fmt ");
    expect(ascii(36, 4)).toBe("data");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(TIMER_CHIME_SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(view.getUint32(40, true)).toBe(44100 * 2);
    expect(wav.byteLength).toBe(44 + 44100 * 2);

    const samples = renderTimerChimeSamples();
    for (const index of [0, 5000, 13231, 35281, 40000]) {
      const clamped = Math.max(-1, Math.min(1, samples[index]));
      expect(view.getInt16(44 + index * 2, true)).toBe(Math.trunc(clamped * 0x7fff));
    }
  });

  it("never throws when audio playback is unavailable", () => {
    expect(() => playTimerChime()).not.toThrow();
  });
});
