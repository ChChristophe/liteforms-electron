/**
 * Adapted from the openWakeWord browser port:
 *   https://github.com/dscripka/openWakeWord/pull/339
 *   commit 1c76cd9b66400bccbed2a09fd86e70bb429dabd7 (web/src/openwakeword.js)
 * Original code licensed Apache-2.0 — see ../LICENSE.
 *
 * Modifications for Liteforms:
 *   - TypeScript strict port; the class is renamed `OpenWakeWordEngine` to
 *     avoid confusion with the upstream package name.
 *   - onnxruntime-web is loaded through a dynamic `import()` inside
 *     `create()`, so no module reachable from server components evaluates the
 *     runtime during Next.js SSR.
 *   - The wake word registry is restricted to "hey_jarvis" (phase 1 scope).
 *   - `destroy()` added to release InferenceSessions deterministically.
 *
 * Pipeline: melspectrogram -> speech embeddings -> wake word model, all
 * client-side via ONNX Runtime Web.
 */

import type { InferenceSession } from "onnxruntime-web";
import {
  AudioFeatures,
  CHUNK,
  type Features,
  type OrtModule,
} from "./audioFeatures";
import { FEATURE_MODELS, PRETRAINED_MODELS } from "./modelsRegistry";

const DEFAULT_INPUT_FRAMES = 16; // openWakeWord models consume 16 feature frames

export interface ConfigureOrtOptions {
  /** Base URL/path for the ONNX Runtime Web wasm binaries. */
  wasmPaths?: string;
  /** Number of wasm threads (1 avoids cross-origin isolation requirements). */
  numThreads?: number;
  /** Enable SIMD wasm. */
  simd?: boolean;
}

/** Configure the ORT Web environment. Call once before creating sessions. */
export function configureOrt(ort: OrtModule, opts: ConfigureOrtOptions): void {
  if (opts.wasmPaths !== undefined) ort.env.wasm.wasmPaths = opts.wasmPaths;
  if (opts.numThreads !== undefined) ort.env.wasm.numThreads = opts.numThreads;
  if (opts.simd !== undefined) ort.env.wasm.simd = opts.simd;
}

/**
 * Best-effort read of an input/output dimension across ort-web versions.
 * ort-web 1.21 does not expose input/output metadata, in which case `null` is
 * returned and callers fall back to DEFAULT_INPUT_FRAMES / single output —
 * which matches hey_jarvis_v0.1 ([1,16,96] input, [1,1] output).
 */
function readShapeDim(
  session: InferenceSession,
  which: "input" | "output",
  idx: number,
): number | null {
  interface MaybeMeta {
    shape?: readonly number[];
    dimensions?: readonly number[];
  }
  const holder = session as unknown as {
    inputMetadata?: readonly (MaybeMeta | undefined)[];
    outputMetadata?: readonly (MaybeMeta | undefined)[];
  };
  const meta =
    which === "input" ? holder.inputMetadata?.[0] : holder.outputMetadata?.[0];
  const shape = meta?.shape ?? meta?.dimensions;
  const v = shape?.[idx];
  return typeof v === "number" && v > 0 ? v : null;
}

export interface EngineDetectionEvent {
  label: string;
  score: number;
}

interface LoadedWakewordModel {
  session: InferenceSession;
  inputName: string;
  inputFrames: number;
  outputClasses: number;
  classMapping: Record<number, string> | null;
}

export interface OpenWakeWordEngineOptions {
  /** Base URL/path for model files (absolute paths kept verbatim). */
  baseUrl?: string;
  /** Wake word models to load from the restricted Liteforms registry. */
  wakewordModels?: Array<keyof typeof PRETRAINED_MODELS>;
  /** Score threshold for triggering `onDetection`. Default 0.5. */
  threshold?: number;
  /**
   * Fired from within `predict()` for every label whose score meets
   * `threshold`; may fire several times per predict call.
   */
  onDetection?: ((event: EngineDetectionEvent) => void) | null;
  /** Options forwarded to `configureOrt`. */
  ort?: ConfigureOrtOptions;
}

export class OpenWakeWordEngine {
  private readonly models = new Map<string, LoadedWakewordModel>();
  private features: AudioFeatures | null = null;
  private predictionBuffers = new Map<string, number[]>();
  private melspecSession: InferenceSession | null = null;
  private embeddingSession: InferenceSession | null = null;
  private ortModule: OrtModule | null = null;

  /** Detection score threshold. Mutable at runtime. */
  threshold = 0.5;
  /** Detection callback. Mutable at runtime. */
  onDetection: ((event: EngineDetectionEvent) => void) | null = null;

  static async create(
    options: OpenWakeWordEngineOptions = {},
  ): Promise<OpenWakeWordEngine> {
    // Client-only dynamic import keeps SSR free of browser-only side effects.
    // The "/wasm" entry is the wasm-only build: it loads the plain
    // ort-wasm-simd-threaded.{mjs,wasm} artifacts we self-host in /ort/,
    // whereas the default full bundle expects the ~30 MB JSEP variants
    // (WebGPU/WebNN) we deliberately do not ship.
    const ort = await import("onnxruntime-web/wasm");
    if (options.ort) configureOrt(ort, options.ort);

    const baseUrl = options.baseUrl ?? "./models/";
    const executionProviders = ["wasm"] as const;
    const threshold = options.threshold ?? 0.5;

    const joinUrl = (file: string): string =>
      /^https?:|^\.|^\//.test(file) ? file : baseUrl + file;

    const engine = new OpenWakeWordEngine();
    engine.threshold = threshold;
    engine.onDetection = options.onDetection ?? null;
    engine.ortModule = ort;

    // Load feature models + streaming feature extractor.
    const [melspecSession, embeddingSession] = await Promise.all([
      ort.InferenceSession.create(joinUrl(FEATURE_MODELS.melspectrogram), {
        executionProviders,
      }),
      ort.InferenceSession.create(joinUrl(FEATURE_MODELS.embedding), {
        executionProviders,
      }),
    ]);
    engine.melspecSession = melspecSession;
    engine.embeddingSession = embeddingSession;
    engine.features = new AudioFeatures(ort, melspecSession, embeddingSession);

    // Load wake word models.
    const wakewordModels = options.wakewordModels ??
      (Object.keys(PRETRAINED_MODELS) as Array<keyof typeof PRETRAINED_MODELS>);
    for (const name of wakewordModels) {
      const file = PRETRAINED_MODELS[name];
      const url = joinUrl(file);
      const session = await ort.InferenceSession.create(url, {
        executionProviders,
      });
      const detectedFrames = readShapeDim(session, "input", 1);
      const outputClasses = readShapeDim(session, "output", 1) ?? 1;
      engine.models.set(name, {
        session,
        inputName: session.inputNames[0] ?? "",
        inputFrames: detectedFrames ?? DEFAULT_INPUT_FRAMES,
        outputClasses,
        classMapping: null,
      });
    }

    await engine.features.warmup();
    return engine;
  }

  get modelNames(): string[] {
    return [...this.models.keys()];
  }

  /** Reset all streaming/prediction state (keeps loaded sessions). */
  async reset(): Promise<void> {
    this.features?.reset(true);
    await this.features?.warmup();
    this.predictionBuffers.clear();
  }

  /** Release ONNX sessions. Best-effort across ort-web versions. */
  async destroy(): Promise<void> {
    const sessions = [
      ...[...this.models.values()].map((m) => m.session),
      this.melspecSession,
      this.embeddingSession,
    ].filter((s): s is InferenceSession => Boolean(s));
    this.models.clear();
    this.features = null;
    this.melspecSession = null;
    this.embeddingSession = null;
    this.predictionBuffers.clear();
    for (const session of sessions) {
      try {
        await (session as unknown as { release?: () => Promise<void> }).release?.();
      } catch {
        // release() is unavailable/no-op on some ort builds; GC will reclaim.
      }
    }
  }

  private runModel(model: LoadedWakewordModel, feat: Features): Promise<number[]> {
    const ort = this.ortModule;
    if (!ort) return Promise.resolve([]);
    const tensor = new ort.Tensor("float32", feat.data, feat.dims);
    const out = model.session.run({ [model.inputName]: tensor });
    return out.then((feeds) => {
      const output = feeds[model.session.outputNames[0]] as unknown as {
        data: ArrayLike<number>;
      };
      return Array.from(output.data);
    });
  }

  private pushPrediction(label: string, value: number): void {
    let buffer = this.predictionBuffers.get(label);
    if (!buffer) {
      buffer = [];
      this.predictionBuffers.set(label, buffer);
    }
    buffer.push(value);
    if (buffer.length > 30) buffer.shift();
  }

  /**
   * Predict wake word scores for a frame of 16-bit PCM @ 16 kHz audio
   * (ideally multiples of 1280 samples / 80 ms).
   * Returns a `{ label: score }` map with scores in 0..1.
   */
  async predict(x: Int16Array): Promise<Record<string, number>> {
    if (!(x instanceof Int16Array)) {
      throw new TypeError("Input audio (x) must be an Int16Array of 16 kHz PCM.");
    }
    const features = this.features;
    if (!features) return {};

    const nPrepared = await features.streamingFeatures(x);
    const predictions: Record<string, number> = {};

    for (const [name, model] of this.models.entries()) {
      let prediction: number[];

      if (nPrepared > CHUNK) {
        const group: number[][] = [];
        for (let i = Math.floor(nPrepared / CHUNK) - 1; i >= 0; i--) {
          const feat = features.getFeatures(
            model.inputFrames,
            -model.inputFrames - i,
          );
          group.push(await this.runModel(model, feat));
        }
        prediction = group.reduce((acc, row) =>
          acc.map((v, idx) => Math.max(v, row[idx] ?? 0)),
        );
      } else if (nPrepared === CHUNK) {
        const feat = features.getFeatures(model.inputFrames);
        prediction = await this.runModel(model, feat);
      } else {
        // Not enough new samples yet: reuse the previous prediction.
        if (model.outputClasses === 1) {
          const buffer = this.predictionBuffers.get(name);
          prediction = [buffer && buffer.length > 0 ? buffer[buffer.length - 1]! : 0];
        } else {
          prediction = new Array<number>(model.outputClasses).fill(0);
        }
      }

      if (model.outputClasses === 1) {
        predictions[name] = prediction[0] ?? 0;
      } else if (model.classMapping) {
        for (const [intLabel, cls] of Object.entries(model.classMapping)) {
          predictions[cls] = prediction[Number.parseInt(intLabel, 10)] ?? 0;
        }
      } else {
        for (let c = 0; c < model.outputClasses; c++) {
          predictions[`${name}_${c}`] = prediction[c] ?? 0;
        }
      }
    }

    // Zero out predictions for the first frames during model warm-up.
    for (const label of Object.keys(predictions)) {
      const buffer = this.predictionBuffers.get(label);
      if (!buffer || buffer.length < 5) predictions[label] = 0;
    }

    for (const label of Object.keys(predictions)) {
      this.pushPrediction(label, predictions[label]);
    }

    if (this.onDetection) {
      for (const [label, score] of Object.entries(predictions)) {
        if (score >= this.threshold) {
          this.onDetection({ label, score });
        }
      }
    }

    return predictions;
  }
}
