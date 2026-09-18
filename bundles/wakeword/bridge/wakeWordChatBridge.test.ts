import { describe, expect, it } from "vitest";
import { shouldTriggerVoiceSession } from "./wakeWordChatBridge";

describe("shouldTriggerVoiceSession", () => {
  const idle = {
    speechStatus: "idle",
    realtimeActive: false,
    streaming: false,
  };

  it("triggers only when the assistant is fully idle", () => {
    expect(shouldTriggerVoiceSession(idle)).toBe(true);
  });

  it("never triggers while a voice/ASR session is active", () => {
    for (const speechStatus of [
      "listening",
      "transcribing",
      "speaking",
      "testing",
      "error",
    ]) {
      expect(
        shouldTriggerVoiceSession({ ...idle, speechStatus }),
        speechStatus,
      ).toBe(false);
    }
  });

  it("triggers when realtime provider is configured but no session is running", () => {
    expect(shouldTriggerVoiceSession({ ...idle, realtimeActive: true })).toBe(true);
  });

  it("never triggers during streaming replies", () => {
    expect(shouldTriggerVoiceSession({ ...idle, streaming: true })).toBe(false);
  });
});
