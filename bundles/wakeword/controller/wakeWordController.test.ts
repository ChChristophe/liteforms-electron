import { beforeEach, describe, expect, it, vi } from "vitest";
import { WAKE_WORD_DEFAULTS } from "../config";
import { WakeWordController } from "./wakeWordController";

interface FakeMic {
  onFrame: (frame: Int16Array) => void;
  started: boolean;
  stopped: boolean;
}

interface EngineHandle {
  threshold: number;
  predictImpl: (x: Int16Array) => Record<string, number>;
  predict: (x: Int16Array) => Promise<Record<string, number>>;
  destroy: () => Promise<void>;
}

const { micInstances, engineInstances, micFailure } = vi.hoisted(() => ({
  micInstances: [] as FakeMic[],
  engineInstances: [] as EngineHandle[],
  micFailure: { name: null as string | null },
}));

vi.mock("../engine/microphone", () => ({
  Microphone: class implements FakeMic {
    sampleRate = 16000;
    started = false;
    stopped = false;
    onFrame: (frame: Int16Array) => void;
    constructor(onFrame: (frame: Int16Array) => void) {
      this.onFrame = onFrame;
      micInstances.push(this);
    }
    async start(): Promise<void> {
      if (micFailure.name !== null) {
        const err = new Error("mic failed") as Error & { name: string };
        err.name = micFailure.name;
        throw err;
      }
      this.started = true;
    }
    async stop(): Promise<void> {
      this.started = false;
      this.stopped = true;
    }
  },
}));

vi.mock("../engine/openWakeWordEngine", () => {
  interface DetectionEvent {
    label: string;
    score: number;
  }
  class MockEngine implements EngineHandle {
    threshold = 0.5;
    predictImpl: (x: Int16Array) => Record<string, number> = () => ({
      hey_jarvis: 0,
    });
    onDetection: ((e: DetectionEvent) => void) | null = null;
    constructor() {
      engineInstances.push(this);
    }
    predict(x: Int16Array): Promise<Record<string, number>> {
      const scores = this.predictImpl(x);
      if (this.onDetection) {
        for (const [label, score] of Object.entries(scores)) {
          if (score >= this.threshold) this.onDetection({ label, score });
        }
      }
      return Promise.resolve(scores);
    }
    async reset(): Promise<void> {}
    async destroy(): Promise<void> {}
    static async create(opts?: {
      threshold?: number;
      onDetection?: ((e: DetectionEvent) => void) | null;
    }): Promise<MockEngine> {
      const inst = new MockEngine();
      if (opts?.threshold !== undefined) inst.threshold = opts.threshold;
      inst.onDetection = opts?.onDetection ?? null;
      return inst;
    }
  }
  return { OpenWakeWordEngine: MockEngine };
});

function flush(): Promise<void> {
  return vi.advanceTimersByTimeAsync(0).then(() => undefined);
}

function lastMic(): FakeMic {
  expect(micInstances.length).toBeGreaterThan(0);
  return micInstances[micInstances.length - 1];
}

function lastEngine(): EngineHandle {
  expect(engineInstances.length).toBeGreaterThan(0);
  return engineInstances[engineInstances.length - 1];
}

describe("wake word bundle defaults", () => {
  it("matches the phase-1 contract", () => {
    expect(WAKE_WORD_DEFAULTS.baseUrl).toBe("/models/wakeword/");
    expect(WAKE_WORD_DEFAULTS.workletUrl).toBe("/worklets/pcm-worklet.js");
    expect(WAKE_WORD_DEFAULTS.wasmPaths).toBe("/ort/");
    expect(WAKE_WORD_DEFAULTS.threshold).toBe(0.5);
    expect(WAKE_WORD_DEFAULTS.cooldownMs).toBe(2000);
    expect(WAKE_WORD_DEFAULTS.numThreads).toBe(1);
    expect(WAKE_WORD_DEFAULTS.maxQueuedFrames).toBe(5);
  });
});

describe("WakeWordController", () => {
  beforeEach(() => {
    micInstances.length = 0;
    engineInstances.length = 0;
    micFailure.name = null;
    vi.useFakeTimers();
  });

  it("starts: initializes engine + microphone and reaches listening", async () => {
    const c = new WakeWordController();
    const statuses: string[] = [];
    c.on("status", (s) => statuses.push(s));
    await c.start();

    expect(statuses).toEqual(["initializing", "listening"]);
    expect(c.status).toBe("listening");
    expect(lastMic().started).toBe(true);
  });

  it("is idempotent while running", async () => {
    const c = new WakeWordController();
    await c.start();
    await c.start();
    expect(micInstances).toHaveLength(1);
  });

  it("feeds mic frames to engine.predict and emits scores", async () => {
    const c = new WakeWordController();
    await c.start();
    lastEngine().predictImpl = () => ({ hey_jarvis: 0.1 });

    const scoresEvents: Array<Record<string, number>> = [];
    c.on("scores", (e) => scoresEvents.push(e.scores));

    const frame = new Int16Array(1280);
    lastMic().onFrame(frame);
    lastMic().onFrame(frame);
    await flush();

    expect(scoresEvents).toEqual([
      { hey_jarvis: 0.1 },
      { hey_jarvis: 0.1 },
    ]);
  });

  it("caps the pending frame queue at maxQueuedFrames", async () => {
    let releasePredict!: () => void;
    const gate = new Promise<void>((resolve) => {
      releasePredict = resolve;
    });
    const c = new WakeWordController({ maxQueuedFrames: 2 });
    await c.start();
    lastEngine().predict = () =>
      gate.then(() => ({ hey_jarvis: 0 }));

    const frame = new Int16Array(1280);
    for (let i = 0; i < 10; i++) lastMic().onFrame(frame);

    const queue = (
      c as unknown as { queue: Array<{ frame: Int16Array }> }
    ).queue;
    expect(queue.length).toBeLessThanOrEqual(2);

    releasePredict();
    await flush();
    expect(c.status).toBe("listening");
  });

  it("detects, enters cooldown, ignores re-detections, returns to listening", async () => {
    const c = new WakeWordController({ cooldownMs: 2000 });
    const detections: Array<{ label: string; timestamp: number }> = [];
    c.on("detected", (e) => detections.push(e));

    await c.start();
    lastEngine().predictImpl = () => ({ hey_jarvis: 0.9 });

    lastMic().onFrame(new Int16Array(1280));
    await flush();

    expect(detections).toHaveLength(1);
    expect(detections[0].label).toBe("hey_jarvis");
    expect(typeof detections[0].timestamp).toBe("number");
    expect(c.status).toBe("detected");

    // Second detection within the cooldown window is swallowed.
    lastMic().onFrame(new Int16Array(1280));
    await flush();
    expect(detections).toHaveLength(1);

    // After the cooldown the controller is back to listening.
    vi.advanceTimersByTime(2100);
    expect(c.status).toBe("listening");

    // And a fresh detection passes again.
    lastMic().onFrame(new Int16Array(1280));
    await flush();
    expect(detections).toHaveLength(2);
  });

  it("stop releases the microphone and returns to disabled", async () => {
    const c = new WakeWordController();
    await c.start();
    let stoppedEvents = 0;
    c.on("stopped", () => {
      stoppedEvents += 1;
    });
    await c.stop();

    expect(c.status).toBe("disabled");
    expect(stoppedEvents).toBe(1);
    expect(lastMic().stopped).toBe(true);
  });

  it("destroy stops and releases engine sessions", async () => {
    const c = new WakeWordController();
    await c.start();
    let destroyed = false;
    lastEngine().destroy = async () => {
      destroyed = true;
    };
    await c.destroy();
    expect(destroyed).toBe(true);
    expect(c.status).toBe("disabled");
  });

  it("setThreshold clamps to [0,1] and reaches the engine", async () => {
    const c = new WakeWordController({ threshold: 0.5 });
    await c.start();
    const engine = lastEngine();

    c.setThreshold(-1);
    expect(engine.threshold).toBe(0);

    c.setThreshold(2);
    expect(engine.threshold).toBe(1);

    c.setThreshold(0.75);
    expect(engine.threshold).toBe(0.75);
    expect(c.threshold).toBe(0.75);
  });

  it("setPaused drops incoming frames until resumed", async () => {
    const c = new WakeWordController();
    await c.start();

    let predictCalls = 0;
    lastEngine().predictImpl = () => {
      predictCalls += 1;
      return { hey_jarvis: 0.1 };
    };

    c.setPaused(true);
    lastMic().onFrame(new Int16Array(1280));
    await flush();
    expect(predictCalls).toBe(0);

    c.setPaused(false);
    lastMic().onFrame(new Int16Array(1280));
    await flush();
    expect(predictCalls).toBe(1);
  });

  it("wraps unexpected start failures into UNKNOWN typed errors", async () => {
    // The injected failure is a plain Error: the DOMException-name -> code
    // mapping lives in the real Microphone (covered by microphone.test.ts).
    micFailure.name = "NotAllowedError";

    const errors: Array<{ code: string; message: string }> = [];
    const c = new WakeWordController();
    c.on("error", (e) => errors.push(e));
    await c.start();

    expect(c.status).toBe("error");
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("UNKNOWN");
    expect(errors[0].message).toBe("mic failed");
  });
});
