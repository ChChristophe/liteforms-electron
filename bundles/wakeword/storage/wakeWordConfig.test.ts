// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  WAKE_WORD_CUE_MAX_DURATION_MS,
  WAKE_WORD_CUE_MIN_DURATION_MS,
} from "@/lib/avatar/wakeWordCue";
import {
  clearWakeWordConfig,
  loadWakeWordConfig,
  saveWakeWordConfig,
  WAKE_WORD_CONFIG_KEY,
} from "./wakeWordConfig";

describe("wake word config storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("saves and loads a valid selection", () => {
    saveWakeWordConfig({ model: "hey_jarvis" });
    expect(loadWakeWordConfig()).toEqual({ version: 1, model: "hey_jarvis" });
    expect(JSON.parse(localStorage.getItem(WAKE_WORD_CONFIG_KEY)!).version).toBe(1);
  });

  it("persists null (no wake word selected)", () => {
    saveWakeWordConfig({ model: "alexa" });
    saveWakeWordConfig({ model: null });
    expect(loadWakeWordConfig()).toEqual({ version: 1, model: null });
  });

  it("round-trips the visual cue settings", () => {
    saveWakeWordConfig({
      model: "hey_jarvis",
      cueFlashColor: "#ff8800",
      cueBlinkDurationMs: 2000,
      cueAnimationUrl: "/animations/Spin.vrma",
    });
    expect(loadWakeWordConfig()).toEqual({
      version: 1,
      model: "hey_jarvis",
      cueFlashColor: "#ff8800",
      cueBlinkDurationMs: 2000,
      cueAnimationUrl: "/animations/Spin.vrma",
    });
    saveWakeWordConfig({
      model: "hey_jarvis",
      cueFlashColor: "#ff8800",
      cueBlinkDurationMs: 900,
      cueAnimationUrl: "/animations/Greeting.vrma",
    });
    expect(loadWakeWordConfig()?.cueBlinkDurationMs).toBe(900);
    expect(loadWakeWordConfig()?.cueAnimationUrl).toBe("/animations/Greeting.vrma");
  });

  it("accepts legacy configs saved before the cue fields existed", () => {
    localStorage.setItem(WAKE_WORD_CONFIG_KEY, JSON.stringify({ version: 1, model: "alexa" }));
    expect(loadWakeWordConfig()).toEqual({ version: 1, model: "alexa" });
  });

  it("rejects unknown model names", () => {
    localStorage.setItem(WAKE_WORD_CONFIG_KEY, JSON.stringify({ version: 1, model: "ok_nabu" }));
    expect(loadWakeWordConfig()).toBeNull();
  });

  it("rejects invalid cue values", () => {
    const base = { version: 1, model: "alexa" };
    localStorage.setItem(WAKE_WORD_CONFIG_KEY, JSON.stringify({ ...base, cueFlashColor: "red" }));
    expect(loadWakeWordConfig()).toBeNull();
    localStorage.setItem(
      WAKE_WORD_CONFIG_KEY,
      JSON.stringify({ ...base, cueFlashColor: "#22d3ee", cueBlinkDurationMs: 12345 })
    );
    expect(loadWakeWordConfig()).toBeNull();
    localStorage.setItem(
      WAKE_WORD_CONFIG_KEY,
      JSON.stringify({ ...base, cueBlinkDurationMs: WAKE_WORD_CUE_MIN_DURATION_MS - 1 })
    );
    expect(loadWakeWordConfig()).toBeNull();
    localStorage.setItem(
      WAKE_WORD_CONFIG_KEY,
      JSON.stringify({ ...base, cueBlinkDurationMs: WAKE_WORD_CUE_MAX_DURATION_MS + 1 })
    );
    expect(loadWakeWordConfig()).toBeNull();
    localStorage.setItem(
      WAKE_WORD_CONFIG_KEY,
      JSON.stringify({ ...base, cueBlinkDurationMs: 1234.5 })
    );
    expect(loadWakeWordConfig()).toBeNull();
    localStorage.setItem(
      WAKE_WORD_CONFIG_KEY,
      JSON.stringify({ ...base, cueAnimationUrl: "/animations/does-not-exist.vrma" })
    );
    expect(loadWakeWordConfig()).toBeNull();
    // Legacy configs carrying the abandoned greeting-cap field stay valid:
    // validation only rejects known cue fields with bad values.
    localStorage.setItem(
      WAKE_WORD_CONFIG_KEY,
      JSON.stringify({ ...base, cueMaxAnimationMs: 2000 })
    );
    expect(loadWakeWordConfig()?.model).toBe("alexa");
  });

  it("rejects wrong envelope versions and malformed payloads", () => {
    localStorage.setItem(WAKE_WORD_CONFIG_KEY, JSON.stringify({ version: 2, model: "alexa" }));
    expect(loadWakeWordConfig()).toBeNull();
    localStorage.setItem(WAKE_WORD_CONFIG_KEY, "not json");
    expect(loadWakeWordConfig()).toBeNull();
  });

  it("clear removes the stored selection", () => {
    saveWakeWordConfig({ model: "hey_mycroft" });
    clearWakeWordConfig();
    expect(loadWakeWordConfig()).toBeNull();
    expect(localStorage.getItem(WAKE_WORD_CONFIG_KEY)).toBeNull();
  });
});
