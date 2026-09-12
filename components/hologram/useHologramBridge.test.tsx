// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useHologramBridge } from "./useHologramBridge";
import { hologramMessageOrigin } from "@/lib/avatar/hologramMessageProtocol";
import { avatarLipSyncEventName } from "@/lib/avatar/lipSyncEvents";
import { createRmsLipSyncFrame } from "@/lib/speech";

const openHldHologramWindow = vi.fn();

vi.mock("@/lib/avatar/hologramWindow", () => ({
  openHldHologramWindow: (...args: unknown[]) => openHldHologramWindow(...args),
}));

function makePopup() {
  return {
    name: "liteforms-hld-hologram",
    closed: false,
    close: vi.fn(),
    postMessage: vi.fn(),
  };
}

function makeTtsResult(audio: ArrayBuffer) {
  return {
    audio,
    mimeType: "audio/mpeg",
  };
}

function dispatchReady(from: { closed: boolean }) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", {
      source: from as unknown as Window,
      origin: window.location.origin,
      data: { origin: hologramMessageOrigin, kind: "ready" },
    }));
  });
}

describe("useHologramBridge", () => {
  beforeEach(() => {
    openHldHologramWindow.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("buffers TTS until the hologram window reports ready, then flushes with the exact origin", async () => {
    const popup = makePopup();
    openHldHologramWindow.mockResolvedValue(popup);
    const { result } = renderHook(() => useHologramBridge());

    await act(async () => {
      await result.current.open(undefined);
    });

    const audio = new ArrayBuffer(16);
    let accepted = false;
    act(() => {
      accepted = result.current.handleTtsResult(makeTtsResult(audio));
    });
    expect(accepted).toBe(true);
    expect(popup.postMessage).not.toHaveBeenCalled();

    dispatchReady(popup);

    expect(popup.postMessage).toHaveBeenCalledTimes(1);
    const [message, targetOrigin, transfer] = popup.postMessage.mock.calls[0];
    expect(message).toMatchObject({ origin: hologramMessageOrigin, kind: "utter-bytes" });
    expect(targetOrigin).toBe(window.location.origin);
    expect(transfer).toEqual([audio]);
  });

  it("keeps only the latest lipsync frame while buffering", async () => {
    const popup = makePopup();
    openHldHologramWindow.mockResolvedValue(popup);
    const { result } = renderHook(() => useHologramBridge());

    await act(async () => {
      await result.current.open(undefined);
    });

    act(() => {
      window.dispatchEvent(new CustomEvent(avatarLipSyncEventName, { detail: createRmsLipSyncFrame(0.1) }));
      window.dispatchEvent(new CustomEvent(avatarLipSyncEventName, { detail: createRmsLipSyncFrame(0.9) }));
    });
    expect(popup.postMessage).not.toHaveBeenCalled();

    dispatchReady(popup);

    const lipsyncMessages = popup.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message: { kind?: string }) => message.kind === "lipsync");
    expect(lipsyncMessages).toHaveLength(1);
    expect((lipsyncMessages[0] as { frame: { weight: number } }).frame.weight).toBeCloseTo(0.9, 5);
  });

  it("refuses TTS forwarding when no hologram window is open", () => {
    const { result } = renderHook(() => useHologramBridge());

    expect(result.current.handleTtsResult(makeTtsResult(new ArrayBuffer(8)))).toBe(false);
  });

  it("sends model updates to an open hologram window", async () => {
    const popup = makePopup();
    openHldHologramWindow.mockResolvedValue(popup);
    const { result } = renderHook(() => useHologramBridge());

    await act(async () => {
      await result.current.open(undefined);
    });
    dispatchReady(popup);

    let updated = false;
    await act(async () => {
      updated = await result.current.updateModel("https://models.example.test/avatar.vrm");
    });

    expect(updated).toBe(true);
    expect(popup.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ origin: hologramMessageOrigin, kind: "model-url", url: "https://models.example.test/avatar.vrm" }),
      window.location.origin,
      [],
    );
  });

  it("closes the popup and stops forwarding on close", async () => {
    const popup = makePopup();
    openHldHologramWindow.mockResolvedValue(popup);
    const { result } = renderHook(() => useHologramBridge());

    await act(async () => {
      await result.current.open(undefined);
    });
    dispatchReady(popup);
    expect(result.current.hologramActive).toBe(true);

    const logSpy = vi.spyOn(console, "log");
    act(() => {
      result.current.close();
    });

    expect(popup.close).toHaveBeenCalled();
    expect(result.current.hologramActive).toBe(false);
    expect(result.current.handleTtsResult(makeTtsResult(new ArrayBuffer(8)))).toBe(false);
    const closeLogs = logSpy.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes("holo-bridge window close"));
    expect(closeLogs.some((line) => line.includes("close requested"))).toBe(true);
    logSpy.mockRestore();
  });

  it("ignores a concurrent open while a window open is already in flight", async () => {
    const popup = makePopup();
    let resolveOpen!: (win: unknown) => void;
    openHldHologramWindow.mockImplementation(
      () => new Promise((resolve) => { resolveOpen = resolve; })
    );
    const { result } = renderHook(() => useHologramBridge());

    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = result.current.open(undefined);
      second = result.current.open(undefined);
    });
    await act(async () => {
      resolveOpen(popup);
      await Promise.all([first, second]);
    });

    expect(openHldHologramWindow).toHaveBeenCalledTimes(1);
  });

  it("logs an updateModel resolve failure for an unloadable blob url", async () => {
    const popup = makePopup();
    openHldHologramWindow.mockResolvedValue(popup);
    const { result } = renderHook(() => useHologramBridge());

    await act(async () => {
      await result.current.open(undefined);
    });
    dispatchReady(popup);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error("blob fetch failed"));
    let updated: boolean | undefined;
    const logSpy = vi.spyOn(console, "log");
    try {
      await act(async () => {
        updated = await result.current.updateModel("blob:broken-model");
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(updated).toBe(false);
    expect(popup.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "model-bytes" }),
      expect.anything(),
      expect.anything(),
    );
    const logs = logSpy.mock.calls.map(([line]) => String(line));
    expect(logs.some((line) => line.includes("holo-bridge updateModel resolve-failed"))).toBe(true);
    logSpy.mockRestore();
  });

  it("logs the byte size and delivery result of an updateModel with bytes", async () => {
    const popup = makePopup();
    openHldHologramWindow.mockResolvedValue(popup);
    const { result } = renderHook(() => useHologramBridge());

    await act(async () => {
      await result.current.open(undefined);
    });
    dispatchReady(popup);

    const bytes = new ArrayBuffer(2048);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response(bytes));
    const logSpy = vi.spyOn(console, "log");
    try {
      await act(async () => {
        await result.current.updateModel("blob:model");
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(popup.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "model-bytes" }),
      window.location.origin,
      [bytes],
    );
    const logs = logSpy.mock.calls.map(([line]) => String(line));
    expect(logs.some((line) => line.includes("holo-bridge updateModel model-bytes bytes=2048 sent=true"))).toBe(true);
    logSpy.mockRestore();
  });
});
