import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { getCredential, resolveProviderCredentialsPath } from "@/lib/deviceConfig/providerCredentials";

function post(body: unknown) {
  return POST(new Request("http://localhost/api/credentials", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" }
  }) as never);
}

const KEY = "sk-proj-secret-value-987654321";

describe("POST /api/credentials (contract v1, decision D1)", () => {
  let dir: string;
  let previousEnv: string | undefined;

  beforeEach(() => {
    dir = join(tmpdir(), `liteforms-credentials-route-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    previousEnv = process.env.LITEFORMS_CREDENTIALS_PATH;
    process.env.LITEFORMS_CREDENTIALS_PATH = resolveProviderCredentialsPath(dir);
  });

  afterEach(() => {
    if (previousEnv === undefined) {
      delete process.env.LITEFORMS_CREDENTIALS_PATH;
    } else {
      process.env.LITEFORMS_CREDENTIALS_PATH = previousEnv;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("stores the key, returns ok + maskedKey and never echoes the key", async () => {
    const response = await post({ provider: "openai", apiKey: KEY });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true, provider: "openai", configured: true, maskedKey: "sk-****" });
    // The real key must never appear in the response body.
    expect(JSON.stringify(json)).not.toContain(KEY);
    expect(JSON.stringify(json)).not.toContain("secret-value");

    // The key IS stored durably (single source of truth).
    expect(getCredential(resolveProviderCredentialsPath(dir), "openai")).toBe(KEY);
  });

  it("is idempotent: re-POST of the same provider replaces the key (last value wins)", async () => {
    await post({ provider: "openai", apiKey: "sk-first-111111" });
    const second = await post({ provider: "openai", apiKey: "sk-second-222222" });
    expect(second.status).toBe(200);
    expect(getCredential(resolveProviderCredentialsPath(dir), "openai")).toBe("sk-second-222222");
  });

  it("rejects an unknown provider with UNKNOWN_PROVIDER and no key echo", async () => {
    const response = await post({ provider: "bogus", apiKey: KEY });
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json).toMatchObject({ ok: false, code: "UNKNOWN_PROVIDER" });
    expect(JSON.stringify(json)).not.toContain(KEY);
  });

  it("rejects a missing/empty apiKey with INVALID_FIELD", async () => {
    expect((await post({ provider: "openai" })).status).toBe(400);
    expect((await post({ provider: "openai", apiKey: "" })).status).toBe(400);
    const json = await (await post({ provider: "openai", apiKey: "" })).json();
    expect(json).toMatchObject({ ok: false, code: "INVALID_FIELD" });
  });

  it("rejects a body that is not JSON", async () => {
    const response = await POST(new Request("http://localhost/api/credentials", {
      method: "POST",
      body: "{ not json",
      headers: { "content-type": "application/json" }
    }) as never);
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json).toMatchObject({ ok: false, code: "INVALID_FIELD" });
  });

  it("never logs the key (console output is redacted-by-design: only provider + mask)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await post({ provider: "openai", apiKey: KEY });
      const logged = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).not.toContain(KEY);
      expect(logged).not.toContain("secret-value");
      expect(logged).toContain("masked=sk-****");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("rejects GET with 405", async () => {
    const response = await GET();
    expect(response.status).toBe(405);
    const json = await response.json();
    expect(json).toMatchObject({ ok: false, code: "METHOD_NOT_ALLOWED" });
  });
});
