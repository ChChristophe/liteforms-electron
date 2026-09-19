import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimerStore } from "@/lib/storage/timerStore";
import { TimerManager } from "@/lib/timer/timerManager";
import type { Timer } from "@/lib/timer/types";
import { createToolRegistry, type ToolRegistryDeps } from "./toolRegistry";

function createMemoryStore(initial: Timer[] = []): TimerStore {
  let timers = initial.map((timer) => ({ ...timer }));
  return {
    save(next) {
      timers = next.map((timer) => ({ ...timer }));
    },
    load() {
      return timers.map((timer) => ({ ...timer }));
    },
    clear() {
      timers = [];
    }
  };
}

function createRegistry(overrides: Partial<ToolRegistryDeps> = {}) {
  return createToolRegistry({
    timerManager: new TimerManager(createMemoryStore()),
    now: () => new Date("2026-01-05T14:30:00Z"),
    ...overrides
  });
}

// `Intl` is pinned so time/date assertions are deterministic regardless of the
// machine's locale or timezone; the spy call arguments are asserted separately
// to prove the registry passes the same options as the web routes.
beforeEach(() => {
  vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("14:30");
  // /!\ The registry calls toLocaleDateString weekday-first, then numeric.
  vi.spyOn(Date.prototype, "toLocaleDateString")
    .mockReturnValueOnce("lundi")
    .mockReturnValueOnce("5 janvier 2026");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tool registry", () => {
  it("exposes the shared definitions and instructions", () => {
    const registry = createRegistry();
    expect(registry.definitions.map((tool) => tool.name)).toHaveLength(8);
    expect(registry.instructions).toContain("If you are unsure whether to use a tool, USE IT");
  });

  it("does not touch the network when the registry is built", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      createRegistry();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("routes openclaw_web_search through the injected search dependency", async () => {
    const searchWeb = vi.fn().mockResolvedValue("Il fait 18 degres a Paris.");
    const registry = createRegistry({ searchWeb });
    expect(await registry.execute("openclaw_web_search", JSON.stringify({ query: "  meteo Paris  " }))).toBe(
      "Il fait 18 degres a Paris."
    );
    expect(searchWeb).toHaveBeenCalledWith("meteo Paris");
  });

  it("never throws when the search dependency fails", async () => {
    const registry = createRegistry({ searchWeb: vi.fn().mockRejectedValue(new Error("gateway down")) });
    await expect(registry.execute("openclaw_web_search", JSON.stringify({ query: "news" }))).resolves.toBe(
      "Error executing function"
    );
  });

  it("rejects a missing or empty search query without calling the dependency", async () => {
    const searchWeb = vi.fn();
    const registry = createRegistry({ searchWeb });
    expect(await registry.execute("openclaw_web_search", "{}")).toBe("Error executing function");
    expect(await registry.execute("openclaw_web_search", JSON.stringify({ query: "   " }))).toBe("Error executing function");
    expect(searchWeb).not.toHaveBeenCalled();
  });

  it("formats the current time exactly like the web route", async () => {
    const registry = createRegistry();
    expect(await registry.execute("get_current_time", "{}")).toBe("Il est 14:30.");
    expect(vi.mocked(Date.prototype.toLocaleTimeString)).toHaveBeenCalledWith("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  });

  it("formats the current date with a capitalized day, like the web route", async () => {
    const registry = createRegistry();
    expect(await registry.execute("get_current_date", "{}")).toBe("On est Lundi 5 janvier 2026.");
    expect(vi.mocked(Date.prototype.toLocaleDateString)).toHaveBeenCalledWith("fr-FR", { weekday: "long" });
    expect(vi.mocked(Date.prototype.toLocaleDateString)).toHaveBeenCalledWith("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric"
    });
  });

  it("evaluates calculations, including the postfix percentage cases", async () => {
    const registry = createRegistry();
    const calculate = (expression: string) => registry.execute("calculate", JSON.stringify({ expression }));
    expect(await calculate("200 + 10%")).toBe("Le résultat est 220.");
    expect(await calculate("200 - 10%")).toBe("Le résultat est 180.");
    expect(await calculate("200 * 10%")).toBe("Le résultat est 20.");
  });

  it("relays parser error messages as-is", async () => {
    const registry = createRegistry();
    expect(await registry.execute("calculate", JSON.stringify({ expression: "1 / 0" }))).toBe("Division par zéro");
    expect(await registry.execute("calculate", JSON.stringify({ expression: "" }))).toBe("Expression vide");
  });

  it("reports unknown tools", async () => {
    const registry = createRegistry();
    expect(await registry.execute("does_not_exist", "{}")).toBe("Unknown function: does_not_exist");
  });

  it("returns the generic error for unreadable JSON or a missing field", async () => {
    const registry = createRegistry();
    expect(await registry.execute("calculate", "not-json")).toBe("Error executing function");
    expect(await registry.execute("start_timer", "not-json")).toBe("Error executing function");
    expect(await registry.execute("calculate", "{}")).toBe("Error executing function");
  });

  it("runs a full timer round-trip through the manager", async () => {
    const registry = createRegistry();
    const start = JSON.parse(await registry.execute("start_timer", JSON.stringify({ duration_minutes: 5, label: "pates" })));
    expect(start).toMatchObject({ success: true, label: "pates", duration_minutes: 5 });

    const status = JSON.parse(await registry.execute("get_timer_status", JSON.stringify({ timer_id: start.timer_id })));
    expect(status).toMatchObject({ timer_id: start.timer_id, status: "running", duration_minutes: 5 });

    const cancel = JSON.parse(await registry.execute("cancel_timer", JSON.stringify({ timer_id: start.timer_id })));
    expect(cancel).toEqual({ success: true, timer_id: start.timer_id, label: "pates" });

    const list = JSON.parse(await registry.execute("list_timers", "{}"));
    expect(list).toMatchObject({ count: 1, active_count: 0 });
    expect(list.timers[0].status).toBe("cancelled");
  });

  it("defaults a missing timer duration to one minute like the reference", async () => {
    const registry = createRegistry();
    const result = JSON.parse(await registry.execute("start_timer", "{}"));
    expect(result.duration_minutes).toBe(1);
  });

  it("never throws, even for malformed arguments", async () => {
    const registry = createRegistry();
    await expect(registry.execute("get_current_time", "{{{")).resolves.toBe("Il est 14:30.");
    await expect(registry.execute("list_timers", "{{{")).resolves.toContain("timers");
  });
});
