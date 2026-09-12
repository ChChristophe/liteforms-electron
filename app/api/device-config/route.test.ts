import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import { resolveDeviceConfigPath, DEVICE_CONFIG_FILE_NAME } from "@/lib/deviceConfig/deviceConfigFile";

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

function get() {
  return GET();
}

describe("POST /api/device-config (contract v1)", () => {
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
    // Dev fallback (no LITEFORMS_DEVICE_CONFIG_DIR): GET re-delivers it.
    const stored = await (await get()).json();
    expect(stored.config.character.name).toBe("Clawdia");
    expect(stored.config.receivedAt).toBe(json.appliedAt);
  });

  it("is idempotent: the same payload is accepted twice", async () => {
    const first = await post(validPayload);
    const second = await post(validPayload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const stored = await (await get()).json();
    expect(stored.config.avatar.modelRef?.fileName).toBe("lobsterEdit.vrm");
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

describe("GET /api/device-config (durable read)", () => {
  let configDir: string;
  let previousEnv: string | undefined;

  function useTempConfigDir(initialFile?: unknown) {
    configDir = join(tmpdir(), `liteforms-device-config-route-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(configDir, { recursive: true });
    if (initialFile !== undefined) {
      writeFileSync(join(configDir, DEVICE_CONFIG_FILE_NAME), JSON.stringify(initialFile), "utf8");
    }
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

  it("returns {ok, config:null} when the durable file is absent", async () => {
    useTempConfigDir();
    const response = await get();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.config).toBeNull();
  });

  it("POST writes the durable file and GET serves it back with receivedAt", async () => {
    useTempConfigDir();
    const response = await post(validPayload);
    const json = await response.json();

    expect(response.status).toBe(200);
    const stored = await (await get()).json();
    expect(stored.ok).toBe(true);
    expect(stored.config.character.name).toBe("Clawdia");
    expect(stored.config.receivedAt).toBe(json.appliedAt);
  });

  it("serves the file content after a simulated restart (fresh server, file intact)", async () => {
    useTempConfigDir({
      version: 1,
      receivedAt: "2026-09-11T10:00:00.000Z",
      config: validPayload
    });

    // No POST in this test: the route reads the file left by the "previous
    // server process" — the durable read after a restart.
    const stored = await (await get()).json();
    expect(stored.ok).toBe(true);
    expect(stored.config.receivedAt).toBe("2026-09-11T10:00:00.000Z");
    expect(stored.config.character.name).toBe("Clawdia");
  });

  it("returns config:null for a corrupt file (never crashes the route)", async () => {
    useTempConfigDir();
    writeFileSync(resolveDeviceConfigPath(configDir), "{ not json", "utf8");

    const stored = await (await get()).json();
    expect(stored.ok).toBe(true);
    expect(stored.config).toBeNull();
  });
});
