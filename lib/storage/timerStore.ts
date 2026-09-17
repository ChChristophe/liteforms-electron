import type { Timer } from "@/lib/timer/types";

export const TIMER_STORE_KEY = "liteforms.timers";

/** Persistence seam for TimerManager; the real implementation is localStorage-backed. */
export type TimerStore = {
  save(timers: Timer[]): void;
  load(): Timer[];
  clear(): void;
};

type TimerStoreData = {
  version: 1;
  timers: Timer[];
};

export const timerStore: TimerStore = {
  save(timers) {
    try {
      const data: TimerStoreData = { version: 1, timers };
      localStorage.setItem(TIMER_STORE_KEY, JSON.stringify(data));
    } catch {
      // localStorage may be unavailable in private browsing or when quota is exceeded.
    }
  },

  load() {
    try {
      const raw = localStorage.getItem(TIMER_STORE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!isTimerStoreData(parsed)) return [];
      return parsed.timers.filter(isTimer);
    } catch {
      return [];
    }
  },

  clear() {
    try {
      localStorage.removeItem(TIMER_STORE_KEY);
    } catch {
      // ignore
    }
  }
};

function isTimerStoreData(value: unknown): value is TimerStoreData {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && Array.isArray(v.timers);
}

function isTimer(value: unknown): value is Timer {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.expiresAt === "string" &&
    typeof v.durationMs === "number" &&
    Number.isFinite(v.durationMs) &&
    Number.isFinite(v.labelNumber) &&
    (v.status === "running" || v.status === "completed" || v.status === "cancelled") &&
    typeof v.label === "string" &&
    typeof v.timezone === "string"
  );
}
