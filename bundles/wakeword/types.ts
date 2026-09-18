/**
 * Liteforms wake word bundle — shared types.
 * Bundle contract documented in ARCHITECTURE_BUNDLE.md.
 */

import type { WakewordModelName } from "./engine/modelsRegistry";

export type WakeWordStatus =
  | "disabled"
  | "initializing"
  | "ready"
  | "listening"
  | "detected"
  | "error";

export type WakeWordLabel = WakewordModelName;

/**
 * Visual-cue parameters (ETUDES §5) attached by the bridge from the persisted
 * settings so the avatar scene needs no dependency on the settings store.
 */
export interface WakeWordCueConfig {
  /** Alcove flash color, "#rrggbb". */
  flashColor: string;
  /** Approximate total alcove blink duration in ms. */
  blinkDurationMs: number;
  /** Animation played on the avatar, one of ANIMATION_OPTIONS urls. */
  animationUrl: string;
}

export interface WakeWordDetectedEvent {
  label: WakeWordLabel;
  /** Raw model score in 0..1 (kept for diagnostics/tests). */
  score: number;
  /** Date.now() of the detection (added by the controller; not provided by the engine). */
  timestamp: number;
  /** Present when the bridge dispatches the event (absent on raw controller emits). */
  cue?: WakeWordCueConfig;
}

export interface WakeWordScoresEvent {
  scores: Record<string, number>;
}

export type WakeWordErrorCode =
  | "MICROPHONE_DENIED"
  | "MODEL_LOAD_ERROR"
  | "ONNX_ERROR"
  | "AUDIO_WORKLET_ERROR"
  | "BROWSER_UNSUPPORTED"
  | "UNKNOWN";

export class WakeWordError extends Error {
  readonly code: WakeWordErrorCode;

  constructor(code: WakeWordErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "WakeWordError";
    this.code = code;
    if (cause !== undefined) {
      // ES2022 Error cause is supported by the build target.
      Object.assign(this, { cause });
    }
  }
}

export interface WakeWordEventMap {
  detected: WakeWordDetectedEvent;
  status: WakeWordStatus;
  started: undefined;
  stopped: undefined;
  scores: WakeWordScoresEvent;
  error: WakeWordError;
}

export interface WakeWordControllerOptions {
  /** Detection threshold in 0..1. Default 0.5. */
  threshold?: number;
  /** Ignore re-detections for this many ms after a hit. Default 2000. */
  cooldownMs?: number;
  /** Base URL serving the ONNX models. Default "/models/wakeword/". */
  baseUrl?: string;
  /** URL of the PCM AudioWorklet module. Default "/worklets/pcm-worklet.js". */
  workletUrl?: string;
  /** Base path for ONNX Runtime Web wasm binaries. Default "/ort/". */
  wasmPaths?: string;
  /** Wasm thread count for ORT. Default 1. */
  numThreads?: number;
  /** Max queued mic frames awaiting prediction; oldest dropped beyond this. Default 5. */
  maxQueuedFrames?: number;
  /**
   * Pre-trained wake word models to load (keys of the bundle registry).
   * Default: ["hey_jarvis"].
   */
  wakewordModels?: Array<WakewordModelName>;
  /**
   * Provides an existing MediaStream instead of acquiring a new getUserMedia
   * (phase-2 shared-stream mode: ChatPanel owns the single getUserMedia).
   */
  streamProvider?: () => Promise<MediaStream>;
}

/** Fully-resolved config: every scalar has a default; streamProvider stays optional. */
export type ResolvedWakeWordConfig = Required<
  Omit<WakeWordControllerOptions, "streamProvider">
> &
  Pick<WakeWordControllerOptions, "streamProvider">;
