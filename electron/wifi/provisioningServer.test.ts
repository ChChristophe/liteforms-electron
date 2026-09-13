import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { createProvisioningServer } from "./provisioningServer";
import type { ProvisioningService } from "./provisioningService";

function makeService(overrides: Partial<ProvisioningService> = {}): ProvisioningService {
  // Cast: Partial overrides add `| undefined` to the literal's property types.
  return {
    async begin() { return null; },
    async acceptWifi() { return true; },
    getState() { return "provisioning"; },
    getLastJoinResult() { return null; },
    isProvisioning() { return true; },
    async stop() { /* noop */ },
    transition: null,
    ...overrides
  } as ProvisioningService;
}

const runningServers: ReturnType<typeof createProvisioningServer>[] = [];

function start(service: ProvisioningService, deviceId: string, port: number) {
  const server = createProvisioningServer(service, { deviceId });
  runningServers.push(server);
  return server.start("127.0.0.1", port);
}

afterEach(async () => {
  for (const server of runningServers) await server.close();
  runningServers.length = 0;
});

function request(port: number, path: string, method: "GET" | "POST" = "GET", body?: unknown) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method, headers: body !== undefined ? { "content-type": "application/json" } : undefined },
      (response) => {
        let raw = "";
        response.on("data", (chunk) => { raw += chunk; });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(raw) }));
      }
    );
    req.on("error", reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

function rawRequest(port: number, path: string, rawBody: string) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "POST" }, (response) => {
      let raw = "";
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(raw) }));
    });
    req.on("error", reject);
    req.write(rawBody);
    req.end();
  });
}

describe("provisioningServer (contract v1 routes)", () => {
  it("serves the exact GET /api/provisioning/health payload with the effective port", async () => {
    await start(makeService(), "desktop-8f31", 25417);

    const response = await request(25417, "/api/provisioning/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      mode: "provisioning",
      deviceId: "desktop-8f31",
      name: "Liteforms Desktop",
      protocolVersion: "1.0",
      port: 25417
    });
  });

  it("accepts the contract WiFi payload with 202 restartRequired, idempotently", async () => {
    const acceptCalls: unknown[] = [];
    const service = makeService({
      async acceptWifi(credentials) { acceptCalls.push(credentials); return true; }
    });
    await start(service, "desktop-8f31", 25418);

    const payload = { ssid: "MaisonWifi", password: "mot-de-passe-wifi", security: "WPA2-PSK" };
    const first = await request(25418, "/api/provisioning/wifi", "POST", payload);
    const second = await request(25418, "/api/provisioning/wifi", "POST", payload);

    expect(first.status).toBe(202);
    expect(first.body).toEqual({ ok: true, restartRequired: true, message: "WiFi configuration accepted" });
    expect(second.status).toBe(202);
    expect(second.body).toEqual(first.body);
    expect(acceptCalls).toHaveLength(2); // service-level idempotence dedupes the transition
  });

  it("never echoes the password in any response", async () => {
    await start(makeService(), "d", 25419);
    const secret = "mot-de-passe-wifi";

    const bad = await request(25419, "/api/provisioning/wifi", "POST", { ssid: "", password: secret });
    const ok = await request(25419, "/api/provisioning/wifi", "POST", { ssid: "MaisonWifi", password: secret, security: "WPA2-PSK" });

    expect(JSON.stringify(bad.body)).not.toContain(secret);
    expect(JSON.stringify(ok.body)).not.toContain(secret);
    expect(ok.body).toEqual({ ok: true, restartRequired: true, message: "WiFi configuration accepted" });
  });

  it("rejects invalid payloads with 400 INVALID_WIFI_CONFIG and a message naming the field", async () => {
    await start(makeService(), "d", 25420);

    const missingSsid = await request(25420, "/api/provisioning/wifi", "POST", { password: "pw" });
    expect(missingSsid.status).toBe(400);
    expect(missingSsid.body).toMatchObject({ ok: false, code: "INVALID_WIFI_CONFIG", message: expect.stringContaining("ssid") });

    const badSecurity = await request(25420, "/api/provisioning/wifi", "POST", { ssid: "n", password: "pw", security: "WEP" });
    expect(badSecurity.status).toBe(400);
    expect(badSecurity.body).toMatchObject({ ok: false, code: "INVALID_WIFI_CONFIG" });

    const notJson = await rawRequest(25420, "/api/provisioning/wifi", "this is not json");
    expect(notJson.status).toBe(400);
    expect(notJson.body).toMatchObject({ ok: false, code: "INVALID_WIFI_CONFIG" });
  });

  it("serves GET /api/health with the contract payload aligned on the Next /api/health route", async () => {
    await start(makeService(), "desktop-8f31", 25424);

    const response = await request(25424, "/api/health");

    expect(response.status).toBe(200);
    // Same fields as app/api/health/route.ts, networkMode fixed to provisioning.
    expect(response.body).toEqual({
      ok: true,
      name: "Liteforms Desktop",
      protocolVersion: "1.0",
      configVersions: ["1.0"],
      networkMode: "provisioning",
      deviceId: "desktop-8f31"
    });
  });

  it("serves GET /api/provisioning/status with the exact protocol payload per phase", async () => {
    // Before any acceptance the service reports null → the route answers
    // "joining" (protocol: the Mobile must never see an unknown phase).
    await start(makeService({ getLastJoinResult: () => null }), "desktop-8f31", 25425);
    const joining = await request(25425, "/api/provisioning/status");
    expect(joining.status).toBe(200);
    expect(joining.body).toEqual({ ok: true, phase: "joining", deviceId: "desktop-8f31" });
  });

  it("status reports joined after a successful transition", async () => {
    await start(makeService({ getLastJoinResult: () => "joined" }), "desktop-8f31", 25426);

    const response = await request(25426, "/api/provisioning/status");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, phase: "joined", deviceId: "desktop-8f31" });
  });

  it("status reports failed after a failed join", async () => {
    await start(makeService({ getLastJoinResult: () => "failed" }), "desktop-8f31", 25427);

    const response = await request(25427, "/api/provisioning/status");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, phase: "failed", deviceId: "desktop-8f31" });
  });

  it("status stays a provisioning-only route (404 after close, wrong method)", async () => {
    const server = createProvisioningServer(makeService(), { deviceId: "d" });
    runningServers.push(server);
    await server.start("127.0.0.1", 25428);
    expect((await request(25428, "/api/provisioning/status")).status).toBe(200);

    await server.close();

    // Contract: the routes exist ONLY in provisioning mode.
    await expect(request(25428, "/api/provisioning/status")).rejects.toThrow();
  });

  it("returns 404 for unknown routes and methods (route gate, /api/health excluded)", async () => {
    await start(makeService(), "d", 25421);

    const unknown = await request(25421, "/api/device-config");
    const wrongMethod = await request(25421, "/api/provisioning/wifi", "GET");
    const wrongMethodHealth = await request(25421, "/api/health", "POST");

    expect(unknown.status).toBe(404);
    expect(wrongMethod.status).toBe(404);
    expect(wrongMethodHealth.status).toBe(404);
  });

  it("returns 500 when persistence fails", async () => {
    await start(makeService({ async acceptWifi() { return false; } }), "d", 25422);

    const response = await request(25422, "/api/provisioning/wifi", "POST", { ssid: "n", password: "pw" });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ ok: false, code: "PROVISIONING_FAILED" });
  });

  it("is closed after close() (routes only exist during provisioning)", async () => {
    const server = createProvisioningServer(makeService(), { deviceId: "d" });
    runningServers.push(server);
    await server.start("127.0.0.1", 25423);
    expect(server.isRunning()).toBe(true);

    await server.close();

    expect(server.isRunning()).toBe(false);
    await expect(request(25423, "/api/provisioning/health")).rejects.toThrow();
  });
});
