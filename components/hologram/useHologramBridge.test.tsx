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

    act(() => {
      result.current.close();
    });

    expect(popup.close).toHaveBeenCalled();
    expect(result.current.hologramActive).toBe(false);
    expect(result.current.handleTtsResult(makeTtsResult(new ArrayBuffer(8)))).toBe(false);
  });
});
