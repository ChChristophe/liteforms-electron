// Durable provider-credentials store (contract v1, POST /api/credentials —
// decision D1). One JSON file in <userData>/config/, written by the Next
// server through a path handed over by the Electron main process — same
// mechanism as LITEFORMS_WIFI_CREDENTIALS_PATH / LITEFORMS_DEVICE_CONFIG_DIR.
// Node-only: never imported by renderer code (the server/renderer boundary of
// POC.md §3.2 stays intact). The raw key is NEVER logged or returned in full:
// only the masked form (maskProviderKey) leaves this module.
//
// Single source of truth: this file is the store both the Mobile route
// (POST /api/credentials) and the desktop UI (CredentialSettingsPanel via
// IPC setCredential, electron/credentials.ts) write to. The renderer reads it
// through a main<->renderer IPC channel (electron/credentials.ts + preload) —
// never over HTTP.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CREDENTIAL_PROVIDER_IDS } from "@/lib/llm/providerOptions";
import { SPEECH_CREDENTIAL_PROVIDER_IDS } from "@/lib/speech/providerOptions";

export const PROVIDER_CREDENTIALS_FILE_NAME = "provider-credentials.json";

/** Provider ids that accept an API credential (LLM + TTS + STT vocabulary,
 * same ids as device-config's provider fields). */
export const KNOWN_CREDENTIAL_PROVIDER_IDS: ReadonlySet<string> = new Set([
  ...CREDENTIAL_PROVIDER_IDS,
  ...SPEECH_CREDENTIAL_PROVIDER_IDS
]);

export type CredentialsMap = Record<string, string>;

type CredentialsFilePayload = {
  version: 1;
  credentials: CredentialsMap;
};

export type CredentialsParseResult =
  | { ok: true; provider: string; apiKey: string }
  | { ok: false; code: "UNKNOWN_PROVIDER" | "INVALID_FIELD"; message: string };

/**
 * Validates a `POST /api/credentials` body. Normative rules (protocol
 * 17/09/2026): `provider` must be a known provider id, `apiKey` a non-empty
 * string in a field named `apiKey`. Never echoes the key.
 */
export function parseCredentialsBody(raw: unknown): CredentialsParseResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, code: "INVALID_FIELD", message: "The request body must be a JSON object" };
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.provider !== "string" || body.provider.length === 0) {
    return { ok: false, code: "INVALID_FIELD", message: "provider must be a non-empty string" };
  }
  if (!KNOWN_CREDENTIAL_PROVIDER_IDS.has(body.provider)) {
    return { ok: false, code: "UNKNOWN_PROVIDER", message: `Unknown provider: ${body.provider}` };
  }
  if (typeof body.apiKey !== "string" || body.apiKey.length === 0) {
    return { ok: false, code: "INVALID_FIELD", message: "apiKey must be a non-empty string" };
  }
  return { ok: true, provider: body.provider, apiKey: body.apiKey };
}

/**
 * Masked form exposed by /api/credentials and /api/provider-status. Reveals
 * only the key family (sk-**** for OpenAI-style keys, *** otherwise) — never
 * any part of the real key. Matches the protocol examples (sk-****) and the
 * POC §6.3 example (*** for non-sk tokens like OpenClaw).
 */
export function maskProviderKey(apiKey: string): string {
  return /^sk-/i.test(apiKey) ? "sk-****" : "***";
}

/** `<dir>/provider-credentials.json`. */
export function resolveProviderCredentialsPath(dir: string): string {
  return join(dir, PROVIDER_CREDENTIALS_FILE_NAME);
}

/** Tolerant read: absent/corrupt file -> {} (never throws, never logs the key). */
export function loadCredentials(path: string): CredentialsMap {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CredentialsFilePayload>;
    if (parsed.version !== 1 || typeof parsed.credentials !== "object" || parsed.credentials === null) {
      return {};
    }
    const credentials: CredentialsMap = {};
    for (const [provider, apiKey] of Object.entries(parsed.credentials as Record<string, unknown>)) {
      if (typeof apiKey === "string" && apiKey.length > 0) credentials[provider] = apiKey;
    }
    return credentials;
  } catch {
    return {};
  }
}

/**
 * Atomic save (tmp + rename) of one provider's key, merging with the existing
 * map (re-POST of the same provider = replacement, idempotent). Returns false
 * on failure — callers keep the in-memory fallback, the HTTP contract never
 * breaks on a storage hiccup.
 */
export function saveCredential(path: string, provider: string, apiKey: string): boolean {
  const credentials = loadCredentials(path);
  credentials[provider] = apiKey;
  const payload: CredentialsFilePayload = { version: 1, credentials };
  try {
    writeFileSync(`${path}.tmp`, JSON.stringify(payload, null, 2), "utf8");
    renameSync(`${path}.tmp`, path);
    return true;
  } catch {
    return false;
  }
}

/** Read back one provider's key, or undefined when absent/unconfigured. */
export function getCredential(path: string, provider: string): string | undefined {
  return loadCredentials(path)[provider];
}
