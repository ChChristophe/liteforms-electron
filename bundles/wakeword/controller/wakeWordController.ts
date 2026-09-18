/**
 * Liteforms wake word bundle — controller.
 *
 * Single owner of the microphone and the ONNX engine for the POC. Wires the
 * capture pipeline (pcm-worklet -> Microphone -> OpenWakeWordEngine) to a small
 * state machine and emits typed events. UI code consumes the store/hook; the
 * controller itself is framework-free.
 */

import { Microphone } from "../engine/microphone";
import { OpenWakeWordEngine } from "../engine/openWakeWordEngine";
import { WAKE_WORD_DEFAULTS } from "../config";
import type {
  ResolvedWakeWordConfig,
  WakeWordControllerOptions,
  WakeWordDetectedEvent,
  WakeWordError,
  WakeWordEventMap,
  WakeWordErrorCode,
  WakeWordLabel,
  WakeWordStatus,
} from "../types";
import { WakeWordError as WakeWordErrorClass } from "../types";

type Listener<K extends keyof WakeWordEventMap> = (
  payload: WakeWordEventMap[K],
) => void;

interface QueuedFrame {
  frame: Int16Array;
}

export class WakeWordController {
  private config: ResolvedWakeWordConfig;
  private readonly listeners: {
    [K in keyof WakeWordEventMap]: Set<Listener<K>>;
  } = {
    detected: new Set(),
    status: new Set(),
    started: new Set(),
    stopped: new Set(),
    scores: new Set(),
    error: new Set(),
  };

  private engine: OpenWakeWordEngine | null = null;
  private microphone: Microphone | null = null;
  private queue: QueuedFrame[] = [];
  private draining = false;
  /** When paused, incoming frames are dropped (ASR/TTS owns the airtime). */
  private paused = false;
  private cooldownUntil = 0;
  private detectedTimer: ReturnType<typeof setTimeout> | null = null;
  /** Guards against concurrent init from React StrictMode double-mounts. */
  private initToken = 0;

  private _status: WakeWordStatus = "disabled";

  constructor(config: WakeWordControllerOptions = {}) {
    this.config = { ...WAKE_WORD_DEFAULTS, ...config };
  }

  get status(): WakeWordStatus {
    return this._status;
  }

  get threshold(): number {
    return this.engine?.threshold ?? this.config.threshold;
  }

  on<K extends keyof WakeWordEventMap>(event: K, fn: Listener<K>): () => void {
    this.listeners[event].add(fn);
    return () => this.listeners[event].delete(fn);
  }

  private emit<K extends keyof WakeWordEventMap>(
    event: K,
    payload: WakeWordEventMap[K],
  ): void {
    for (const fn of [...this.listeners[event]]) fn(payload);
  }

  private setStatus(status: WakeWordStatus): void {
    this._status = status;
    this.emit("status", status);
  }

  /** Create the engine and start listening. Idempotent while running. */
  async start(): Promise<void> {
    if (this._status === "initializing" || this._status === "listening") return;
    const token = ++this.initToken;

    try {
      this.setStatus("initializing");
      if (!this.engine) {
        this.engine = await OpenWakeWordEngine.create({
          baseUrl: this.config.baseUrl,
          wakewordModels: this.config.wakewordModels,
          threshold: this.config.threshold,
          ort: {
            wasmPaths: this.config.wasmPaths,
            numThreads: this.config.numThreads,
          },
          onDetection: ({ label, score }) =>
            this.handleEngineDetection(
              label as WakeWordLabel,
              score,
            ),
        });
      }
      if (token !== this.initToken) return;

      await this.ensureMicrophone();
      if (token !== this.initToken) return;

      this.setStatus("listening");
      this.emit("started", undefined);
    } catch (err) {
      if (token !== this.initToken) return;
      this.fail(err);
    }
  }

  /** Stop listening and release the microphone (engine stays warm). */
  async stop(): Promise<void> {
    ++this.initToken;
    this.clearDetectedTimer();
    this.queue = [];
    this.draining = false;
    if (this.microphone) {
      await this.microphone.stop();
      this.microphone = null;
    }
    this.cooldownUntil = 0;
    if (this._status !== "error") this.setStatus("disabled");
    this.emit("stopped", undefined);
  }

  /** Full teardown: stop + release ONNX sessions and listeners. */
  async destroy(): Promise<void> {
    await this.stop();
    if (this.engine) {
      await this.engine.destroy();
      this.engine = null;
    }
    for (const set of Object.values(this.listeners)) set.clear();
  }

  /** Update the detection threshold at runtime (clamped to [0, 1]). */
  setThreshold(threshold: number): void {
    const clamped = Math.min(1, Math.max(0, threshold));
    this.config.threshold = clamped;
    if (this.engine) this.engine.threshold = clamped;
  }

  /**
   * Reset streaming buffers (e.g. after long idle) so stale audio does not
   * leak into the next detection window.
   */
  async resetBuffers(): Promise<void> {
    if (this.engine) await this.engine.reset();
    this.queue = [];
  }

  /**
   * Suspend/resume frame processing. While paused (another voice session is
   * active), frames are dropped: no detections from ASR capture or TTS echo,
   * and no CPU spent on inference.
   */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.queue = [];
      this.clearDetectedTimer();
      if (this._status === "detected") this.setStatus("listening");
    }
  }

  // ---- internals -----------------------------------------------------------

  private async ensureMicrophone(): Promise<void> {
    if (this.microphone) {
      await this.microphone.start();
      return;
    }
    const mic = new Microphone(
      (frame) => this.enqueueFrame(frame),
      {
        workletUrl: this.config.workletUrl,
        streamProvider: this.config.streamProvider,
      },
    );
    await mic.start();
    const rate = mic.sampleRate;
    if (rate && rate !== 16000) {
      // The worklet resamples as a fallback, but flag unexpected rates loudly.
      console.warn(`[wakeword] AudioContext sampleRate is ${rate}, expected 16000.`);
    }
    this.microphone = mic;
  }

  private enqueueFrame(frame: Int16Array): void {
    if (this.paused) return;
    if (this._status !== "listening" && this._status !== "detected") return;
    this.queue.push({ frame });
    // Bounded queue: drop oldest frames when inference falls behind realtime.
    while (this.queue.length > this.config.maxQueuedFrames) this.queue.shift();
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining || !this.engine) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift();
        if (!next) break;
        const scores = await this.engine.predict(next.frame);
        this.emit("scores", { scores });
      }
    } catch (err) {
      this.fail(err);
    } finally {
      this.draining = false;
    }
  }

  private handleEngineDetection(label: WakeWordLabel, score: number): void {
    const now = Date.now();
    if (now < this.cooldownUntil) return;
    this.cooldownUntil = now + this.config.cooldownMs;

    const event: WakeWordDetectedEvent = { label, score, timestamp: now };
    this.setStatus("detected");
    this.emit("detected", event);

    this.clearDetectedTimer();
    this.detectedTimer = setTimeout(() => {
      if (this._status === "detected") this.setStatus("listening");
    }, this.config.cooldownMs);
  }

  private clearDetectedTimer(): void {
    if (this.detectedTimer) {
      clearTimeout(this.detectedTimer);
      this.detectedTimer = null;
    }
  }

  private fail(err: unknown): void {
    let error: WakeWordError;
    if (err instanceof WakeWordErrorClass) {
      error = err;
    } else {
      error = new WakeWordErrorClass(
        "UNKNOWN" satisfies WakeWordErrorCode,
        err instanceof Error ? err.message : String(err),
        err,
      );
    }
    this.setStatus("error");
    this.emit("error", error);
  }
}
