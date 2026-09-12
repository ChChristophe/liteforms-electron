import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDeviceConfigFile, resolveDeviceConfigPath, saveDeviceConfigFile } from "./deviceConfigFile";
import type { PocDeviceConfig } from "./pocConfig";

const config: PocDeviceConfig = {
  configVersion: "1.0",
  character: { name: "Clawdia", pronouns: "SHE", personality: "Curieuse.", greeting: "Salut !" },
  avatar: { modelRef: { id: "lobsterEdit", fileName: "lobsterEdit.vrm", hash: null } },
  environment: { alcoveColor: "#4a90d9" },
  providers: {
    llm: { provider: "openai", model: "gpt-5.5", endpoint: "https://api.openai.com/v1", voiceId: null },
    tts: { provider: "elevenlabs", model: "eleven_flash_v2_5", endpoint: "https://api.elevenlabs.io/v1", voiceId: "CwhRBWXzGAHq8TQ4Fs17" },
    stt: { provider: "deepgram", model: "nova-3", endpoint: "https://api.deepgram.com/v1", voiceId: null }
  }
};

let dir: string | null = null;

function tempDir(): string {
  dir = join(tmpdir(), `liteforms-device-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = null;
  }
});

describe("deviceConfigFile", () => {
  it("save/load roundtrip preserves the config and receivedAt", () => {
    const path = resolveDeviceConfigPath(tempDir());
    expect(saveDeviceConfigFile(path, config, "2026-09-12T10:00:00.000Z")).toBe(true);

    const loaded = loadDeviceConfigFile(path);
    expect(loaded).not.toBeNull();
    expect(loaded?.version).toBe(1);
    expect(loaded?.receivedAt).toBe("2026-09-12T10:00:00.000Z");
    expect(loaded?.config).toEqual(config);
  });

  it("writes atomically: tmp file is renamed away, only the target remains", () => {
    const path = resolveDeviceConfigPath(tempDir());
    saveDeviceConfigFile(path, config, "2026-09-12T10:00:00.000Z");

    expect(existsSync(`${path}.tmp`)).toBe(false);
    expect(existsSync(path)).toBe(true);
    // The target is a complete JSON envelope, not a partial write.
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ version: 1 });
  });

  it("overwrites an existing file (idempotent re-save)", () => {
    const path = resolveDeviceConfigPath(tempDir());
    saveDeviceConfigFile(path, config, "2026-09-12T10:00:00.000Z");
    saveDeviceConfigFile(path, config, "2026-09-12T11:00:00.000Z");

    expect(loadDeviceConfigFile(path)?.receivedAt).toBe("2026-09-12T11:00:00.000Z");
  });

  it("returns null for a missing file", () => {
    const path = resolveDeviceConfigPath(tempDir());
    expect(loadDeviceConfigFile(path)).toBeNull();
  });

  it("returns null for a corrupt file", () => {
    const path = resolveDeviceConfigPath(tempDir());
    writeFileSync(path, "{ not json", "utf8");
    expect(loadDeviceConfigFile(path)).toBeNull();
  });

  it("returns null for a structurally invalid envelope", () => {
    const path = resolveDeviceConfigPath(tempDir());
    writeFileSync(path, JSON.stringify({ version: 2, receivedAt: "x", config }), "utf8");
    expect(loadDeviceConfigFile(path)).toBeNull();
  });

  it("returns null when the stored config no longer passes the contract validation", () => {
    const path = resolveDeviceConfigPath(tempDir());
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        receivedAt: "2026-09-12T10:00:00.000Z",
        config: { ...config, character: { ...config.character, pronouns: "IT" } }
      }),
      "utf8"
    );
    expect(loadDeviceConfigFile(path)).toBeNull();
  });
});
