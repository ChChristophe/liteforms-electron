import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { watchCredentialsRemoval } from "./resetRelaunchWatcher";

type TestWatcher = {
  listener: (eventType: string, filename: string | null) => void;
  closed: boolean;
};

function fakeWatch(target: { watcher: TestWatcher | null }) {
  return vi.fn((dir: string, listener: (eventType: string, filename: string | null) => void) => {
    void dir;
    const watcher: TestWatcher = { listener, closed: false };
    target.watcher = watcher;
    // Duck-typed FSWatcher: only close() is consumed by the module.
    return { close: () => { watcher.closed = true; } };
  });
}

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

function newTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "lf-resetwatch-"));
  return tempDir;
}

describe("watchCredentialsRemoval", () => {
  it("fires onRemoved once when the watched file is removed", () => {
    const dir = newTempDir();
    const path = join(dir, "wifi-credentials.json");
    writeFileSync(path, "{}", "utf8");
    const target: { watcher: TestWatcher | null } = { watcher: null };
    const onRemoved = vi.fn();

    watchCredentialsRemoval(dir, "wifi-credentials.json", onRemoved, { startWatching: fakeWatch(target) });
    unlinkSync(path);
    target.watcher!.listener("rename", "wifi-credentials.json");

    expect(onRemoved).toHaveBeenCalledTimes(1);
    expect(target.watcher!.closed).toBe(true);
  });

  it("ignores other files and repeated events", () => {
    const dir = newTempDir();
    writeFileSync(join(dir, "wifi-credentials.json"), "{}", "utf8");
    const target: { watcher: TestWatcher | null } = { watcher: null };
    const onRemoved = vi.fn();

    watchCredentialsRemoval(dir, "wifi-credentials.json", onRemoved, { startWatching: fakeWatch(target) });
    target.watcher!.listener("rename", "device-config.json");
    target.watcher!.listener("rename", "wifi-credentials.json.tmp");
    unlinkSync(join(dir, "wifi-credentials.json"));
    target.watcher!.listener("rename", "wifi-credentials.json");
    target.watcher!.listener("rename", "wifi-credentials.json");

    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it("ignores events while the file still exists (rewrite)", () => {
    const dir = newTempDir();
    const path = join(dir, "wifi-credentials.json");
    writeFileSync(path, "{}", "utf8");
    const target: { watcher: TestWatcher | null } = { watcher: null };
    const onRemoved = vi.fn();

    watchCredentialsRemoval(dir, "wifi-credentials.json", onRemoved, { startWatching: fakeWatch(target) });
    writeFileSync(path, "{\"v\":2}", "utf8");
    target.watcher!.listener("change", "wifi-credentials.json");

    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("fails safe (returns null) when fs.watch is unavailable", () => {
    const onRemoved = vi.fn();
    const watcher = watchCredentialsRemoval(newTempDir(), "wifi-credentials.json", onRemoved, {
      startWatching: () => {
        throw new Error("watch unavailable");
      },
      log: vi.fn()
    });

    expect(watcher).toBeNull();
  });
});
