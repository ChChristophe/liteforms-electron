"use client";

import { parseDeviceConfig, describeConfigSummary, type PocDeviceConfig, type PocWakeWordCueConfig } from "@/lib/deviceConfig/pocConfig";
import { logDiagnostic } from "@/lib/avatar/diagnosticLog";
import { saveCharacterConfig } from "@/lib/storage/characterConfig";
import { saveEnvironmentConfig } from "@/lib/storage/environmentConfig";
import { saveMoodConfig } from "@/lib/storage/moodConfig";
import { savePoseConfig } from "@/lib/storage/poseConfig";
import { loadSessionConfig, saveSessionConfig, type SessionConfig } from "@/lib/storage/sessionConfig";
import type { AvatarPoseConfig } from "@/lib/avatar/avatarPose";

export type PocSessionConfig = Omit<SessionConfig, "version">;
import type { BaseProviderConfig, LlmProviderId } from "@/lib/llm";
import { LLM_PROVIDER_OPTIONS } from "@/lib/llm/providerOptions";
import type { AsrConfig, AsrProviderId, RealtimeVoiceConfig, TtsConfig, TtsProviderId } from "@/lib/speech";
import type { StoredVrm, VrmRepository } from "@/lib/storage/vrmRepository";
import type { CharacterConfig } from "@/components/chat/ChatPanel";

// POC Phase B — renderer apply (POC.md §12.2, §6.1). Polls the stable
// GET /api/device-config route (the durable file IS the source of truth,
// POC.md §13.6), stores it under the dedicated device-config localStorage key
// (never liteforms.sessionConfig) and projects the validated blocks onto the
// existing stores (character, environment, session providers, local VRM).
// No secrets ever transit here: the server rejects them before storing.

// Renderer cache + dedup key. Renamed from liteforms.poc.deviceConfig when
// the POC pending-config channel was retired (POC.md §13.5 point 3); the old
// key stays readable once for upgrade, then is rewritten under the new name.
export const DEVICE_CONFIG_STORAGE_KEY = "liteforms.deviceConfig";
const LEGACY_DEVICE_CONFIG_STORAGE_KEY = "liteforms.poc.deviceConfig";

const POC_POLL_INTERVAL_MS = 2000;

export type PocReceivedDeviceConfig = PocDeviceConfig & { receivedAt: string };

export type PocApplyHooks = {
  /** React state setter for the ChatPanel character. */
  setCharacter(character: CharacterConfig): void;
  /** Re-mounts the ChatPanel with the new provider configs (bumps chatPanelKey). */
  onSessionConfig(session: PocSessionConfig): void;
  /** Local VRM repository (single "current" record). */
  getVrmRepository(): VrmRepository | null;
  /** Live model URL hook (Blob URL from the stored VRM). */
  onVrmModel(stored: StoredVrm): void;
  /** Live mood preset hook (null resets to the neutral face). */
  onMoodPreset(preset: string | null): void;
  /** Live presentation pose hook (yaw/alcoveYaw/zoom/depth). */
  onPose(pose: AvatarPoseConfig): void;
  /** Live wake word selection hook (null = manual microphone). Optional: an
   * absent wakeWord block never calls it, so the local UI selection survives. */
  onWakeWord?(model: string | null): void;
  /** Live wake word visual-cue hook (only the fields the Mobile sent). Optional:
   * an absent/invalid cue never calls it, so the local cue settings survive. */
  onWakeWordCue?(cue: PocWakeWordCueConfig): void;
};

export type PocApplyResult = { applied: string[]; warnings: string[] };

// Renderer logs flow through the diagnostic bridge into the same
// liteforms-diagnostic.log; keep the shared [poc] <ISO> <message> line format.
// The raw payload is NEVER logged — only receivedAt, block names and warnings.
function pocRendererLog(message: string): void {
  logDiagnostic(`[poc] ${new Date().toISOString()} ${message}`);
}

function readConfigKey(): string | null {
  try {
    const current = localStorage.getItem(DEVICE_CONFIG_STORAGE_KEY);
    if (current !== null) return current;
    // One-time legacy read: use the pre-rename cache and rewrite it under the
    // new key (old entries are never re-imported once the new key exists).
    const legacy = localStorage.getItem(LEGACY_DEVICE_CONFIG_STORAGE_KEY);
    if (legacy !== null) {
      localStorage.setItem(DEVICE_CONFIG_STORAGE_KEY, legacy);
      localStorage.removeItem(LEGACY_DEVICE_CONFIG_STORAGE_KEY);
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

function writeConfigKey(value: string): boolean {
  try {
    localStorage.setItem(DEVICE_CONFIG_STORAGE_KEY, value);
    return true;
  } catch {
    return false;
  }
}

export function storeReceivedDeviceConfig(pending: PocReceivedDeviceConfig): void {
  writeConfigKey(JSON.stringify(pending));
}

/** Reads back the stored payload; re-validates its content before use. */
export function readStoredPocDeviceConfig(): PocReceivedDeviceConfig | null {
  const raw = readConfigKey();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { receivedAt?: unknown } & Record<string, unknown>;
    if (typeof parsed.receivedAt !== "string") return null;
    const result = parseDeviceConfig(parsed);
    if ("error" in result) return null;
    return { ...result.config, receivedAt: parsed.receivedAt };
  } catch {
    return null;
  }
}

// ponytail: mirror of the TtsProviderId/AsrProviderId/LlmProviderId unions —
// import them as const arrays if the unions start drifting.
const LLM_PROVIDER_IDS: ReadonlySet<string> = new Set([
  "browser-local-gemma", "browser-local-qwen", "openai", "openai-realtime", "openai-codex",
  "anthropic", "claude-cli", "openrouter", "ollama", "lmstudio", "openclaw", "google",
  "google-live", "xai", "mistral", "cerebras", "nvidia", "groq", "together", "fireworks", "qwen"
]);
const TTS_PROVIDER_IDS: ReadonlySet<string> = new Set([
  "kokoro", "elevenlabs", "deepgram", "openai", "google", "xai", "deepinfra", "openrouter",
  "inworld", "minimax", "gradium", "vydra", "xiaomi", "azure-speech", "microsoft", "volcengine"
]);
const ASR_PROVIDER_IDS: ReadonlySet<string> = new Set([
  "distil-whisper", "deepgram", "elevenlabs", "openai", "xai", "mistral"
]);

// Mirror of components/chat/ChatPanel.tsx (lib/ must not import components/).
function isRealtimeVoiceProvider(provider: string): provider is "google-live" | "openai-realtime" {
  return provider === "google-live" || provider === "openai-realtime";
}

/** Default realtime voice from the shared provider catalog (same source the
 * onboarding/configure UI uses), with the historical pair as a last resort. */
function defaultRealtimeVoice(provider: "google-live" | "openai-realtime"): string {
  return (
    LLM_PROVIDER_OPTIONS.find((option) => option.id === provider)?.defaultVoice ??
    (provider === "google-live" ? "Kore" : "coral")
  );
}

/** Providers -> existing SessionConfig stores (stt->asr, endpoint->baseUrl, voiceId->voice). */
export function mapPocProvidersToEndpoints(
  providers: PocDeviceConfig["providers"]
): { session: PocSessionConfig | null; warnings: string[] } {
  const warnings: string[] = [];
  const unknown = (["llm", "tts", "stt"] as const)
    .filter((slot) => {
      const id = providers[slot].provider;
      return !(slot === "llm" ? LLM_PROVIDER_IDS : slot === "tts" ? TTS_PROVIDER_IDS : ASR_PROVIDER_IDS).has(id);
    });
  if (unknown.length > 0) {
    warnings.push(`providers skipped (unknown provider id: ${unknown.map((slot) => `${slot}:${providers[slot].provider}`).join(", ")})`);
    return { session: null, warnings };
  }

  const llm: BaseProviderConfig = {
    provider: providers.llm.provider as LlmProviderId,
    model: providers.llm.model,
    baseUrl: providers.llm.endpoint
  };
  const voiceId = providers.tts.voiceId;
  const tts = {
    provider: providers.tts.provider as TtsProviderId,
    model: providers.tts.model,
    baseUrl: providers.tts.endpoint,
    // providers.tts.speed (protocol §Bloc `providers.tts.speed`): the phone is
    // authoritative — a non-null speed overrides the local desktop setting,
    // null/absent leaves the provider default. Carried only for tts.
    ...(providers.tts.speed != null ? { speed: providers.tts.speed } : {}),
    ...(voiceId
      ? providers.tts.provider === "elevenlabs" ? { voiceId } : { voice: voiceId }
      : {})
  } as TtsConfig;
  const asr = {
    provider: providers.stt.provider as AsrProviderId,
    model: providers.stt.model,
    baseUrl: providers.stt.endpoint
  } as AsrConfig;

  // Realtime llm: the chosen model AND voice travel in device-config
  // (providers.llm.model / providers.llm.voiceId — protocol §POST
  // /api/device-config, box "Providers realtime (18/09/2026)"). The credential
  // never travels there; only a locally known credential is preserved
  // (resolved at the call site by ChatPanel's resolveProviderCredential).
  // Non-realtime llm: the local realtime voice is preserved untouched.
  const previous = loadSessionConfig();
  const previousRealtime = previous?.realtimeVoice;
  let realtimeVoice: RealtimeVoiceConfig | undefined;
  if (isRealtimeVoiceProvider(llm.provider)) {
    const credential =
      previousRealtime && "credential" in previousRealtime ? previousRealtime.credential : undefined;
    realtimeVoice = {
      provider: llm.provider,
      ...(credential ? { credential } : {}),
      model: providers.llm.model,
      voice: providers.llm.voiceId ?? defaultRealtimeVoice(llm.provider),
      websocketUrl: providers.llm.endpoint,
      // providers.llm.speed (protocol §Bloc `providers.llm.speed`): the realtime
      // voice covers output, so the speed travels on the llm slot. The validator
      // already dropped it for google-live / non-realtime providers.
      ...(providers.llm.provider === "openai-realtime" && providers.llm.speed != null
        ? { speed: providers.llm.speed }
        : {})
    } as RealtimeVoiceConfig;
  } else {
    realtimeVoice = previousRealtime;
  }

  return {
    session: {
      llm,
      tts,
      asr,
      ...(realtimeVoice ? { realtimeVoice } : {})
    },
    warnings
  };
}

/** Fetches a .vrm binary from the server's local library route (Phase C,
 * requalified to /api/device/vrms — POC.md §13.5 point 2).
 * Null when the file is unknown to the library (404) or the server is down. */
export async function fetchLibraryVrm(fileName: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(`/api/device/vrms/file?name=${encodeURIComponent(fileName)}`, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

/** Applies the validated blocks to the existing stores and hooks. */
export async function applyPocDeviceConfig(
  pending: PocReceivedDeviceConfig,
  hooks: PocApplyHooks
): Promise<PocApplyResult> {
  const validation = parseDeviceConfig(pending);
  if ("error" in validation) {
    return { applied: [], warnings: [`stored payload no longer valid (${validation.error})`] };
  }
  const config = validation.config;
  const warnings = [...validation.warnings];
  const applied: string[] = [];

  // character -> existing store + live setter.
  hooks.setCharacter({ ...config.character });
  saveCharacterConfig(config.character);
  applied.push("character");

  // environment.alcoveColor -> environmentConfig store (legacy path of the app).
  saveEnvironmentConfig({ alcoveColor: config.environment.alcoveColor });
  applied.push("environment");

  // avatar.mood -> live preset hook + moodConfig store; the localStorage write
  // relays the change to /hologram via the same-origin storage event. Mobile
  // "Défaut" sends null, which resets the avatar to a neutral face.
  const mood = config.avatar.mood ?? null;
  hooks.onMoodPreset(mood);
  saveMoodConfig({ mood });
  applied.push("mood");

  // avatar.pose -> live pose hook + poseConfig store; the localStorage write
  // relays the change to /hologram via the same-origin storage event. The
  // validator already resolved missing/invalid fields to neutral defaults.
  const pose = config.avatar.pose;
  hooks.onPose(pose);
  savePoseConfig(pose);
  applied.push("pose");

  // wakeWord -> bundle settings store via the caller's hook; the ChatPanel
  // bridge reacts to `selected` and re-arms automatically. Only when the block
  // was actually received: an absent block leaves the local desktop selection
  // untouched (the phone is authoritative only about what it sends).
  if (config.wakeWord) {
    hooks.onWakeWord?.(config.wakeWord.model);
    applied.push("wakeWord");
  }

  // wakeWord.cue -> bundle cue settings via the caller's hook, only for the
  // fields actually sent (the parser guarantees at least one valid field here).
  if (config.wakeWord?.cue) {
    hooks.onWakeWordCue?.(config.wakeWord.cue);
    applied.push("wakeWordCue");
  }

  // providers -> mapped session stores; the caller remounts the ChatPanel.
  const mapped = mapPocProvidersToEndpoints(config.providers);
  warnings.push(...mapped.warnings);
  if (mapped.session) {
    saveSessionConfig(mapped.session);
    hooks.onSessionConfig(mapped.session);
    applied.push("providers");
  }

  // avatar.modelRef -> local VRM (single "current" record); when IndexedDB has
  // no matching file (POC Phase C), fall back to the server's local VRM
  // library route (/api/device/vrms/file) and persist it through the same
  // handleVrmFileLoad path (repo.save). A name unknown to both -> the server
  // already rejected MODEL_REF_UNKNOWN; here we only warn, never crash.
  if (config.avatar.modelRef) {
    const repo = hooks.getVrmRepository();
    if (!repo) {
      warnings.push("local VRM repository unavailable (modelRef skipped)");
    } else {
      const stored = await repo.load();
      const ref = config.avatar.modelRef;
      if (stored && stored.fileName === ref.fileName) {
        hooks.onVrmModel(stored);
        applied.push("vrm");
      } else {
        const bytes = await fetchLibraryVrm(ref.fileName);
        if (bytes) {
          try {
            await repo.save(bytes, ref.fileName);
          } catch {
            // Storage failure is non-fatal; the VRM still applies this session.
          }
          hooks.onVrmModel({ arrayBuffer: bytes, fileName: ref.fileName });
          applied.push("vrm");
        } else {
          warnings.push(`MODEL_REF_UNKNOWN (modelRef.fileName=${ref.fileName} in neither IndexedDB nor the VRM library)`);
        }
      }
    }
  }

  return { applied, warnings };
}

function ingestPending(
  pendingRaw: unknown,
  hooks: PocApplyHooks,
  origin: "poll" | "boot-restore"
): { pending: PocReceivedDeviceConfig } | { skip: "invalid" } | { skip: "duplicate" } {
  if (typeof pendingRaw !== "object" || pendingRaw === null) return { skip: "invalid" };
  const raw = pendingRaw as PocReceivedDeviceConfig;
  if (typeof raw.receivedAt !== "string") return { skip: "invalid" };

  if (origin !== "boot-restore") {
    const stored = readStoredPocDeviceConfig();
    if (stored && stored.receivedAt === raw.receivedAt) return { skip: "duplicate" };
  }

  const validation = parseDeviceConfig(raw);
  if ("error" in validation) {
    pocRendererLog(`apply skipped invalid ${origin} code=${validation.error} receivedAt=${raw.receivedAt}`);
    return { skip: "invalid" };
  }

  storeReceivedDeviceConfig({ ...validation.config, receivedAt: raw.receivedAt });
  if (!readStoredPocDeviceConfig()) {
    pocRendererLog(`apply localStorage write failed receivedAt=${raw.receivedAt}`);
    return { skip: "invalid" };
  }
  return { pending: { ...validation.config, receivedAt: raw.receivedAt } };
}

/**
 * Ingestion path shared by the poller and a hook. Validates the pending payload,
 * deduplicates by receivedAt, stores it under the POC key and applies it live.
 */
export async function ingestPocPendingPayload(pendingRaw: unknown, hooks: PocApplyHooks): Promise<void> {
  const outcome = ingestPending(pendingRaw, hooks, "poll");
  if ("skip" in outcome) {
    // Duplicate skips stay silent: with the durable file store the server
    // re-delivers the last config on every poll (POC.md §13.4) and the
    // receivedAt dedup IS the steady state — logging it would spam the
    // diagnostic file every 2 s.
    return;
  }
  await applyAndLog(outcome.pending, hooks);
}

async function applyAndLog(pending: PocReceivedDeviceConfig, hooks: PocApplyHooks): Promise<void> {
  const result = await applyPocDeviceConfig(pending, hooks);
  pocRendererLog(
    `apply receivedAt=${pending.receivedAt} blocks=${result.applied.join(",") || "none"} ` +
    `warnings=${result.warnings.length} ${describeConfigSummary(pending)}`
  );
  for (const warning of result.warnings) {
    pocRendererLog(`apply warning ${warning}`);
  }
}

// One-shot localStorage -> durable file migration (first boot after the
// pending-config channel was retired, POC.md §13.5 point 3): the server file
// is empty but the renderer localStorage still holds the last applied config.
// Re-submitting it through the normal POST /api/device-config path re-validates
// it server-side and populates the file; the next poll delivers it back with a
// fresh receivedAt and it is re-applied once. Detected via GET /api/device-config
// returning config:null — never runs once the server holds a config (or after
// one attempt), so there is no re-submit loop.
let migrationAttempted = false;

// Exported for tests only; the poller is the production caller.
export async function migrateStoredConfigToServer(): Promise<void> {
  const stored = readStoredPocDeviceConfig();
  if (!stored || migrationAttempted) return;
  try {
    const response = await fetch("/api/device-config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(stored)
    });
    if (!response.ok) throw new Error(`status=${response.status}`);
    migrationAttempted = true;
    pocRendererLog(`migration localStorage->file re-submitted receivedAt=${stored.receivedAt}`);
  } catch {
    // Server hiccup: leave the flag unset so a later tick retries.
  }
}

/** Poll loop (~2 s) on GET /api/device-config (stable, contract-grade —
 * replaces the retired /api/poc/pending-config channel). Starts lazily,
 * tolerates an unreachable server (1 log, no spam). Returns a clean stop
 * function. */
export function startPocDeviceConfigPolling(hooks: PocApplyHooks, intervalMs = POC_POLL_INTERVAL_MS): () => void {
  let unreachableLogged = false;

  const tick = async () => {
    try {
      const response = await fetch("/api/device-config", { cache: "no-store" });
      if (!response.ok) throw new Error(`status=${response.status}`);
      const json = (await response.json()) as { ok?: unknown; config?: unknown };
      unreachableLogged = false;
      if (json.ok === true && json.config) {
        await ingestPocPendingPayload(json.config, hooks);
      } else if (json.ok === true) {
        // Empty durable store: re-submit the renderer cache once (one-shot
        // localStorage->file migration, first boot after the code migration).
        await migrateStoredConfigToServer();
      }
    } catch {
      // Server unreachable (PhB POC): retry silently, log once per outage.
      if (!unreachableLogged) {
        unreachableLogged = true;
        pocRendererLog("device-config poll unreachable (retrying silently)");
      }
    }
  };

  // Boot restore: the refreshed renderer re-applies its own stored payload so
  // character/providers/environment survive a page reload. The localStorage
  // key stays a renderer cache; the durable source of truth is now the server
  // file — when the cache is empty (fresh storage), the poll below delivers
  // the last file config and it is applied like any pending payload.
  const stored = readStoredPocDeviceConfig();
  if (stored) {
    pocRendererLog(`boot restore receivedAt=${stored.receivedAt}`);
    void applyAndLog(stored, hooks);
  }

  void tick();
  const timer = window.setInterval(() => void tick(), intervalMs);
  return () => window.clearInterval(timer);
}
