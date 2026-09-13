import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readOrCreateDeviceId, resolveDeviceIdPath } from "./deviceId";

describe("deviceId (persistent appliance identity)", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("generates once on first boot with the contract format", () => {
    dir = mkdtempSync(join(tmpdir(), "liteforms-device-id-"));
    const path = resolveDeviceIdPath(dir);

    const first = readOrCreateDeviceId(path);

    expect(first).toMatch(/^desktop-[0-9a-f]{4}$/);
    // Persisted atomically and readable back.
    expect(JSON.parse(readFileSync(path, "utf8")).deviceId).toBe(first);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it("is stable across re-reads (no regeneration when the file exists)", () => {
    dir = mkdtempSync(join(tmpdir(), "liteforms-device-id-"));
    const path = resolveDeviceIdPath(dir);

    const first = readOrCreateDeviceId(path);
    const second = readOrCreateDeviceId(path);

    expect(second).toBe(first);
  });

  it("regenerates from a corrupt file instead of crashing", () => {
    dir = mkdtempSync(join(tmpdir(), "liteforms-device-id-"));
    const path = resolveDeviceIdPath(dir);
    writeFileSync(path, "{ not json", "utf8");

    const regenerated = readOrCreateDeviceId(path);

    expect(regenerated).toMatch(/^desktop-[0-9a-f]{4}$/);
    expect(JSON.parse(readFileSync(path, "utf8")).deviceId).toBe(regenerated);
  });

  it("regenerates from a malformed file (wrong shape or format)", () => {
    dir = mkdtempSync(join(tmpdir(), "liteforms-device-id-"));
    const path = resolveDeviceIdPath(dir);
    writeFileSync(path, JSON.stringify({ deviceId: "totally-not-desktop-12345" }), "utf8");

    expect(readOrCreateDeviceId(path)).toMatch(/^desktop-[0-9a-f]{4}$/);
  });

  it("returns null (no crash) when the file cannot be written", () => {
    // Read-only-ish target: a path inside a non-existent file (join treats it
    // as a directory that cannot be created by the write).
    dir = mkdtempSync(join(tmpdir(), "liteforms-device-id-"));
    const path = join(dir, "not-a-dir", "device-id.json");

    expect(readOrCreateDeviceId(path)).toBeNull();
  });

  it("two appliances get different ids", () => {
    dir = mkdtempSync(join(tmpdir(), "liteforms-device-id-"));
    const other = mkdtempSync(join(tmpdir(), "liteforms-device-id-"));
    const idA = readOrCreateDeviceId(resolveDeviceIdPath(dir));
    const idB = readOrCreateDeviceId(resolveDeviceIdPath(other));
    rmSync(other, { recursive: true, force: true });

    expect(idA).not.toBe(idB);
  });
});
