import { beforeEach, describe, expect, it } from "vitest";
import {
  WAKE_WORD_CUE_TRIGGER_KEY,
  parseWakeWordCueTrigger,
  publishWakeWordCue,
} from "./wakeWordCueTrigger";

// Lightweight localStorage stub
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  },
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

describe("publishWakeWordCue + parseWakeWordCueTrigger round-trip", () => {
  it("publishes and restores a full cue", () => {
    const cue = { flashColor: "#22d3ee", blinkDurationMs: 900, animationUrl: "/animations/Greeting.vrma" };

    publishWakeWordCue(cue);

    const trigger = parseWakeWordCueTrigger(store[WAKE_WORD_CUE_TRIGGER_KEY]);
    expect(trigger).not.toBeNull();
    expect(typeof trigger!.id).toBe("number");
    expect(trigger!.cue).toEqual(cue);
  });

  it("publishes a trigger without a cue", () => {
    publishWakeWordCue();

    const trigger = parseWakeWordCueTrigger(store[WAKE_WORD_CUE_TRIGGER_KEY]);
    expect(trigger).toEqual({ id: trigger!.id });
    expect(trigger!.cue).toBeUndefined();
  });

  it("does not throw when localStorage is unavailable", () => {
    const failing = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
      removeItem: () => {
        throw new Error("storage unavailable");
      },
    };
    Object.defineProperty(globalThis, "localStorage", { value: failing, writable: true });

    expect(() => publishWakeWordCue({ flashColor: "#ffffff" })).not.toThrow();

    Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });
  });
});

describe("parseWakeWordCueTrigger", () => {
  it("returns null for null or empty input", () => {
    expect(parseWakeWordCueTrigger(null)).toBeNull();
    expect(parseWakeWordCueTrigger("")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseWakeWordCueTrigger("not-json{{{")).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    expect(parseWakeWordCueTrigger("42")).toBeNull();
    expect(parseWakeWordCueTrigger("\"abc\"")).toBeNull();
  });

  it("returns null when id is missing or not a finite number", () => {
    expect(parseWakeWordCueTrigger(JSON.stringify({ cue: {} }))).toBeNull();
    expect(parseWakeWordCueTrigger(JSON.stringify({ id: "1" }))).toBeNull();
    expect(parseWakeWordCueTrigger(JSON.stringify({ id: null }))).toBeNull();
  });

  it("returns null when cue is not an object", () => {
    expect(parseWakeWordCueTrigger(JSON.stringify({ id: 1, cue: "x" }))).toBeNull();
  });

  it("drops invalid cue fields but keeps the valid ones", () => {
    const trigger = parseWakeWordCueTrigger(
      JSON.stringify({ id: 1, cue: { flashColor: 5, blinkDurationMs: 900, animationUrl: "ok" } })
    );

    expect(trigger).toEqual({ id: 1, cue: { blinkDurationMs: 900, animationUrl: "ok" } });
  });

  it("tolerates a partial cue", () => {
    expect(parseWakeWordCueTrigger(JSON.stringify({ id: 2, cue: { flashColor: "#aabbcc" } }))).toEqual({
      id: 2,
      cue: { flashColor: "#aabbcc" },
    });
  });
});
