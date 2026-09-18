/**
 * Adapted from the openWakeWord browser port:
 *   https://github.com/dscripka/openWakeWord/pull/339
 *   commit 1c76cd9b66400bccbed2a09fd86e70bb429dabd7 (web/src/microphone.js)
 * Original code licensed Apache-2.0 — see ../LICENSE.
 *
 * Modifications for Liteforms:
 *   - TypeScript strict port.
 *   - The worklet defaults to the static asset "/worklets/pcm-worklet.js"
 *     instead of a URL resolved next to the module source (Next.js-friendly).
 *
 * Captures microphone audio as 16-bit PCM @ 16 kHz and delivers it in
 * 1280-sample (80 ms) frames via the `onFrame` callback, using an AudioWorklet
 * ("pcm-worklet") so the main thread stays free of audio processing.
 */

import { WakeWordError } from "../types";

export interface MicrophoneOptions {
  workletUrl?: string;
  /**
   * Provides an existing MediaStream instead of opening a new getUserMedia
   * (Liteforms phase 2: one single getUserMedia shared with ChatPanel's
   * microphoneStreamRef). When omitted, the class acquires its own stream
   * with wake-word-friendly DSP constraints.
   */
  streamProvider?: () => Promise<MediaStream>;
}

type AudioContextCtor = typeof AudioContext & {
  new (options?: AudioContextOptions): AudioContext;
};

function resolveAudioContextCtor(): AudioContextCtor | null {
  const holder = globalThis as typeof globalThis & {
    webkitAudioContext?: AudioContextCtor;
  };
  return globalThis.AudioContext ?? holder.webkitAudioContext ?? null;
}

export class Microphone {
  private readonly workletUrl: string;
  private readonly streamProvider: (() => Promise<MediaStream>) | null;
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  /** True when WE acquired the stream (and may stop its tracks on cleanup). */
  private ownsStream = false;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private sink: GainNode | null = null;

  constructor(
    private readonly onFrame: (frame: Int16Array) => void,
    opts: MicrophoneOptions = {},
  ) {
    this.workletUrl = opts.workletUrl ?? "/worklets/pcm-worklet.js";
    this.streamProvider = opts.streamProvider ?? null;
  }

  /** Request mic access and start delivering 1280-sample frames. */
  async start(): Promise<void> {
    if (this.context) return;

    if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
      throw new WakeWordError(
        "BROWSER_UNSUPPORTED",
        "getUserMedia is not available in this browser context.",
      );
    }

    if (this.streamProvider) {
      // Shared-stream mode: the provider owns acquisition and its errors.
      try {
        this.stream = await this.streamProvider();
        this.ownsStream = false;
      } catch (err) {
        throw new WakeWordError(
          "MICROPHONE_DENIED",
          err instanceof Error ? err.message : "Microphone stream unavailable.",
          err,
        );
      }
    } else {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        this.ownsStream = true;
      } catch (err) {
        const name = (err as DOMException)?.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          throw new WakeWordError(
            "MICROPHONE_DENIED",
            "Microphone permission was denied.",
            err,
          );
        }
        if (name === "NotFoundError" || name === "NotReadableError") {
          throw new WakeWordError(
            "MICROPHONE_DENIED",
            "No usable microphone was found.",
            err,
          );
        }
        throw err;
      }
    }

    const AudioCtx = resolveAudioContextCtor();
    if (!AudioCtx) {
      this.releaseStream();
      throw new WakeWordError(
        "BROWSER_UNSUPPORTED",
        "Web Audio API is not available in this browser.",
      );
    }

    // Prefer a 16 kHz context; the worklet resamples as a fallback when the
    // browser ignores or rejects this hint.
    try {
      this.context = new AudioCtx({ sampleRate: 16000 });
    } catch {
      this.context = new AudioCtx();
    }
    if (this.context.state === "suspended") await this.context.resume();

    try {
      await this.context.audioWorklet.addModule(this.workletUrl);
    } catch (err) {
      await this.stop();
      throw new WakeWordError(
        "AUDIO_WORKLET_ERROR",
        `Failed to load the PCM AudioWorklet (${this.workletUrl}).`,
        err,
      );
    }

    this.source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, "pcm-worklet");
    this.node.port.onmessage = (e: MessageEvent<Int16Array>) =>
      this.onFrame(e.data);

    this.source.connect(this.node);
    // Keep the worklet pulling audio without routing mic to the speakers.
    this.sink = this.context.createGain();
    this.sink.gain.value = 0;
    this.node.connect(this.sink);
    this.sink.connect(this.context.destination);
  }

  /** Actual sample rate of the capture context (should be 16000). */
  get sampleRate(): number | null {
    return this.context ? this.context.sampleRate : null;
  }

  /** Stop capture and release the microphone and audio graph. */
  async stop(): Promise<void> {
    if (this.node) this.node.port.onmessage = null;
    try {
      this.source?.disconnect();
      this.node?.disconnect();
      this.sink?.disconnect();
    } catch {
      // Nodes may already be detached; safe to ignore.
    }
    this.releaseStream();
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // Context may already be closed.
      }
    }
    this.context = null;
    this.stream = null;
    this.node = null;
    this.source = null;
    this.sink = null;
  }

  private releaseStream(): void {
    // Never stop tracks of an externally provided (shared) stream.
    if (!this.ownsStream) return;
    this.stream?.getTracks().forEach((track) => track.stop());
  }
}
