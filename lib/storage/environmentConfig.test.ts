import { beforeEach, describe, expect, it } from "vitest";
import {
  ENVIRONMENT_CONFIG_KEY,
  clearEnvironmentConfig,
  loadEnvironmentConfig,
  saveEnvironmentConfig
} from "./environmentConfig";

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

describe("loadEnvironmentConfig", () => {
  it("returns null when nothing is stored", () => {
    expect(loadEnvironmentConfig()).toBeNull();
  });

  it("returns null for corrupted JSON", () => {
    store[ENVIRONMENT_CONFIG_KEY] = "not-json{{{";
    expect(loadEnvironmentConfig()).toBeNull();
  });

  it("returns null when version field is wrong", () => {
    store[ENVIRONMENT_CONFIG_KEY] = JSON.stringify({ version: 2, alcoveColor: "#ff0000" });
    expect(loadEnvironmentConfig()).toBeNull();
  });

  it("returns null when alcoveColor is not a strict hex color or null", () => {
    store[ENVIRONMENT_CONFIG_KEY] = JSON.stringify({ version: 1, alcoveColor: "red" });
    expect(loadEnvironmentConfig()).toBeNull();

    store[ENVIRONMENT_CONFIG_KEY] = JSON.stringify({ version: 1, alcoveColor: "#ff00" });
    expect(loadEnvironmentConfig()).toBeNull();

    store[ENVIRONMENT_CONFIG_KEY] = JSON.stringify({ version: 1, alcoveColor: "#FF0000" });
    expect(loadEnvironmentConfig()).toBeNull();
  });

  it("accepts a null alcoveColor", () => {
    store[ENVIRONMENT_CONFIG_KEY] = JSON.stringify({ version: 1, alcoveColor: null });
    expect(loadEnvironmentConfig()).toEqual({ version: 1, alcoveColor: null });
  });
});

describe("saveEnvironmentConfig + loadEnvironmentConfig round-trip", () => {
  it("persists and restores the alcove color", () => {
    saveEnvironmentConfig({ alcoveColor: "#ff0000" });

    const loaded = loadEnvironmentConfig();

    expect(loaded).toEqual({ version: 1, alcoveColor: "#ff0000" });
  });

  it("overwrites an existing entry on repeated saves", () => {
    saveEnvironmentConfig({ alcoveColor: "#ff0000" });
    saveEnvironmentConfig({ alcoveColor: null });

    expect(loadEnvironmentConfig()!.alcoveColor).toBeNull();
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

    expect(() => saveEnvironmentConfig({ alcoveColor: "#ff0000" })).not.toThrow();
    expect(loadEnvironmentConfig()).toBeNull();
    expect(() => clearEnvironmentConfig()).not.toThrow();

    Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });
  });
});

describe("clearEnvironmentConfig", () => {
  it("removes the stored config so loadEnvironmentConfig returns null", () => {
    saveEnvironmentConfig({ alcoveColor: "#00ff00" });

    clearEnvironmentConfig();

    expect(loadEnvironmentConfig()).toBeNull();
  });

  it("does not throw when nothing was stored", () => {
    expect(() => clearEnvironmentConfig()).not.toThrow();
  });
});
