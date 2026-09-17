/**
 * Timer alert chime, extracted from the web reference's ChatPanel so the
 * synthesis is pure and testable. The tone table and envelope are kept
 * verbatim: three ascending tones (880 / 1100 / 1320 Hz) with a quadratic
 * fade, rendered to a 16-bit mono PCM WAV and played through an
 * HTMLAudioElement (the same playback mechanism the web reference and the
 * local `playAudioBlob` helper use).
 */

export const TIMER_CHIME_SAMPLE_RATE = 44100;
export const TIMER_CHIME_DURATION_SECONDS = 1.0;

/** Ascending tone table: `dur` overlaps so tones ring into each other. */
export const TIMER_CHIME_TONES = [
  { freq: 880, start: 0, dur: 0.35 },
  { freq: 1100, start: 0.25, dur: 0.35 },
  { freq: 1320, start: 0.5, dur: 0.4 }
] as const;

/**
 * Pure synthesis: the mono float samples of the chime. Each active tone adds
 * `0.8 × fade² × sin(2πft)` where `fade` decreases linearly across the tone.
 */
export function renderTimerChimeSamples(sampleRate = TIMER_CHIME_SAMPLE_RATE): Float32Array {
  const numSamples = Math.floor(sampleRate * TIMER_CHIME_DURATION_SECONDS);
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;
    for (const tone of TIMER_CHIME_TONES) {
      if (t >= tone.start && t < tone.start + tone.dur) {
        const elapsed = t - tone.start;
        const fade = 1 - elapsed / tone.dur;
        sample += 0.8 * fade * fade * Math.sin(2 * Math.PI * tone.freq * t);
      }
    }
    samples[i] = sample;
  }
  return samples;
}

/** Pure container step: wraps the samples in a 16-bit mono PCM WAV buffer. */
export function encodeTimerChimeWav(sampleRate = TIMER_CHIME_SAMPLE_RATE): ArrayBuffer {
  const samples = renderTimerChimeSamples(sampleRate);
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, clamped * 0x7fff, true);
  }
  return buffer;
}

/** Plays the chime; never throws (audio failure is silent, as in the reference). */
export function playTimerChime(): void {
  try {
    const blob = new Blob([encodeTimerChimeWav()], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    audio.onerror = () => URL.revokeObjectURL(url);
    void audio.play();
  } catch {
    // Silently skip if audio fails.
  }
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}
