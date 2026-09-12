"use client";

import { parseDeviceConfig, describeConfigSummary, type PocDeviceConfig } from "@/lib/deviceConfig/pocConfig";
import { logDiagnostic } from "@/lib/avatar/diagnosticLog";
import { saveCharacterConfig } from "@/lib/storage/characterConfig";
import { saveEnvironmentConfig } from "@/lib/storage/environmentConfig";
import { loadSessionConfig, saveSessionConfig, type SessionConfig } from "@/lib/storage/sessionConfig";

export type PocSessionConfig = Omit<SessionConfig, "version">;
import type { BaseProviderConfig, LlmProviderId } from "@/lib/llm";
import type { AsrConfig, AsrProviderId, TtsConfig, TtsProviderId } from "@/lib/speech";
import type { StoredVrm, VrmRepository } from "@/lib/storage/vrmRepository";
import type { CharacterConfig } from "@/components/chat/ChatPanel";

// POC Phase B — renderer apply (POC.md §12.2, §6.1). Polls the server-parked
// payload, stores it under the dedicated POC localStorage key (never
// liteforms.sessionConfig) and projects the validated blocks onto the existing
// stores (character, environment, session providers, local VRM).
// No secrets ever transit here: the server rejects them before parking.

export const POC_DEVICE_CONFIG_KEY = "liteforms.poc.deviceConfig";

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
};

export type PocApplyResult = { applied: string[]; warnings: string[] };

// Renderer logs flow through the diagnostic bridge into the same
// liteforms-diagnostic.log; keep the shared [poc] <ISO> <message> line format.
// The raw payload is NEVER logged — only receivedAt, block names and warnings.
function pocRendererLog(message: string): void {
  logDiagnostic(`[poc] ${new Date().toISOString()} ${message}`);
}

function readPocKey(): string | null {
  try {
    return localStorage.getItem(POC_DEVICE_CONFIG_KEY);
  } catch {
    return null;
  }
}

function writePocKey(value: string): boolean {
  try {
    localStorage.setItem(POC_DEVICE_CONFIG_KEY, value);
    return true;
  } catch {
    return false;
  }
}

export function storeReceivedDeviceConfig(pending: PocReceivedDeviceConfig): void {
  writePocKey(JSON.stringify(pending));
}

/** Reads back the stored payload; re-validates its content before use. */
export function readStoredPocDeviceConfig(): PocReceivedDeviceConfig | null {
  const raw = readPocKey();
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
    ...(voiceId
      ? providers.tts.provider === "elevenlabs" ? { voiceId } : { voice: voiceId }
      : {})
  } as TtsConfig;
  const asr = {
    provider: providers.stt.provider as AsrProviderId,
    model: providers.stt.model,
    baseUrl: providers.stt.endpoint
  } as AsrConfig;

  // Preserve the local realtime voice: it never travels in device-config.
  const previous = loadSessionConfig();
  return {
    session: {
      llm,
      tts,
      asr,
      ...(previous?.realtimeVoice ? { realtimeVoice: previous.realtimeVoice } : {})
    },
    warnings
  };
}

/** Fetches a .vrm binary from the server's local library route (Phase C).
 * Null when the file is unknown to the library (404) or the server is down. */
export async function fetchLibraryVrm(fileName: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(`/api/poc/vrms/file?name=${encodeURIComponent(fileName)}`, { cache: "no-store" });
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
  // library route (/api/poc/vrms/file) and persist it through the same
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

  // mood/pose are deliberately not applied (server warnings already list them).

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
    if (outcome.skip === "duplicate") {
      pocRendererLog("apply skipped duplicate (already stored)");
    }
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

/** Poll loop (~2 s). Starts lazily, tolerates an unreachable server (1 log, no
 * spam). Returns a clean stop function. */
export function startPocDeviceConfigPolling(hooks: PocApplyHooks, intervalMs = POC_POLL_INTERVAL_MS): () => void {
  let unreachableLogged = false;

  const tick = async () => {
    try {
      const response = await fetch("/api/poc/pending-config?consume=1", { cache: "no-store" });
      if (!response.ok) throw new Error(`status=${response.status}`);
      const json = (await response.json()) as { ok?: unknown; pending?: unknown };
      unreachableLogged = false;
      if (json.ok === true && json.pending) {
        await ingestPocPendingPayload(json.pending, hooks);
      }
    } catch {
      // Server unreachable (PhB POC): retry silently, log once per outage.
      if (!unreachableLogged) {
        unreachableLogged = true;
        pocRendererLog("pending-config unreachable (retrying silently)");
      }
    }
  };

  // Boot restore: the refreshed renderer re-applies its own stored payload so
  // character/providers/environment survive a page reload.
  const stored = readStoredPocDeviceConfig();
  if (stored) {
    pocRendererLog(`boot restore receivedAt=${stored.receivedAt}`);
    void applyAndLog(stored, hooks);
  }

  void tick();
  const timer = window.setInterval(() => void tick(), intervalMs);
  return () => window.clearInterval(timer);
}
