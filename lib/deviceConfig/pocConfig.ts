// Contract Mobile<->Electron v1 — POST /api/device-config.
// The payload is validated and stored durably (<userData>/config/
// device-config.json, POC.md §13.6); the renderer picks it up via the stable
// GET /api/device-config route, caches it in its own localStorage
// (liteforms.deviceConfig) and applies the existing setters.
// Secrets are rejected outright: the contract forbids provider keys, pairing
// tokens and WiFi passwords in this payload.

import { VALID_MOOD_PRESETS } from "@/lib/storage/moodConfig";
import {
  DEFAULT_AVATAR_POSE,
  clampDepth,
  clampZoom,
  type AvatarPoseConfig,
} from "@/lib/avatar/avatarPose";

export type PocCharacterConfig = {
  name: string;
  pronouns: "HE" | "SHE" | "THEY";
  personality: string;
  greeting: string;
};

export type PocModelRef = {
  id: string;
  fileName: string;
  hash: string | null;
};

// ponytail: local mirror of bundles/wakeword/engine/modelsRegistry.ts
// (PRETRAINED_MODELS) — lib/ must not import bundles/; keep the two in sync.
export const WAKEWORD_MODEL_IDS = ["hey_jarvis", "alexa", "hey_mycroft", "hey_rhasspy"] as const;
export type WakewordModelId = (typeof WAKEWORD_MODEL_IDS)[number];

export type PocWakeWordConfig = {
  model: WakewordModelId | null;
};

export type PocDeviceConfig = {
  configVersion: "1.0";
  character: PocCharacterConfig;
  avatar: {
    mood?: string;
    modelRef?: PocModelRef;
    /** Always resolved to the contract defaults when absent/partial. */
    pose: AvatarPoseConfig;
  };
  environment: {
    alcoveColor: string;
  };
  providers: {
    llm: PocProviderConfig;
    tts: PocProviderConfig;
    stt: PocProviderConfig;
  };
  /** Optional wake word block (protocol 18/09/2026). Omitted when the Mobile
   * did not send one: the appliance then keeps its own local desktop
   * selection. A block with `model: null` means "manual microphone". */
  wakeWord?: PocWakeWordConfig;
};

type PocProviderConfig = {
  provider: string;
  model: string;
  endpoint: string;
  voiceId: string | null;
};

const SECRET_FIELD_PATTERN = /^credential$|^api[-_]?key$|^token$|^password$|^secret$/i;

export function isForbiddenSecretKey(key: string): boolean {
  return SECRET_FIELD_PATTERN.test(key);
}

export function parseDeviceConfig(raw: unknown): { config: PocDeviceConfig; warnings: string[] } | { error: string; message: string } {
  if (typeof raw !== "object" || raw === null) {
    return { error: "INVALID_FIELD", message: "The request body must be a JSON object" };
  }

  // Reject secret-bearing fields anywhere in the payload before anything else.
  if (containsSecretKey(raw)) {
    return { error: "INVALID_FIELD", message: "device-config never carries secrets (provider keys, tokens, passwords)" };
  }

  const body = raw as Record<string, unknown>;
  if (body.configVersion !== "1.0") {
    return { error: "UNSUPPORTED_CONFIG_VERSION", message: "configVersion must be \"1.0\"" };
  }

  const character = body.character;
  if (!isCharacter(character)) {
    return { error: "INVALID_FIELD", message: "character must include name, pronouns (HE|SHE|THEY), personality and greeting" };
  }

  const environment = body.environment as { alcoveColor: string } | null;
  if (
    typeof environment !== "object" || environment === null ||
    typeof environment.alcoveColor !== "string" ||
    !/^#[0-9a-fA-F]{6}$/.test(environment.alcoveColor)
  ) {
    return { error: "INVALID_FIELD", message: "environment.alcoveColor must be a #rrggbb color" };
  }

  const providers = body.providers;
  if (!isProviders(providers)) {
    return { error: "INVALID_FIELD", message: "providers must include llm, tts and stt with provider/model/endpoint" };
  }

  const warnings: string[] = [];
  const avatar = (typeof body.avatar === "object" && body.avatar !== null ? body.avatar : {}) as Record<string, unknown>;
  const modelRef = parseModelRef(avatar.modelRef);
  if (avatar.modelRef !== undefined && modelRef === null) {
    return { error: "MODEL_REF_UNKNOWN", message: "avatar.modelRef must include id and fileName" };
  }
  const { pose, warnings: poseWarnings } = parseAvatarPose(avatar.pose);
  warnings.push(...poseWarnings);
  // avatar.mood: null ("Défaut" on the Mobile) and absent are both legal; only
  // a valid preset name is kept, anything else becomes a warning (never a 400).
  let mood: string | undefined;
  const rawMood = avatar.mood as unknown;
  if (rawMood !== undefined && rawMood !== null) {
    if (typeof rawMood === "string" && (VALID_MOOD_PRESETS as readonly string[]).includes(rawMood)) {
      mood = rawMood;
    } else {
      warnings.push(`avatar.mood \`${String(rawMood)}\` ignored (unknown preset)`);
    }
  }
  // wakeWord: additive optional block (protocol §Bloc `wakeWord`). Absent =
  // key omitted so the appliance's local desktop selection survives; an
  // unknown model is ignored with a warning (never a 400) and resolves to
  // null (manual microphone), like avatar.mood.
  let wakeWord: PocWakeWordConfig | undefined;
  const rawWakeWord = body.wakeWord;
  if (typeof rawWakeWord === "object" && rawWakeWord !== null) {
    const rawModel = (rawWakeWord as Record<string, unknown>).model;
    if (rawModel === undefined || rawModel === null) {
      wakeWord = { model: null };
    } else if (typeof rawModel === "string" && (WAKEWORD_MODEL_IDS as readonly string[]).includes(rawModel)) {
      wakeWord = { model: rawModel as WakewordModelId };
    } else {
      warnings.push(`wakeWord.model \`${String(rawModel)}\` ignoré (inconnu)`);
      wakeWord = { model: null };
    }
  }
  return {
    warnings,
    config: {
      configVersion: "1.0",
      character,
      avatar: {
        ...(mood !== undefined ? { mood } : {}),
        ...(modelRef ? { modelRef } : {}),
        pose
      },
      environment,
      providers,
      ...(wakeWord !== undefined ? { wakeWord } : {})
    }
  };
}

function containsSecretKey(value: unknown, depth = 0): boolean {
  if (depth > 6 || typeof value !== "object" || value === null) return false;
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenSecretKey(key)) return true;
    if (containsSecretKey(inner, depth + 1)) return true;
  }
  return false;
}

function isCharacter(value: unknown): value is PocCharacterConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === "string" && v.name.length > 0 &&
    typeof v.personality === "string" &&
    typeof v.greeting === "string" &&
    (v.pronouns === "HE" || v.pronouns === "SHE" || v.pronouns === "THEY")
  );
}

function isProviders(value: unknown): value is PocDeviceConfig["providers"] {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return ["llm", "tts", "stt"].every((slot) => {
    const provider = v[slot];
    return (
      typeof provider === "object" && provider !== null &&
      typeof (provider as Record<string, unknown>).provider === "string" &&
      typeof (provider as Record<string, unknown>).model === "string" &&
      typeof (provider as Record<string, unknown>).endpoint === "string"
    );
  });
}

/**
 * Validates the `avatar.pose` block appliance-side (the client is never
 * trusted). Missing/empty pose = contract defaults; a non-finite or
 * non-numeric field is dropped with a `pose.<field> ignored` warning while the
 * other fields still apply; `zoom`/`depth` are clamped to the contract bounds.
 */
export function parseAvatarPose(value: unknown): { pose: AvatarPoseConfig; warnings: string[] } {
  const pose: AvatarPoseConfig = { ...DEFAULT_AVATAR_POSE };
  const warnings: string[] = [];
  if (typeof value !== "object" || value === null) return { pose, warnings };

  const source = value as Record<string, unknown>;
  const readFinite = (field: keyof AvatarPoseConfig): number | undefined => {
    const raw = source[field];
    if (raw === undefined) return undefined;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      warnings.push(`pose.${field} ignored`);
      return undefined;
    }
    return raw;
  };

  const avatarYaw = readFinite("avatarYaw");
  if (avatarYaw !== undefined) pose.avatarYaw = avatarYaw;
  const alcoveYaw = readFinite("alcoveYaw");
  if (alcoveYaw !== undefined) pose.alcoveYaw = alcoveYaw;
  const zoom = readFinite("zoom");
  if (zoom !== undefined) pose.zoom = clampZoom(zoom);
  const depth = readFinite("depth");
  if (depth !== undefined) pose.depth = clampDepth(depth);

  return { pose, warnings };
}

function parseModelRef(value: unknown): PocModelRef | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || typeof v.fileName !== "string") return null;
  if (v.hash !== null && typeof v.hash !== "string") return null;
  return { id: v.id, fileName: v.fileName, hash: v.hash as string | null };
}

/** Safe summary of a validated payload: field names and IDs only, no values. */
export function describeConfigSummary(config: {
  character: { name: string; pronouns: string };
  avatar: { mood?: string; modelRef?: { id: string; fileName: string } | null; pose?: AvatarPoseConfig | null };
  providers: { llm: { provider: string }; tts: { provider: string }; stt: { provider: string } };
  wakeWord?: { model: string | null };
}): string {
  const slots = ["llm", "tts", "stt"] as const;
  return `character.name set=${config.character.name.length > 0} pronouns=${config.character.pronouns} ` +
    `mood=${config.avatar.mood !== undefined ? "present" : "absent"} ` +
    `modelRef=${config.avatar.modelRef ? config.avatar.modelRef.fileName : "none"} ` +
    `pose=${config.avatar.pose ? "present" : "none"} ` +
    `wakeWord=${config.wakeWord ? config.wakeWord.model ?? "none" : "absent"} ` +
    `providers=${slots.map((slot) => `${slot}:${config.providers[slot].provider}`).join(" ")}`;
}
