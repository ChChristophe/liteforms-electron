import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { readPendingConfig } from "@/lib/deviceConfig/pendingConfigStore";
import { loadDeviceConfigFile, resolveDeviceConfigPath } from "@/lib/deviceConfig/deviceConfigFile";
import { GET as getPending } from "../poc/pending-config/route";

const validPayload = {
  configVersion: "1.0",
  character: { name: "Clawdia", pronouns: "SHE", personality: "Curieuse.", greeting: "Salut !" },
  avatar: {
    mood: "happy",
    modelRef: { id: "lobsterEdit", fileName: "lobsterEdit.vrm", hash: null },
    pose: { avatarYaw: 0, zoom: 1, depth: "oops" }
  },
  environment: { alcoveColor: "#4a90d9" },
  providers: {
    llm: { provider: "openai", model: "gpt-5.5", endpoint: "https://api.openai.com/v1", voiceId: null },
    tts: { provider: "elevenlabs", model: "eleven_flash_v2_5", endpoint: "https://api.elevenlabs.io/v1", voiceId: "CwhRBWXzGAHq8TQ4Fs17" },
    stt: { provider: "deepgram", model: "nova-3", endpoint: "https://api.deepgram.com/v1", voiceId: null }
  }
};

function post(body: unknown) {
  return POST(new Request("http://localhost/api/device-config", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" }
  }) as never);
}

describe("POST /api/device-config (contract v1 POC)", () => {
  it("accepts the full contract payload, validates fields and warns on unapplied blocks", async () => {
    const response = await post(validPayload);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.configVersion).toBe("1.0");
    expect(typeof json.appliedAt).toBe("string");
    expect(json.warnings).toEqual(expect.arrayContaining([
      "avatar.mood accepted but not applied in this POC (mood port pending)",
      "pose.depth ignored (not a number)"
    ]));
    const pending = readPendingConfig();
    expect(pending?.character.name).toBe("Clawdia");
    expect(pending?.receivedAt).toBe(json.appliedAt);
  });

  it("is idempotent: the same payload is accepted twice", async () => {
    const first = await post(validPayload);
    const second = await post(validPayload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(readPendingConfig()?.avatar.modelRef?.fileName).toBe("lobsterEdit.vrm");
  });

  it("rejects a wrong config version", async () => {
    const response = await post({ ...validPayload, configVersion: "1.1" });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toMatchObject({ ok: false, code: "UNSUPPORTED_CONFIG_VERSION" });
  });

  it("rejects secrets anywhere in the payload", async () => {
    const response = await post({
      ...validPayload,
      providers: {
        ...validPayload.providers,
        llm: { ...validPayload.providers.llm, credential: "sk-real-key" }
      }
    });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toMatchObject({ ok: false, code: "INVALID_FIELD" });
    expect(json.message).toMatch(/secrets/i);
  });

  it("rejects an invalid pronoun", async () => {
    const response = await post({
      ...validPayload,
      character: { ...validPayload.character, pronouns: "IT" }
    });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toMatchObject({ ok: false, code: "INVALID_FIELD" });
  });
});

describe("GET /api/poc/pending-config", () => {
  it("returns and clears the pending payload", async () => {
    await post(validPayload);
    const first = await getPending(new Request("http://localhost/api/poc/pending-config?consume=1"));
    const firstJson = await first.json();
    const second = await getPending(new Request("http://localhost/api/poc/pending-config"));
    const secondJson = await second.json();

    expect(firstJson.ok).toBe(true);
    expect(firstJson.pending.character.name).toBe("Clawdia");
    expect(secondJson.pending).toBeNull();
  });
});

describe("durable file store (LITEFORMS_DEVICE_CONFIG_DIR set)", () => {
  let configDir: string;
  let previousEnv: string | undefined;

  function useTempConfigDir() {
    configDir = join(tmpdir(), `liteforms-device-config-route-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(configDir, { recursive: true });
    previousEnv = process.env.LITEFORMS_DEVICE_CONFIG_DIR;
    process.env.LITEFORMS_DEVICE_CONFIG_DIR = configDir;
  }

  afterEach(() => {
    if (previousEnv === undefined) {
      delete process.env.LITEFORMS_DEVICE_CONFIG_DIR;
    } else {
      process.env.LITEFORMS_DEVICE_CONFIG_DIR = previousEnv;
    }
    rmSync(configDir, { recursive: true, force: true });
  });

  it("POST writes the durable file and pending-config serves it back from the file", async () => {
    useTempConfigDir();
    const response = await post(validPayload);
    const json = await response.json();

    expect(response.status).toBe(200);
    const filePath = resolveDeviceConfigPath(configDir);
    const stored = loadDeviceConfigFile(filePath);
    expect(stored).not.toBeNull();
    expect(stored?.config.character.name).toBe("Clawdia");
    expect(stored?.receivedAt).toBe(json.appliedAt);

    // consume=1 never deletes the durable file: the renderer deduplicates.
    const pending = await getPending(new Request("http://localhost/api/poc/pending-config?consume=1"));
    const pendingJson = await pending.json();
    expect(pendingJson.durable).toBe(true);
    expect(pendingJson.pending.character.name).toBe("Clawdia");
    expect(loadDeviceConfigFile(filePath)?.receivedAt).toBe(json.appliedAt);
  });

  it("pending-config serves the file content after a simulated restart (memory empty)", async () => {
    useTempConfigDir();
    await post(validPayload);

    // The memory park is process state; after a server restart only the file
    // survives. Simulate it by clearing the park: the file re-delivers.
    const { clearPendingConfig } = await import("@/lib/deviceConfig/pendingConfigStore");
    clearPendingConfig();
    const pending = await getPending(new Request("http://localhost/api/poc/pending-config"));
    const pendingJson = await pending.json();
    expect(pendingJson.pending.character.name).toBe("Clawdia");
    expect(pendingJson.durable).toBe(true);
  });
});
