// Contract Mobile<->Electron v1 — POST /api/device-config.
// POC scope (POC.md §6): the payload is validated and parked in module memory;
// the renderer picks it up via GET /api/poc/pending-config, stores it in its
// own localStorage (liteforms.poc.deviceConfig) and applies the existing
// setters. Nothing durable here yet — userData persistence comes later.
// Secrets are rejected outright: the contract forbids provider keys, pairing
// tokens and WiFi passwords in this payload.

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

export type PocDeviceConfig = {
  configVersion: "1.0";
  character: PocCharacterConfig;
  avatar: {
    mood?: string;
    modelRef?: PocModelRef;
    pose?: Record<string, number>;
  };
  environment: {
    alcoveColor: string;
  };
  providers: {
    llm: PocProviderConfig;
    tts: PocProviderConfig;
    stt: PocProviderConfig;
  };
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
  const pose = typeof avatar.pose === "object" && avatar.pose !== null
    ? Object.fromEntries(
      Object.entries(avatar.pose as Record<string, unknown>).filter(([key, value]): [string, number] | false => {
        if (typeof value === "number") return [key, value];
        warnings.push(`pose.${key} ignored (not a number)`);
        return false;
      })
    ) as Record<string, number>
    : undefined;
  if (avatar.mood !== undefined && typeof avatar.mood !== "string") {
    return { error: "INVALID_FIELD", message: "avatar.mood must be a string when present" };
  }
  if (avatar.mood !== undefined) warnings.push("avatar.mood accepted but not applied in this POC (mood port pending)");
  if (pose && Object.keys(pose).length > 0) warnings.push("avatar.pose accepted but not applied in this POC (pose port pending)");

  return {
    warnings,
    config: {
      configVersion: "1.0",
      character,
      avatar: {
        ...(avatar.mood !== undefined ? { mood: avatar.mood as string } : {}),
        ...(modelRef ? { modelRef } : {}),
        ...(pose ? { pose } : {})
      },
      environment,
      providers
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
  avatar: { mood?: string; modelRef?: { id: string; fileName: string } | null; pose?: Record<string, number> | null };
  providers: { llm: { provider: string }; tts: { provider: string }; stt: { provider: string } };
}): string {
  const slots = ["llm", "tts", "stt"] as const;
  return `character.name set=${config.character.name.length > 0} pronouns=${config.character.pronouns} ` +
    `mood=${config.avatar.mood !== undefined ? "present" : "absent"} ` +
    `modelRef=${config.avatar.modelRef ? config.avatar.modelRef.fileName : "none"} ` +
    `pose.keys=${config.avatar.pose ? Object.keys(config.avatar.pose).join("+") || "0" : "none"} ` +
    `providers=${slots.map((slot) => `${slot}:${config.providers[slot].provider}`).join(" ")}`;
}
