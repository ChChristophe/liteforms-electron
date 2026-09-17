import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KNOWN_CREDENTIAL_PROVIDER_IDS,
  getCredential,
  loadCredentials,
  maskProviderKey,
  parseCredentialsBody,
  resolveProviderCredentialsPath,
  saveCredential,
  PROVIDER_CREDENTIALS_FILE_NAME
} from "./providerCredentials";
import { createLlmAdapter } from "@/lib/llm/adapters";

function streamResponse(lines: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) {
          controller.enqueue(encoder.encode(line));
        }
        controller.close();
      }
    })
  );
}

describe("providerCredentials store (single source of truth)", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `liteforms-creds-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses a valid {provider, apiKey} body", () => {
    expect(parseCredentialsBody({ provider: "openai", apiKey: "sk-abc123" })).toEqual({
      ok: true,
      provider: "openai",
      apiKey: "sk-abc123"
    });
  });

  it("rejects an unknown provider with UNKNOWN_PROVIDER", () => {
    const result = parseCredentialsBody({ provider: "not-a-provider", apiKey: "sk-x" });
    expect(result).toMatchObject({ ok: false, code: "UNKNOWN_PROVIDER" });
  });

  it("rejects a missing/empty apiKey with INVALID_FIELD", () => {
    expect(parseCredentialsBody({ provider: "openai" })).toMatchObject({ ok: false, code: "INVALID_FIELD" });
    expect(parseCredentialsBody({ provider: "openai", apiKey: "" })).toMatchObject({ ok: false, code: "INVALID_FIELD" });
    expect(parseCredentialsBody({ provider: "openai", apiKey: 42 })).toMatchObject({ ok: false, code: "INVALID_FIELD" });
  });

  it("rejects a non-object body with INVALID_FIELD", () => {
    expect(parseCredentialsBody(null)).toMatchObject({ ok: false, code: "INVALID_FIELD" });
    expect(parseCredentialsBody("openai")).toMatchObject({ ok: false, code: "INVALID_FIELD" });
  });

  it("knows the full credential provider vocabulary (llm + tts + stt)", () => {
    for (const id of ["openai", "openai-realtime", "anthropic", "google", "google-live", "elevenlabs", "deepgram", "openrouter", "openclaw"]) {
      expect(KNOWN_CREDENTIAL_PROVIDER_IDS.has(id)).toBe(true);
    }
  });

  it("masks OpenAI-style keys as sk-**** and other tokens as ***", () => {
    expect(maskProviderKey("sk-proj-1234567890abcdef")).toBe("sk-****");
    expect(maskProviderKey("some-gateway-token")).toBe("***");
  });

  it("saves and reads back a credential (idempotent replacement, last value wins)", () => {
    const path = resolveProviderCredentialsPath(dir);
    expect(saveCredential(path, "openai", "sk-first")).toBe(true);
    expect(getCredential(path, "openai")).toBe("sk-first");

    // Re-POST = replacement.
    expect(saveCredential(path, "openai", "sk-second")).toBe(true);
    expect(getCredential(path, "openai")).toBe("sk-second");

    // Other providers are preserved.
    expect(saveCredential(path, "elevenlabs", "el-key")).toBe(true);
    expect(loadCredentials(path)).toEqual({ openai: "sk-second", elevenlabs: "el-key" });
  });

  it("tolerates an absent or corrupt file", () => {
    const path = resolveProviderCredentialsPath(dir);
    expect(getCredential(path, "openai")).toBeUndefined();
    // Corrupt file -> empty map, never throws, never leaks the raw content.
    writeFileSync(path, "{ not json", "utf8");
    expect(loadCredentials(path)).toEqual({});
  });
});

describe("credential written by the route store reaches the LLM adapter", () => {
  it("a key saved via the route's store is sent as the adapter Authorization header", async () => {
    const dir = join(tmpdir(), `liteforms-creds-adapter-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    try {
      const path = resolveProviderCredentialsPath(dir);
      // Same write path the route uses (POST /api/credentials -> saveCredential).
      saveCredential(path, "openai", "sk-route-key-123456");
      const credential = getCredential(path, "openai");
      expect(credential).toBe("sk-route-key-123456");

      const fetchMock = vi.fn(async () =>
        streamResponse(['data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n', "data: [DONE]\n\n"])
      );
      const adapter = createLlmAdapter({
        config: { provider: "openai", model: "gpt-5.5", credential },
        fetch: fetchMock
      });

      const chunks: string[] = [];
      for await (const chunk of adapter.streamText({
        config: { provider: "openai", model: "gpt-5.5", credential },
        messages: [{ role: "user", content: "hello" }]
      })) {
        chunks.push(chunk);
      }
      expect(chunks.join("")).toBe("Hi");

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.openai.com/v1/chat/completions",
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer sk-route-key-123456" })
        })
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Ensure the file-name contract stays stable (electron/credentials.ts relies on
// the same literal for its IPC reads/writes).
describe("providerCredentials file name", () => {
  it("uses the provider-credentials.json file name", () => {
    expect(PROVIDER_CREDENTIALS_FILE_NAME).toBe("provider-credentials.json");
  });
});
