import { beforeEach, describe, expect, it } from "vitest";
import { TIMER_STORE_KEY, timerStore } from "./timerStore";
import type { Timer } from "@/lib/timer/types";

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

function makeTimer(overrides: Partial<Timer> = {}): Timer {
  return {
    id: "timer-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:05:00.000Z",
    durationMs: 300_000,
    status: "running",
    label: "Timer 1",
    labelNumber: 1,
    timezone: "Europe/Paris",
    ...overrides,
  };
}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

describe("timerStore", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(timerStore.load()).toEqual([]);
  });

  it("round-trips timers through the versioned envelope", () => {
    const timers = [makeTimer(), makeTimer({ id: "timer-2", label: "pates", labelNumber: 0 })];
    timerStore.save(timers);

    expect(JSON.parse(store[TIMER_STORE_KEY])).toEqual({ version: 1, timers });
    expect(timerStore.load()).toEqual(timers);
  });

  it("returns an empty list for corrupted JSON", () => {
    store[TIMER_STORE_KEY] = "not-valid-json{{{";
    expect(timerStore.load()).toEqual([]);
  });

  it("returns an empty list for a wrong version or shape", () => {
    store[TIMER_STORE_KEY] = JSON.stringify({ version: 2, timers: [makeTimer()] });
    expect(timerStore.load()).toEqual([]);

    store[TIMER_STORE_KEY] = JSON.stringify([makeTimer()]);
    expect(timerStore.load()).toEqual([]);
  });

  it("drops invalid entries but keeps valid ones", () => {
    store[TIMER_STORE_KEY] = JSON.stringify({
      version: 1,
      timers: [makeTimer(), { id: "broken" }, null, makeTimer({ id: "timer-2" })],
    });

    expect(timerStore.load().map((t) => t.id)).toEqual(["timer-1", "timer-2"]);
  });

  it("clear removes the stored timers", () => {
    timerStore.save([makeTimer()]);
    timerStore.clear();

    expect(store[TIMER_STORE_KEY]).toBeUndefined();
    expect(timerStore.load()).toEqual([]);
  });

  it("never throws when localStorage is unavailable", () => {
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

    expect(() => timerStore.save([makeTimer()])).not.toThrow();
    expect(timerStore.load()).toEqual([]);
    expect(() => timerStore.clear()).not.toThrow();

    Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });
  });
});
