/** Liteforms wake word bundle defaults (phase 1 POC). */
import type { ResolvedWakeWordConfig } from "./types";

export const WAKE_WORD_DEFAULTS: ResolvedWakeWordConfig = {
  /** Base URL serving the ONNX models (self-hosted; GitHub releases lack CORS headers). */
  baseUrl: "/models/wakeword/",
  /** PCM AudioWorklet module served as a static asset. */
  workletUrl: "/worklets/pcm-worklet.js",
  /** ONNX Runtime Web wasm binaries copied from node_modules/onnxruntime-web/dist. */
  wasmPaths: "/ort/",
  /** Detection threshold in 0..1 (PR #339 default). */
  threshold: 0.5,
  /** Ignore re-detections for this many ms after a hit. */
  cooldownMs: 2000,
  /** Single-threaded wasm for deterministic behaviour (crossOriginIsolated is available if we later raise it). */
  numThreads: 1,
  /** Max queued mic frames awaiting prediction; oldest dropped beyond this. */
  maxQueuedFrames: 5,
  /** Pre-trained wake word models loaded by default. */
  wakewordModels: ["hey_jarvis"],
} as const;
