import { afterEach, describe, expect, it } from "vitest";
import { Microphone } from "./microphone";
import { WakeWordError } from "../types";

interface StubMediaDevices {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}

function stubGetUserMedia(impl: () => Promise<MediaStream>): void {
  const nav = globalThis.navigator as typeof navigator & {
    mediaDevices?: StubMediaDevices;
  };
  Object.defineProperty(nav, "mediaDevices", {
    value: { getUserMedia: impl },
    configurable: true,
  });
}

function domError(name: string): Error {
  const err = new Error(name) as Error & { name: string };
  err.name = name;
  return err;
}

async function expectCode(
  mic: Microphone,
  code: WakeWordError["code"],
): Promise<void> {
  await expect(mic.start()).rejects.toMatchObject({
    name: "WakeWordError",
    code,
  });
}

describe("Microphone error mapping", () => {
  afterEach(() => {
    stubGetUserMedia(async () => {
      throw new Error("no stub");
    });
  });

  it("maps NotAllowedError to MICROPHONE_DENIED", async () => {
    stubGetUserMedia(() => Promise.reject(domError("NotAllowedError")));
    await expectCode(new Microphone(() => {}), "MICROPHONE_DENIED");
  });

  it("maps SecurityError to MICROPHONE_DENIED", async () => {
    stubGetUserMedia(() => Promise.reject(domError("SecurityError")));
    await expectCode(new Microphone(() => {}), "MICROPHONE_DENIED");
  });

  it("maps NotFoundError to MICROPHONE_DENIED", async () => {
    stubGetUserMedia(() => Promise.reject(domError("NotFoundError")));
    await expectCode(new Microphone(() => {}), "MICROPHONE_DENIED");
  });

  it("flags unsupported contexts as BROWSER_UNSUPPORTED", async () => {
    const nav = globalThis.navigator as typeof navigator & {
      mediaDevices?: StubMediaDevices;
    };
    Object.defineProperty(nav, "mediaDevices", {
      value: undefined,
      configurable: true,
    });
    await expectCode(new Microphone(() => {}), "BROWSER_UNSUPPORTED");
  });
});

function makeTrackedFakeStream(): {
  stream: MediaStream;
  wasStopped: () => boolean;
} {
  let stopped = false;
  const track = {
    readyState: "live",
    stop: () => {
      stopped = true;
    },
  };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, wasStopped: () => stopped };
}

describe("Microphone shared-stream mode (phase 2)", () => {
  it("reuses the provided stream instead of calling getUserMedia", async () => {
    let getUserMediaCalls = 0;
    stubGetUserMedia(async () => {
      getUserMediaCalls += 1;
      throw new Error("must not be called");
    });
    const { stream } = makeTrackedFakeStream();

    // No AudioContext in the node environment: start() fails after stream
    // acquisition, which is exactly what we exploit to observe ownership.
    const mic = new Microphone(() => {}, { streamProvider: async () => stream });
    await expect(mic.start()).rejects.toMatchObject({ code: "BROWSER_UNSUPPORTED" });

    expect(getUserMediaCalls).toBe(0);
  });

  it("never stops the tracks of a provided (shared) stream", async () => {
    stubGetUserMedia(async () => {
      throw new Error("must not be called");
    });
    const { stream, wasStopped } = makeTrackedFakeStream();

    const mic = new Microphone(() => {}, { streamProvider: async () => stream });
    await expect(mic.start()).rejects.toBeTruthy();
    expect(wasStopped()).toBe(false);
  });

  it("stops tracks of self-acquired streams on failure cleanup", async () => {
    let getUserMediaCalls = 0;
    stubGetUserMedia(async () => {
      getUserMediaCalls += 1;
      return makeTrackedFakeStream().stream;
    });
    const mic = new Microphone(() => {});
    await expect(mic.start()).rejects.toBeTruthy();
    expect(getUserMediaCalls).toBe(1);
  });
});
