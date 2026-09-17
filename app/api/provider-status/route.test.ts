import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";
import { DEVICE_CONFIG_FILE_NAME } from "@/lib/deviceConfig/deviceConfigFile";
import { resolveProviderCredentialsPath, saveCredential } from "@/lib/deviceConfig/providerCredentials";

const deviceConfigPayload = {
  version: 1,
  receivedAt: "2026-09-17T10:00:00.000Z",
  config: {
    configVersion: "1.0",
    character: { name: "Clawdia", pronouns: "SHE", personality: "Curieuse.", greeting: "" },
    avatar: { pose: { avatarYaw: 0, alcoveYaw: 0, zoom: 1, depth: 0 } },
    environment: { alcoveColor: "#4a90d9" },
    providers: {
      llm: { provider: "openai", model: "gpt-5.5", endpoint: "https://api.openai.com/v1", voiceId: null },
      tts: { provider: "elevenlabs", model: "eleven_flash_v2_5", endpoint: "https://api.elevenlabs.io/v1", voiceId: "v" },
      stt: { provider: "deepgram", model: "nova-3", endpoint: "https://api.deepgram.com/v1", voiceId: null }
    }
  }
};

describe("GET /api/provider-status (contract v1)", () => {
  let dir: string;
  let prevConfigDir: string | undefined;
  let prevCredPath: string | undefined;

  beforeEach(() => {
    dir = join(tmpdir(), `liteforms-provider-status-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    prevConfigDir = process.env.LITEFORMS_DEVICE_CONFIG_DIR;
    prevCredPath = process.env.LITEFORMS_CREDENTIALS_PATH;
    process.env.LITEFORMS_DEVICE_CONFIG_DIR = dir;
    process.env.LITEFORMS_CREDENTIALS_PATH = resolveProviderCredentialsPath(dir);
  });

  afterEach(() => {
    if (prevConfigDir === undefined) delete process.env.LITEFORMS_DEVICE_CONFIG_DIR;
    else process.env.LITEFORMS_DEVICE_CONFIG_DIR = prevConfigDir;
    if (prevCredPath === undefined) delete process.env.LITEFORMS_CREDENTIALS_PATH;
    else process.env.LITEFORMS_CREDENTIALS_PATH = prevCredPath;
    rmSync(dir, { recursive: true, force: true });
  });

  function writeDeviceConfig() {
    writeFileSync(join(dir, DEVICE_CONFIG_FILE_NAME), JSON.stringify(deviceConfigPayload), "utf8");
  }

  it("reports each slot's provider and masked credential status", async () => {
    writeDeviceConfig();
    saveCredential(resolveProviderCredentialsPath(dir), "openai", "sk-proj-llm-secret-key-123");
    saveCredential(resolveProviderCredentialsPath(dir), "elevenlabs", "el-secret-key");

    const json = await (await GET()).json();
    expect(json.ok).toBe(true);
    expect(json.providers.llm).toEqual({ provider: "openai", configured: true, maskedKey: "sk-****" });
    expect(json.providers.tts).toEqual({ provider: "elevenlabs", configured: true, maskedKey: "***" });
    expect(json.providers.stt).toEqual({ provider: "deepgram", configured: false, maskedKey: null });

    // The real keys must never leak.
    const raw = JSON.stringify(json);
    expect(raw).not.toContain("sk-proj-llm-secret-key-123");
    expect(raw).not.toContain("el-secret-key");
  });

  it("reports null provider + unconfigured when no device-config exists", async () => {
    const json = await (await GET()).json();
    expect(json.ok).toBe(true);
    expect(json.providers).toEqual({
      llm: { provider: null, configured: false, maskedKey: null },
      tts: { provider: null, configured: false, maskedKey: null },
      stt: { provider: null, configured: false, maskedKey: null }
    });
  });

  it("never exposes a real key in the maskedKey field even for a non-sk token", async () => {
    writeDeviceConfig();
    saveCredential(resolveProviderCredentialsPath(dir), "elevenlabs", "a-very-long-elevenlabs-key-12345");
    const json = await (await GET()).json();
    expect(json.providers.tts.maskedKey).toBe("***");
    expect(JSON.stringify(json)).not.toContain("a-very-long-elevenlabs-key-12345");
  });
});
