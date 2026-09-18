/**
 * Adapted from the openWakeWord browser port:
 *   https://github.com/dscripka/openWakeWord/pull/339
 *   commit 1c76cd9b66400bccbed2a09fd86e70bb429dabd7 (web/src/audio-features.js)
 * Original code licensed Apache-2.0 — see ../LICENSE.
 *
 * Modifications for Liteforms:
 *   - TypeScript strict port of the original JavaScript implementation.
 *   - The ONNX Runtime Web module is injected by the caller instead of being
 *     imported at the top level, keeping every module that transitively loads
 *     this file free of browser-only side effects during Next.js SSR and
 *     making the pipeline unit-testable with mocked sessions/tensors.
 *
 * The algorithm itself is kept faithful to the upstream port, which mirrors
 * `openwakeword.utils.AudioFeatures` from the Python package:
 *
 *   raw int16 audio -> melspectrogram.onnx -> (frames x 32) mel features
 *                   -> embedding_model.onnx -> (frames x 96) embeddings
 */

import type { InferenceSession } from "onnxruntime-web";

export const MEL_BINS = 32;
export const EMBED_DIM = 96;
export const WINDOW_SIZE = 76; // mel frames per embedding window
export const STEP_SIZE = 8; // mel frames produced per 1280-sample (80 ms) chunk
export const CHUNK = 1280; // samples per processing step (80 ms @ 16 kHz)

/** Minimal structural view of an ONNX tensor (compatible with ort.Tensor). */
export interface FeatureTensorLike {
  readonly data: ArrayLike<number>;
  readonly dims: readonly number[];
}

/** The subset of the onnxruntime-web module used by the feature pipeline. */
export type OrtModule = typeof import("onnxruntime-web");

/** Tensor-ready features: a flat Float32Array plus its dimensions. */
export interface Features {
  data: Float32Array;
  dims: [number, number, number];
}

export interface AudioFeaturesOptions {
  sampleRate?: number;
}

export class AudioFeatures {
  private readonly sampleRate: number;
  private readonly melspecInputName: string;
  private readonly embeddingInputName: string;
  private readonly melspecOutputName: string;
  private readonly embeddingOutputName: string;
  private readonly rawDataMaxLen: number;
  private readonly melspectrogramMaxLen: number;
  private readonly featureBufferMaxLen: number;

  private rawDataBuffer: number[] = [];
  private rawDataRemainder: Int16Array = new Int16Array(0);
  private accumulatedSamples = 0;
  private melBuffer: Float32Array[] = [];
  private featureBuffer: Float32Array[] = [];

  constructor(
    private readonly ort: OrtModule,
    private readonly melspecSession: InferenceSession,
    private readonly embeddingSession: InferenceSession,
    opts: AudioFeaturesOptions = {},
  ) {
    this.sampleRate = opts.sampleRate ?? 16000;
    this.melspecInputName = melspecSession.inputNames[0] ?? "";
    this.embeddingInputName = embeddingSession.inputNames[0] ?? "";
    this.melspecOutputName = melspecSession.outputNames[0] ?? "";
    this.embeddingOutputName = embeddingSession.outputNames[0] ?? "";

    this.rawDataMaxLen = this.sampleRate * 10;
    this.melspectrogramMaxLen = 10 * 97; // ~10 s of mel frames
    this.featureBufferMaxLen = 120; // ~10 s of embedding history

    this.reset(/* skipWarmup */ true);
  }

  /** Reset all internal streaming buffers. Call `warmup()` afterwards. */
  reset(skipWarmup = false): void {
    void skipWarmup; // parity with the upstream signature; callers must await warmup()
    this.rawDataBuffer = [];
    this.rawDataRemainder = new Int16Array(0);
    this.accumulatedSamples = 0;
    // Mel buffer seeded with ones, matching np.ones((76, 32)).
    this.melBuffer = [];
    for (let i = 0; i < WINDOW_SIZE; i++) {
      this.melBuffer.push(new Float32Array(MEL_BINS).fill(1));
    }
    this.featureBuffer = [];
  }

  /**
   * Seed the feature buffer with embeddings of ~4 s of random audio, exactly
   * like the Python implementation on init/reset. Await once after
   * construction and after each reset().
   */
  async warmup(): Promise<void> {
    const audio = new Int16Array(this.sampleRate * 4);
    for (let i = 0; i < audio.length; i++) {
      audio[i] = Math.floor(Math.random() * 2000 - 1000);
    }
    this.featureBuffer = await this.getEmbeddings(audio);
  }

  /**
   * Compute the melspectrogram of int16 audio.
   * Returns rows shaped (frames, 32) with the `x / 10 + 2` transform applied.
   */
  private async getMelspectrogram(int16: Int16Array): Promise<Float32Array[]> {
    const x = Float32Array.from(int16); // int16 magnitudes as float (NOT normalized)
    const tensor = new this.ort.Tensor("float32", x, [1, x.length]);
    const out = await this.melspecSession.run({ [this.melspecInputName]: tensor });
    const output = out[this.melspecOutputName] as unknown as FeatureTensorLike;
    const dims = output.dims;
    const bins = dims[dims.length - 1] ?? 0;
    const frames = dims[dims.length - 2] ?? 0;
    const data = output.data;
    const rows: Float32Array[] = [];
    for (let f = 0; f < frames; f++) {
      const row = new Float32Array(bins);
      const base = f * bins;
      for (let b = 0; b < bins; b++) {
        row[b] = data[base + b] / 10 + 2;
      }
      rows.push(row);
    }
    return rows;
  }

  /**
   * Run the embedding model over a batch of 76x32 mel windows.
   * Returns one 96-dim embedding row per window.
   */
  private async embedWindows(windows: Float32Array[][]): Promise<Float32Array[]> {
    const n = windows.length;
    if (n === 0) return [];
    const data = new Float32Array(n * WINDOW_SIZE * MEL_BINS);
    let p = 0;
    for (const win of windows) {
      for (let r = 0; r < WINDOW_SIZE; r++) {
        data.set(win[r] ?? new Float32Array(MEL_BINS), p);
        p += MEL_BINS;
      }
    }
    const tensor = new this.ort.Tensor("float32", data, [n, WINDOW_SIZE, MEL_BINS, 1]);
    const out = await this.embeddingSession.run({ [this.embeddingInputName]: tensor });
    const output = out[this.embeddingOutputName] as unknown as FeatureTensorLike;
    const flat = output.data as Float32Array; // contiguous n * EMBED_DIM values
    const rows: Float32Array[] = [];
    for (let i = 0; i < n; i++) {
      rows.push(flat.slice(i * EMBED_DIM, i * EMBED_DIM + EMBED_DIM));
    }
    return rows;
  }

  /** Compute embeddings for a whole audio clip (warmup / batch use). */
  private async getEmbeddings(int16: Int16Array): Promise<Float32Array[]> {
    const spec = await this.getMelspectrogram(int16);
    const windows: Float32Array[][] = [];
    for (let i = 0; i < spec.length; i += STEP_SIZE) {
      const window = spec.slice(i, i + WINDOW_SIZE);
      if (window.length === WINDOW_SIZE) windows.push(window);
    }
    return this.embedWindows(windows);
  }

  private bufferRawData(int16: Int16Array): void {
    for (let i = 0; i < int16.length; i++) this.rawDataBuffer.push(int16[i]);
    if (this.rawDataBuffer.length > this.rawDataMaxLen) {
      this.rawDataBuffer = this.rawDataBuffer.slice(-this.rawDataMaxLen);
    }
  }

  private async streamingMelspectrogram(nSamples: number): Promise<void> {
    if (this.rawDataBuffer.length < 400) {
      throw new Error(
        "The number of input frames must be at least 400 samples @ 16khz (25 ms)!",
      );
    }
    const start = Math.max(0, this.rawDataBuffer.length - (nSamples + 160 * 3));
    const tail = Int16Array.from(this.rawDataBuffer.slice(start));
    const rows = await this.getMelspectrogram(tail);
    for (const row of rows) this.melBuffer.push(row);
    if (this.melBuffer.length > this.melspectrogramMaxLen) {
      this.melBuffer = this.melBuffer.slice(-this.melspectrogramMaxLen);
    }
  }

  /**
   * Streaming feature extraction. Feed it 16-bit PCM @ 16 kHz audio frames
   * (ideally multiples of 1280 samples / 80 ms).
   * Returns the number of samples processed during this call.
   */
  async streamingFeatures(x: Int16Array): Promise<number> {
    let processedSamples = 0;

    if (this.rawDataRemainder.length !== 0) {
      const merged = new Int16Array(this.rawDataRemainder.length + x.length);
      merged.set(this.rawDataRemainder, 0);
      merged.set(x, this.rawDataRemainder.length);
      x = merged;
      this.rawDataRemainder = new Int16Array(0);
    }

    if (this.accumulatedSamples + x.length >= CHUNK) {
      const remainder = (this.accumulatedSamples + x.length) % CHUNK;
      if (remainder !== 0) {
        const xEven = x.subarray(0, x.length - remainder);
        this.bufferRawData(xEven);
        this.accumulatedSamples += xEven.length;
        this.rawDataRemainder = x.slice(x.length - remainder);
      } else {
        this.bufferRawData(x);
        this.accumulatedSamples += x.length;
        this.rawDataRemainder = new Int16Array(0);
      }
    } else {
      this.accumulatedSamples += x.length;
      this.bufferRawData(x);
    }

    if (this.accumulatedSamples >= CHUNK && this.accumulatedSamples % CHUNK === 0) {
      await this.streamingMelspectrogram(this.accumulatedSamples);

      // Compute new embeddings for each newly-available 80 ms chunk.
      for (let i = this.accumulatedSamples / CHUNK - 1; i >= 0; i--) {
        const ndx = -STEP_SIZE * i === 0 ? this.melBuffer.length : -STEP_SIZE * i;
        const endAbs = ndx < 0 ? this.melBuffer.length + ndx : ndx;
        const startAbs = endAbs - WINDOW_SIZE;
        if (startAbs >= 0) {
          const window = this.melBuffer.slice(startAbs, endAbs);
          const [embedding] = await this.embedWindows([window]);
          if (embedding) this.featureBuffer.push(embedding);
        }
      }

      processedSamples = this.accumulatedSamples;
      this.accumulatedSamples = 0;
    }

    if (this.featureBuffer.length > this.featureBufferMaxLen) {
      this.featureBuffer = this.featureBuffer.slice(-this.featureBufferMaxLen);
    }

    return processedSamples !== 0 ? processedSamples : this.accumulatedSamples;
  }

  /** Most recent feature frames as a tensor-ready {data, dims}. */
  getFeatures(nFeatureFrames = 16, startNdx = -1): Features {
    let frames: Float32Array[];
    if (startNdx !== -1) {
      const end =
        startNdx + nFeatureFrames === 0 ? undefined : startNdx + nFeatureFrames;
      frames = this.featureBuffer.slice(startNdx, end);
    } else {
      frames = this.featureBuffer.slice(-nFeatureFrames);
    }
    const n = frames.length;
    const data = new Float32Array(n * EMBED_DIM);
    for (let i = 0; i < n; i++) data.set(frames[i] ?? new Float32Array(EMBED_DIM), i * EMBED_DIM);
    return { data, dims: [1, n, EMBED_DIM] };
  }
}
