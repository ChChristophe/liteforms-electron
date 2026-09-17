import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimerManager } from "./timerManager";
import type { TimerStore } from "@/lib/storage/timerStore";
import type { Timer, TimerStatusResult } from "./types";

function createMemoryStore(initial: Timer[] = []): TimerStore & { snapshot(): Timer[] } {
  let timers = initial.map((t) => ({ ...t }));
  return {
    save(next) {
      timers = next.map((t) => ({ ...t }));
    },
    load() {
      return timers.map((t) => ({ ...t }));
    },
    clear() {
      timers = [];
    },
    snapshot() {
      return timers.map((t) => ({ ...t }));
    },
  };
}

function makeTimer(overrides: Partial<Timer> = {}): Timer {
  const now = Date.now();
  return {
    id: "seeded-id",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    durationMs: 60_000,
    status: "running",
    label: "Timer 1",
    labelNumber: 1,
    timezone: "Europe/Paris",
    ...overrides,
  };
}

function statusOf(mgr: TimerManager, id: string): TimerStatusResult {
  return mgr.getTimerStatus(id) as TimerStatusResult;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TimerManager", () => {
  it("creates a timer with an auto-generated label", () => {
    const store = createMemoryStore();
    const mgr = new TimerManager(store);

    const result = mgr.createTimer({ durationMs: 300_000 });

    expect(result.success).toBe(true);
    expect(result.timer_id).toBeTruthy();
    expect(result.label).toBe("Timer 1");
    expect(result.duration_minutes).toBe(5);
    expect(result.expires_at).toBe(new Date(Date.now() + 300_000).toISOString());
    expect(result.timezone).toBeTruthy();
    expect(store.snapshot()[0].labelNumber).toBe(1);
  });

  it("creates a timer with a custom label without consuming a number", () => {
    const store = createMemoryStore();
    const mgr = new TimerManager(store);

    const result = mgr.createTimer({ durationMs: 600_000, label: "pates" });

    expect(result.label).toBe("pates");
    expect(store.snapshot()[0].labelNumber).toBe(0);
  });

  it("auto-generates sequential labels and skips custom ones", () => {
    const mgr = new TimerManager(createMemoryStore());

    mgr.createTimer({ durationMs: 60_000 });
    vi.advanceTimersByTime(10);
    mgr.createTimer({ durationMs: 60_000 });
    vi.advanceTimersByTime(10);
    mgr.createTimer({ durationMs: 60_000, label: "custom" });
    vi.advanceTimersByTime(10);
    const last = mgr.createTimer({ durationMs: 60_000 });

    expect(last.label).toBe("Timer 3");
    const labels = mgr.listTimers().timers.map((t) => t.label);
    expect(labels[0]).toBe("Timer 3");
    expect(labels[3]).toBe("Timer 1");
    expect(labels).toContain("custom");
  });

  it("schedules a timeout for the timer", () => {
    const mgr = new TimerManager(createMemoryStore());

    mgr.createTimer({ durationMs: 120_000 });

    expect(vi.getTimerCount()).toBe(1);
  });

  it("returns status with remaining time calculated from expiresAt", () => {
    const mgr = new TimerManager(createMemoryStore());
    const result = mgr.createTimer({ durationMs: 300_000 });

    const status = statusOf(mgr, result.timer_id);

    expect(status.remaining_seconds).toBe(300);
    expect(status.remaining_human).toBe("5 minutes");
  });

  it("returns error when no timers are active", () => {
    const mgr = new TimerManager(createMemoryStore());

    expect(mgr.getTimerStatus()).toEqual({ error: "Aucun timer actif" });
  });

  it("returns the single running timer when no ID is specified", () => {
    const mgr = new TimerManager(createMemoryStore());
    const created = mgr.createTimer({ durationMs: 60_000 });

    expect(mgr.getTimerStatus()).toHaveProperty("timer_id", created.timer_id);
  });

  it("returns the most recent timer when multiple are active and no ID is specified", () => {
    const mgr = new TimerManager(createMemoryStore());
    mgr.createTimer({ durationMs: 60_000 });
    vi.advanceTimersByTime(10);
    const second = mgr.createTimer({ durationMs: 120_000 });

    expect((mgr.getTimerStatus() as TimerStatusResult).timer_id).toBe(second.timer_id);
  });

  it("cancels a timer, clears the timeout and marks it cancelled", () => {
    const mgr = new TimerManager(createMemoryStore());
    const result = mgr.createTimer({ durationMs: 60_000 });

    const cancel = mgr.cancelTimer(result.timer_id);

    expect(cancel).toEqual({ success: true, timer_id: result.timer_id, label: "Timer 1" });
    expect(vi.getTimerCount()).toBe(0);
    expect(statusOf(mgr, result.timer_id).status).toBe("cancelled");
    expect(statusOf(mgr, result.timer_id).remaining_human).toBe("Annulé");
  });

  it("cancels the single timer when no ID is specified", () => {
    const mgr = new TimerManager(createMemoryStore());
    const result = mgr.createTimer({ durationMs: 60_000 });

    const cancel = mgr.cancelTimer();

    expect(cancel).toEqual({ success: true, timer_id: result.timer_id, label: "Timer 1" });
  });

  it("returns error when cancelling with multiple timers and no ID", () => {
    const mgr = new TimerManager(createMemoryStore());
    mgr.createTimer({ durationMs: 60_000 });
    mgr.createTimer({ durationMs: 120_000 });

    const cancel = mgr.cancelTimer();

    expect(cancel).toHaveProperty("success", false);
    expect((cancel as { error: string }).error).toContain("Plusieurs timers");
  });

  it("lists all timers sorted by createdAt descending", () => {
    const mgr = new TimerManager(createMemoryStore());
    const first = mgr.createTimer({ durationMs: 60_000 });
    vi.advanceTimersByTime(10);
    const second = mgr.createTimer({ durationMs: 120_000, label: "custom" });
    vi.advanceTimersByTime(10);
    const third = mgr.createTimer({ durationMs: 60_000 });

    const list = mgr.listTimers();

    expect(list.count).toBe(3);
    expect(list.active_count).toBe(3);
    expect(list.timers.map((t) => t.timer_id)).toEqual([third.timer_id, second.timer_id, first.timer_id]);
  });

  it("notifies subscribers with the expiration payload", () => {
    const store = createMemoryStore();
    const mgr = new TimerManager(store);
    const seen: unknown[] = [];
    mgr.onExpired((detail) => seen.push(detail));

    const created = mgr.createTimer({ durationMs: 300_000 });
    const createdAt = store.snapshot()[0].createdAt;
    vi.advanceTimersByTime(300_000);

    expect(seen).toEqual([
      {
        timer_id: created.timer_id,
        label: "Timer 1",
        duration_minutes: 5,
        created_at: createdAt,
        expires_at: created.expires_at,
      },
    ]);
    expect(store.snapshot()[0].status).toBe("completed");
    expect(statusOf(mgr, created.timer_id).status).toBe("completed");
    expect(statusOf(mgr, created.timer_id).remaining_seconds).toBe(-1);
    expect(statusOf(mgr, created.timer_id).remaining_human).toBe("Terminé");
  });

  it("stops notifying after unsubscription", () => {
    const mgr = new TimerManager(createMemoryStore());
    const listener = vi.fn();
    const unsubscribe = mgr.onExpired(listener);
    unsubscribe();

    mgr.createTimer({ durationMs: 1_000 });
    vi.advanceTimersByTime(1_000);

    expect(listener).not.toHaveBeenCalled();
  });

  it("dispose clears timeouts but keeps persisted state", () => {
    const store = createMemoryStore();
    const mgr = new TimerManager(store);
    mgr.createTimer({ durationMs: 300_000 });

    mgr.dispose();

    expect(vi.getTimerCount()).toBe(0);
    expect(store.snapshot()).toHaveLength(1);

    const reopened = new TimerManager(store);
    reopened.load();
    expect(reopened.listTimers().count).toBe(1);
  });

  it("re-arms a running timer across a dispose/load cycle (StrictMode)", () => {
    const store = createMemoryStore([
      makeTimer({
        id: "armed-id",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        durationMs: 300_000,
      }),
    ]);
    const mgr = new TimerManager(store);
    const listener = vi.fn();
    mgr.onExpired(listener);

    mgr.load();
    mgr.dispose();
    expect(vi.getTimerCount()).toBe(0);

    mgr.load();
    vi.advanceTimersByTime(300_000);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ timer_id: "armed-id", label: "Timer 1", duration_minutes: 5 })
    );
    expect(statusOf(mgr, "armed-id").status).toBe("completed");
    expect(store.snapshot()[0].status).toBe("completed");
  });

  it("dispose keeps the in-memory and persisted timers queryable", () => {
    const store = createMemoryStore();
    const mgr = new TimerManager(store);
    const created = mgr.createTimer({ durationMs: 300_000 });

    mgr.dispose();

    expect(mgr.listTimers().count).toBe(1);
    expect(mgr.listTimers().active_count).toBe(1);
    expect(statusOf(mgr, created.timer_id).status).toBe("running");
    expect(store.snapshot()).toHaveLength(1);
    expect(store.snapshot()[0].status).toBe("running");
  });

  it("dispose keeps expiry listeners subscribed", () => {
    const store = createMemoryStore([
      makeTimer({
        id: "kept-id",
        expiresAt: new Date(Date.now() + 1_000).toISOString(),
        durationMs: 1_000,
      }),
    ]);
    const mgr = new TimerManager(store);
    const listener = vi.fn();
    mgr.onExpired(listener);

    mgr.load();
    mgr.dispose();
    mgr.load();
    vi.advanceTimersByTime(1_000);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not re-arm or double-fire when load is called twice without dispose", () => {
    const store = createMemoryStore([
      makeTimer({
        id: "once-id",
        expiresAt: new Date(Date.now() + 1_000).toISOString(),
        durationMs: 1_000,
      }),
    ]);
    const mgr = new TimerManager(store);
    const listener = vi.fn();
    mgr.onExpired(listener);

    mgr.load();
    mgr.load();
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(1_000);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("persists created timers", () => {
    const store = createMemoryStore();
    const mgr = new TimerManager(store);

    mgr.createTimer({ durationMs: 60_000 });
    mgr.createTimer({ durationMs: 120_000, label: "pates" });

    expect(store.snapshot()).toHaveLength(2);
  });

  it("recovers expired timers on load and notifies", () => {
    const store = createMemoryStore([
      makeTimer({
        id: "expired-id",
        createdAt: new Date(Date.now() - 120_000).toISOString(),
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    ]);
    const mgr = new TimerManager(store);
    const listener = vi.fn();
    mgr.onExpired(listener);

    mgr.load();

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ timer_id: "expired-id", label: "Timer 1", duration_minutes: 1 })
    );
    expect(statusOf(mgr, "expired-id").status).toBe("completed");
    expect(store.snapshot()[0].status).toBe("completed");
  });

  it("reschedules future timers on load", () => {
    const store = createMemoryStore([
      makeTimer({
        id: "future-id",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        durationMs: 300_000,
      }),
    ]);
    const mgr = new TimerManager(store);

    mgr.load();

    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(299_999);
    expect(statusOf(mgr, "future-id").status).toBe("running");
    vi.advanceTimersByTime(1);
    expect(statusOf(mgr, "future-id").status).toBe("completed");
  });

  it("does not load twice", () => {
    const store = createMemoryStore([makeTimer({ expiresAt: new Date(Date.now() + 60_000).toISOString() })]);
    const mgr = new TimerManager(store);

    mgr.load();
    mgr.load();

    expect(vi.getTimerCount()).toBe(1);
  });

  it("starts empty without crashing when the store yields nothing", () => {
    const mgr = new TimerManager(createMemoryStore());

    expect(() => mgr.load()).not.toThrow();
    expect(mgr.listTimers().count).toBe(0);
  });

  it("derives the label counter from loaded running timers", () => {
    const store = createMemoryStore([makeTimer({ id: "t5", label: "Timer 5", labelNumber: 5 })]);
    const mgr = new TimerManager(store);

    mgr.load();

    expect(mgr.createTimer({ durationMs: 60_000 }).label).toBe("Timer 6");
  });

  it("restarts labels at 1 when no running timer is restored", () => {
    const store = createMemoryStore([
      makeTimer({ id: "done", label: "Timer 5", labelNumber: 5, status: "completed" }),
    ]);
    const mgr = new TimerManager(store);

    mgr.load();

    expect(mgr.createTimer({ durationMs: 60_000 }).label).toBe("Timer 1");
  });

  it("ignores non-running timers in the status query", () => {
    const mgr = new TimerManager(createMemoryStore());
    const result = mgr.createTimer({ durationMs: 60_000 });
    mgr.cancelTimer(result.timer_id);

    expect(mgr.getTimerStatus()).toEqual({ error: "Aucun timer actif" });
  });

  it("returns error when getting status of an unknown timer", () => {
    const mgr = new TimerManager(createMemoryStore());

    expect(mgr.getTimerStatus("nonexistent")).toEqual({ error: "Timer introuvable" });
  });

  it("returns error when cancelling an unknown timer", () => {
    const mgr = new TimerManager(createMemoryStore());

    expect(mgr.cancelTimer("nonexistent")).toEqual({ success: false, error: "Timer introuvable" });
  });

  it("returns error when cancelling a non-running timer", () => {
    const mgr = new TimerManager(createMemoryStore());
    const result = mgr.createTimer({ durationMs: 60_000 });
    mgr.cancelTimer(result.timer_id);

    expect(mgr.cancelTimer(result.timer_id)).toEqual({ success: false, error: "Ce timer n'est pas actif" });
  });
});
