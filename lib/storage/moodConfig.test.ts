import { beforeEach, describe, expect, it } from "vitest";
import {
  MOOD_CONFIG_KEY,
  clearMoodConfig,
  loadMoodConfig,
  saveMoodConfig
} from "./moodConfig";

// Lightweight localStorage stub
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  }
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

describe("loadMoodConfig", () => {
  it("returns null when nothing is stored", () => {
    expect(loadMoodConfig()).toBeNull();
  });

  it("returns null for corrupted JSON", () => {
    store[MOOD_CONFIG_KEY] = "not-json{{{";
    expect(loadMoodConfig()).toBeNull();
  });

  it("returns null when version field is wrong", () => {
    store[MOOD_CONFIG_KEY] = JSON.stringify({ version: 2, mood: "happy" });
    expect(loadMoodConfig()).toBeNull();
  });

  it("returns null when mood is not a known preset", () => {
    store[MOOD_CONFIG_KEY] = JSON.stringify({ version: 1, mood: "ecstatic" });
    expect(loadMoodConfig()).toBeNull();
  });

  it("accepts a null mood", () => {
    store[MOOD_CONFIG_KEY] = JSON.stringify({ version: 1, mood: null });
    expect(loadMoodConfig()).toEqual({ version: 1, mood: null });
  });
});

describe("saveMoodConfig + loadMoodConfig round-trip", () => {
  it("persists and restores every preset", () => {
    for (const mood of ["happy", "sad", "angry", "surprised", "relaxed"] as const) {
      saveMoodConfig({ mood });
      expect(loadMoodConfig()).toEqual({ version: 1, mood });
    }
  });

  it("overwrites an existing entry on repeated saves", () => {
    saveMoodConfig({ mood: "happy" });
    saveMoodConfig({ mood: null });

    expect(loadMoodConfig()!.mood).toBeNull();
  });

  it("silently ignores localStorage failures without throwing", () => {
    const failing = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
      removeItem: () => {
        throw new Error("storage unavailable");
      }
    };
    Object.defineProperty(globalThis, "localStorage", { value: failing, writable: true });

    expect(() => saveMoodConfig({ mood: "happy" })).not.toThrow();
    expect(loadMoodConfig()).toBeNull();
    expect(() => clearMoodConfig()).not.toThrow();

    Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });
  });
});

describe("clearMoodConfig", () => {
  it("removes the stored config so loadMoodConfig returns null", () => {
    saveMoodConfig({ mood: "sad" });

    clearMoodConfig();

    expect(loadMoodConfig()).toBeNull();
  });

  it("does not throw when nothing was stored", () => {
    expect(() => clearMoodConfig()).not.toThrow();
  });
});
