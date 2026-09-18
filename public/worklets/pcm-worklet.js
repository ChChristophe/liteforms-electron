/*
 * AudioWorklet processor converting the microphone stream into 16-bit PCM
 * frames of 1280 samples (80 ms @ 16 kHz) posted to the main thread.
 *
 * Adapted from the openWakeWord browser port:
 *   https://github.com/dscripka/openWakeWord/pull/339
 *   commit 1c76cd9b66400bccbed2a09fd86e70bb429dabd7 (web/src/mic-worklet.js)
 * Original code licensed Apache-2.0 — see bundles/wakeword/LICENSE.
 * Modifications: served as a static asset from /worklets/ instead of the
 * package source tree; no functional change.
 */

/* eslint-disable no-var */
const TARGET_RATE = 16000;
const FRAME = 1280;

class PCMWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ratio = sampleRate / TARGET_RATE; // input samples per output sample
    this._buf = new Int16Array(FRAME);
    this._n = 0;
    this._tail = new Float32Array(0); // leftover input samples between blocks
    this._frac = 0; // fractional read position within the current data buffer
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    // Prepend any leftover samples needed for cross-block interpolation.
    let data = channel;
    if (this._tail.length) {
      data = new Float32Array(this._tail.length + channel.length);
      data.set(this._tail, 0);
      data.set(channel, this._tail.length);
    }

    const ratio = this._ratio;
    let t = this._frac;
    while (Math.floor(t) + 1 < data.length) {
      const i = Math.floor(t);
      const frac = t - i;
      const s = data[i] + (data[i + 1] - data[i]) * frac; // linear interp
      let v = Math.floor(32767 * s);
      if (v > 32767) v = 32767;
      else if (v < -32768) v = -32768;
      this._buf[this._n++] = v;
      if (this._n === FRAME) {
        this.port.postMessage(this._buf.slice());
        this._n = 0;
      }
      t += ratio;
    }

    const keepFrom = Math.floor(t);
    this._tail = data.slice(keepFrom);
    this._frac = t - keepFrom;
    return true;
  }
}

registerProcessor("pcm-worklet", PCMWorklet);
