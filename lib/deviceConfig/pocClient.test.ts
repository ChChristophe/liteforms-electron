import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEVICE_CONFIG_STORAGE_KEY,
  applyPocDeviceConfig,
  ingestPocPendingPayload,
  migrateStoredConfigToServer,
  readStoredPocDeviceConfig,
  type PocApplyHooks,
} from "./pocClient";
import { loadCharacterConfig } from "@/lib/storage/characterConfig";
import { loadSessionConfig, saveSessionConfig } from "@/lib/storage/sessionConfig";
import { loadMoodConfig } from "@/lib/storage/moodConfig";
import { loadPoseConfig } from "@/lib/storage/poseConfig";
import type { AvatarPoseConfig } from "@/lib/avatar/avatarPose";
import type { StoredVrm, VrmRepository } from "@/lib/storage/vrmRepository";

const LEGACY_DEVICE_CONFIG_KEY = "liteforms.poc.deviceConfig";

const validPayload = {
  configVersion: "1.0" as const,
  character: { name: "Clawdia", pronouns: "SHE" as const, personality: "Curieuse.", greeting: "Salut !" },
  avatar: {
    mood: "happy",
    modelRef: { id: "lobsterEdit", fileName: "lobsterEdit.vrm", hash: null },
    pose: { avatarYaw: 0, alcoveYaw: 0, zoom: 1, depth: 0 }
  },
  environment: { alcoveColor: "#4a90d9" },
  providers: {
    llm: { provider: "openai", model: "gpt-5.5", endpoint: "https://api.openai.com/v1", voiceId: null },
    tts: { provider: "elevenlabs", model: "eleven_flash_v2_5", endpoint: "https://api.elevenlabs.io/v1", voiceId: "CwhRBWXzGAHq8TQ4Fs17" },
    stt: { provider: "deepgram", model: "nova-3", endpoint: "https://api.deepgram.com/v1", voiceId: null }
  }
};

// Lightweight localStorage stub (same style as lib/storage tests)
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  }
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });

function createHooks(overrides?: Partial<PocApplyHooks>): {
  hooks: PocApplyHooks;
  characters: object[];
  sessions: object[];
  models: StoredVrm[];
  moods: (string | null)[];
  poses: AvatarPoseConfig[];
  wakeWords: (string | null)[];
} {
  const characters: object[] = [];
  const sessions: object[] = [];
  const models: StoredVrm[] = [];
  const moods: (string | null)[] = [];
  const poses: AvatarPoseConfig[] = [];
  const wakeWords: (string | null)[] = [];
  const vrm: StoredVrm = { arrayBuffer: new ArrayBuffer(1), fileName: "lobsterEdit.vrm" };
  const repo: VrmRepository = {
    load: () => Promise.resolve(vrm),
    save: () => Promise.resolve(),
    clear: () => Promise.resolve()
  };
  return {
    characters,
    sessions,
    models,
    moods,
    poses,
    wakeWords,
    hooks: {
      setCharacter: (c) => characters.push(c),
      onSessionConfig: (s) => sessions.push(s),
      onVrmModel: (v) => models.push(v),
      getVrmRepository: () => repo,
      onMoodPreset: (m) => moods.push(m),
      onPose: (p) => poses.push(p),
      onWakeWord: (m) => wakeWords.push(m),
      ...overrides
    }
  };
}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

describe("POC renderer apply (Phase B §12.2)", () => {
  it("writes liteforms.deviceConfig on ingest and the payload stays readable", async () => {
    const { hooks, sessions } = createHooks();

    await ingestPocPendingPayload({ ...validPayload, receivedAt: "2026-09-12T15:30:00Z" }, hooks);

    expect(sessions).toHaveLength(1);
    const raw = store[DEVICE_CONFIG_STORAGE_KEY];
    expect(typeof raw).toBe("string");
    const stored = readStoredPocDeviceConfig();
    expect(stored?.receivedAt).toBe("2026-09-12T15:30:00Z");
    expect(stored?.character.name).toBe("Clawdia");
    expect(stored?.environment.alcoveColor).toBe("#4a90d9");
    expect(stored?.providers.stt.provider).toBe("deepgram");
  });

  it("applies validated blocks via the existing store paths", async () => {
    const { hooks, characters, models } = createHooks();

    const result = await applyPocDeviceConfig({ ...validPayload, receivedAt: "r1" }, hooks);

    expect(result.warnings).not.toContainEqual(
      "avatar.mood accepted but not applied in this POC (mood port pending)"
    );
    expect(result.applied).toContain("mood");
    expect(characters).toHaveLength(1);
    expect(characters[0]).toMatchObject({ name: "Clawdia", pronouns: "SHE" });
    expect(models[0]?.fileName).toBe("lobsterEdit.vrm");

    expect(loadCharacterConfig()).toMatchObject({ name: "Clawdia", pronouns: "SHE", personality: "Curieuse." });

    const session = loadSessionConfig();
    const asr = session?.asr as { baseUrl?: string };
    const tts = session?.tts as { baseUrl?: string; voiceId?: string };
    // stt -> asr, endpoint -> baseUrl, voiceId -> the provider's voice
    expect(session?.asr.provider).toBe("deepgram");
    expect(asr.baseUrl).toBe("https://api.deepgram.com/v1");
    expect(tts.baseUrl).toBe("https://api.elevenlabs.io/v1");
    expect(tts.voiceId).toBe("CwhRBWXzGAHq8TQ4Fs17");
    expect(session?.llm).toMatchObject({ provider: "openai", baseUrl: "https://api.openai.com/v1" });
  });

  it("calls the mood hook and writes the moodConfig store (null resets)", async () => {
    const { hooks, moods } = createHooks();

    const result = await applyPocDeviceConfig(
      { ...validPayload, receivedAt: "r-mood" },
      hooks
    );
    expect(result.applied).toContain("mood");
    expect(moods).toEqual(["happy"]);
    expect(loadMoodConfig()).toEqual({ version: 1, mood: "happy" });

    const cleared = await applyPocDeviceConfig(
      { ...validPayload, receivedAt: "r-mood2", avatar: { ...validPayload.avatar, mood: null as unknown as string } },
      hooks
    );
    expect(cleared.applied).toContain("mood");
    expect(moods).toEqual(["happy", null]);
    expect(loadMoodConfig()).toEqual({ version: 1, mood: null });
  });

  it("calls the pose hook and writes the poseConfig store (defaults filled)", async () => {
    const { hooks, poses } = createHooks();

    const result = await applyPocDeviceConfig({ ...validPayload, receivedAt: "r-pose" }, hooks);

    expect(result.applied).toContain("pose");
    expect(result.warnings).not.toContainEqual(expect.stringMatching(/pose.*not applied/i));
    expect(poses).toEqual([{ avatarYaw: 0, alcoveYaw: 0, zoom: 1, depth: 0 }]);
    expect(loadPoseConfig()).toEqual({ version: 1, pose: { avatarYaw: 0, alcoveYaw: 0, zoom: 1, depth: 0 } });

    const changed = await applyPocDeviceConfig(
      {
        ...validPayload,
        receivedAt: "r-pose2",
        avatar: { ...validPayload.avatar, pose: { avatarYaw: 0.5, alcoveYaw: -0.3, zoom: 2, depth: 0.1 } }
      },
      hooks
    );
    expect(changed.applied).toContain("pose");
    expect(loadPoseConfig()?.pose).toEqual({ avatarYaw: 0.5, alcoveYaw: -0.3, zoom: 2, depth: 0.1 });
  });

  it("deduplicates by receivedAt: an already-stored payload is not re-applied", async () => {
    const pending = { ...validPayload, receivedAt: "r2" };
    const { hooks, characters, sessions } = createHooks();

    await ingestPocPendingPayload(pending, hooks);
    await ingestPocPendingPayload(pending, hooks);

    expect(store[DEVICE_CONFIG_STORAGE_KEY]).toContain("r2");
    expect(characters).toHaveLength(1);
    expect(sessions).toHaveLength(1);
  });

  it("keeps the key across a refresh and the stored state can be re-applied at boot", async () => {
    const { hooks, characters } = createHooks();
    await ingestPocPendingPayload({ ...validPayload, receivedAt: "r3" }, hooks);
    const countAfterApply = characters.length;

    // Simulated refresh: only the stored payload survives.
    const bootState = readStoredPocDeviceConfig();
    expect(bootState?.receivedAt).toBe("r3");
    const result = await applyPocDeviceConfig(bootState!, hooks);

    expect(result.applied).toContain("character");
    expect(characters).toHaveLength(countAfterApply + 1);
    expect(readStoredPocDeviceConfig()?.receivedAt).toBe("r3");
  });

  it("warns on a modelRef unknown to both IndexedDB and the VRM library", async () => {
    const { hooks, models, characters } = createHooks();
    const result = await applyPocDeviceConfig(
      {
        ...validPayload,
        receivedAt: "r4",
        avatar: { ...validPayload.avatar, modelRef: { id: "x", fileName: "unknown.vrm", hash: null } }
      },
      hooks
    );

    expect(result.warnings.join(" ")).toMatch(/MODEL_REF_UNKNOWN/);
    expect(models).toHaveLength(0);
    expect(characters).toHaveLength(1);
  });

  it("loads a modelRef matching a library file via /api/device/vrms/file and saves it", async () => {
    const { hooks, models } = createHooks();
    const saved: StoredVrm[] = [];    const fetchMock = vi.fn(() => Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const repo: VrmRepository = {
      load: () => Promise.resolve(null),
      save: (buf, name) => {
        saved.push({ arrayBuffer: buf, fileName: name });
        return Promise.resolve();
      },
      clear: () => Promise.resolve()
    };
    const result = await applyPocDeviceConfig(
      {
        ...validPayload,
        receivedAt: "r6",
        avatar: { ...validPayload.avatar, modelRef: { id: "library", fileName: "library.vrm", hash: null } }
      },
      { ...hooks, getVrmRepository: () => repo }
    );
    vi.unstubAllGlobals();

    expect(result.applied).toContain("vrm");
    expect(result.warnings).not.toContainEqual(expect.stringMatching(/MODEL_REF_UNKNOWN/));
    expect(fetchMock).toHaveBeenCalledWith("/api/device/vrms/file?name=library.vrm", { cache: "no-store" });
    expect(saved[0]).toMatchObject({ fileName: "library.vrm" });
    expect(models).toHaveLength(1);
  });

  it("warns on unknown provider ids and skips the providers block", async () => {
    const { hooks, sessions } = createHooks();
    const result = await applyPocDeviceConfig(
      {
        ...validPayload,
        receivedAt: "r5",
        providers: {
          ...validPayload.providers,
          llm: { ...validPayload.providers.llm, provider: "not-a-real-provider" }
        }
      },
      hooks
    );

    expect(result.warnings.join(" ")).toMatch(/unknown provider id/);
    expect(sessions).toHaveLength(0);
  });
});

describe("realtime voice from device-config (protocol 18/09/2026)", () => {
  const realtimePayload = (provider: "openai-realtime" | "google-live", voiceId: string | null, model = "realtime-model") => ({
    ...validPayload,
    receivedAt: "r-realtime",
    providers: {
      ...validPayload.providers,
      llm: { provider, model, endpoint: "wss://realtime.example/ws", voiceId }
    }
  });

  it("builds realtimeVoice with the model and voice chosen on the Mobile", async () => {
    const { hooks } = createHooks();

    const result = await applyPocDeviceConfig(realtimePayload("openai-realtime", "marin"), hooks);

    expect(result.applied).toContain("providers");
    expect(loadSessionConfig()?.realtimeVoice).toMatchObject({
      provider: "openai-realtime",
      model: "realtime-model",
      voice: "marin",
      websocketUrl: "wss://realtime.example/ws"
    });
  });

  it("falls back to the provider default voice when voiceId is null", async () => {
    const { hooks } = createHooks();

    await applyPocDeviceConfig(realtimePayload("google-live", null, "gemini-live"), hooks);

    expect(loadSessionConfig()?.realtimeVoice).toMatchObject({
      provider: "google-live",
      model: "gemini-live",
      voice: "Kore"
    });
  });

  it("preserves a local credential but never takes one from device-config", async () => {
    saveSessionConfig({
      llm: { provider: "openai-realtime", model: "old", baseUrl: "wss://old" },
      tts: { provider: "kokoro" },
      asr: { provider: "distil-whisper" },
      realtimeVoice: { provider: "openai-realtime", credential: "sk-local", model: "old", voice: "old" }
    });
    const { hooks } = createHooks();

    await applyPocDeviceConfig(realtimePayload("openai-realtime", "marin"), hooks);

    expect(loadSessionConfig()?.realtimeVoice).toMatchObject({
      provider: "openai-realtime",
      credential: "sk-local",
      model: "realtime-model",
      voice: "marin"
    });
  });

  it("keeps the previous realtime voice untouched when llm is not realtime", async () => {
    saveSessionConfig({
      llm: { provider: "openai", model: "gpt-5.5", baseUrl: "https://api.openai.com/v1" },
      tts: { provider: "kokoro" },
      asr: { provider: "distil-whisper" },
      realtimeVoice: { provider: "google-live", credential: "google-key", model: "gemini-live", voice: "Kore" }
    });
    const { hooks } = createHooks();

    await applyPocDeviceConfig({ ...validPayload, receivedAt: "r-nonrealtime" }, hooks);

    expect(loadSessionConfig()?.realtimeVoice).toEqual({
      provider: "google-live",
      credential: "google-key",
      model: "gemini-live",
      voice: "Kore"
    });
  });
});

describe("localStorage -> durable file migration (one-shot, file empty + cache full)", () => {
  it("does nothing when the renderer localStorage is empty", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    await migrateStoredConfigToServer();

    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("re-submits the stored config once via POST /api/device-config", async () => {
    // The previous test ran with an empty localStorage, so the module-level
    // one-shot flag is still unset; this test consumes it (per-file isolation).
    store[DEVICE_CONFIG_STORAGE_KEY] = JSON.stringify({ ...validPayload, receivedAt: "r-mig" });
    const fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    await migrateStoredConfigToServer();
    await migrateStoredConfigToServer();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/device-config");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as { receivedAt?: string; character?: { name?: string } };
    expect(body.receivedAt).toBe("r-mig");
    expect(body.character?.name).toBe("Clawdia");
    vi.unstubAllGlobals();
  });
});

describe("localStorage key rename (liteforms.poc.deviceConfig -> liteforms.deviceConfig)", () => {
  it("imports a legacy cache entry once: reads it, rewrites it, removes the old key", () => {
    store[LEGACY_DEVICE_CONFIG_KEY] = JSON.stringify({ ...validPayload, receivedAt: "r-legacy" });

    const stored = readStoredPocDeviceConfig();

    expect(stored?.receivedAt).toBe("r-legacy");
    expect(store[DEVICE_CONFIG_STORAGE_KEY]).toContain("r-legacy");
    expect(store[LEGACY_DEVICE_CONFIG_KEY]).toBeUndefined();
    // Second read goes through the new key only.
    expect(readStoredPocDeviceConfig()?.receivedAt).toBe("r-legacy");
  });
});

describe("wakeWord from device-config (protocol 18/09/2026)", () => {
  it("calls onWakeWord with the selected model and marks the block applied", async () => {
    const { hooks, wakeWords } = createHooks();

    const result = await applyPocDeviceConfig(
      { ...validPayload, receivedAt: "r-wake", wakeWord: { model: "hey_jarvis" } },
      hooks
    );

    expect(result.applied).toContain("wakeWord");
    expect(wakeWords).toEqual(["hey_jarvis"]);
  });

  it("calls onWakeWord with null when the block disables the wake word", async () => {
    const { hooks, wakeWords } = createHooks();

    await applyPocDeviceConfig(
      { ...validPayload, receivedAt: "r-wake-null", wakeWord: { model: null } },
      hooks
    );

    expect(wakeWords).toEqual([null]);
  });

  it("does not call onWakeWord when the block is absent (local selection survives)", async () => {
    const { hooks, wakeWords } = createHooks();

    const result = await applyPocDeviceConfig({ ...validPayload, receivedAt: "r-wake-absent" }, hooks);

    expect(wakeWords).toEqual([]);
    expect(result.applied).not.toContain("wakeWord");
  });
});
