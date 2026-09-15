import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GET, POST } from "./route";

function withTempCredentialsPath(folder: string): string {
  const path = join(folder, "wifi-credentials.json");
  writeFileSync(path, JSON.stringify({ version: 1, ssid: "secret-ssid", passwordEncrypted: "cipher" }), "utf8");
  process.env.LITEFORMS_WIFI_CREDENTIALS_PATH = path;
  return path;
}

let tempRoot: string | null = null;

afterEach(() => {
  delete process.env.LITEFORMS_WIFI_CREDENTIALS_PATH;
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe("POST /api/provisioning/reset (protocol §15/09/2026)", () => {
  it("returns the contractual 202 payload for an empty body", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "lf-reset-"));
    withTempCredentialsPath(tempRoot);
    const response = await POST(new Request("http://localhost/api/provisioning/reset", { method: "POST" }) as never);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      ok: true,
      restartRequired: true,
      message: "Provisioning reset accepted"
    });
  });

  it("405 on GET", async () => {
    const response = await GET();
    expect(response.status).toBe(405);
  });

  it("rejects with RESET_UNAVAILABLE when no path was handed over (dev without Electron)", async () => {
    const response = await POST(new Request("http://localhost/api/provisioning/reset", { method: "POST" }) as never);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("RESET_UNAVAILABLE");
  });

  it("purges an existing credentials file and 202s", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "lf-reset-"));
    const path = withTempCredentialsPath(tempRoot);

    const response = await POST(new Request("http://localhost/api/provisioning/reset", { method: "POST" }) as never);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      ok: true,
      restartRequired: true,
      message: "Provisioning reset accepted"
    });
    expect(existsSync(path)).toBe(false);
  });

  it("is idempotent: already-purged file is still a 202", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "lf-reset-"));
    withTempCredentialsPath(tempRoot);

    await POST(new Request("http://localhost/api/provisioning/reset", { method: "POST" }) as never);
    const second = await POST(new Request("http://localhost/api/provisioning/reset", { method: "POST" }) as never);

    expect(second.status).toBe(202);
  });

  it("never exposes credentials content (paths, secrets) in the response", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "lf-reset-"));
    const path = withTempCredentialsPath(tempRoot);
    const original = readFileSync(path, "utf8");

    const response = await POST(new Request("http://localhost/api/provisioning/reset", { method: "POST" }) as never);
    expect(JSON.stringify(response)).not.toContain("secret-ssid");
    expect(JSON.stringify(response)).not.toContain(original);
  });
});
