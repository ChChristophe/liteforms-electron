// Provisioning HTTP server (contract v1). Runs in the MAIN process â€” not in
// the Next server â€” because it must die with the provisioning mode and needs
// safeStorage + the platform WiFi stack. Routes:
//   GET  /api/provisioning/health â†’ 200 contract payload (announces the port)
//   POST /api/provisioning/wifi   â†’ 202 on acceptance / 400 INVALID_WIFI_CONFIG
// The server is closed when provisioning mode ends: the routes exist ONLY in
// provisioning mode (contract invariant). During provisioning this server also
// serves GET /api/health (the Next server is not the reachable origin then),
// answering the contract payload with networkMode:"provisioning" so the Mobile
// knows not to send device-config yet. The WiFi password is never logged
// and never appears in a response or error. Idempotent POSTs.
import http from "node:http";
import { parseWifiCredentials } from "./wifiConfig";
import type { ProvisioningService } from "./provisioningService";

export const DEFAULT_PROVISIONING_PORT = 8080;

export type ProvisioningServer = {
  start(bindIp: string, port: number): Promise<void>;
  close(): Promise<void>;
  isRunning(): boolean;
};

type Logger = (line: string) => void;

function sendJson(response: http.ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

export function createProvisioningServer(
  service: ProvisioningService,
  options: { deviceId: string; log?: Logger } = { deviceId: "desktop" }
): ProvisioningServer {
  const log = options.log ?? (() => {});
  let server: http.Server | null = null;

  const app = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${DEFAULT_PROVISIONING_PORT}`);
    // Method/route gate: anything but the two contract routes gets a flat 404.
    // Contract v1 /api/health, aligned with app/api/health/route.ts fields.
    if (url.pathname === "/api/health" && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        name: "Liteforms Desktop",
        protocolVersion: "1.0",
        configVersions: ["1.0"],
        networkMode: "provisioning"
      });
      return;
    }
    if (url.pathname === "/api/provisioning/health" && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        mode: "provisioning",
        deviceId: options.deviceId,
        name: "Liteforms Desktop",
        protocolVersion: "1.0",
        port: server ? (server.address() as { port: number }).port : DEFAULT_PROVISIONING_PORT
      });
      return;
    }
    if (url.pathname === "/api/provisioning/wifi" && request.method === "POST") {
      let raw = "";
      request.on("data", (chunk: Buffer) => {
        raw += chunk.toString("utf8");
        // Small bodies only; anything bigger is refused before it can pile up.
        if (raw.length > 8192) {
          request.destroy();
        }
      });
      request.on("end", () => {
        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(raw);
        } catch {
          log("provisioning wifi POST :: rejected body-not-JSON");
          sendJson(response, 400, { ok: false, code: "INVALID_WIFI_CONFIG", message: "The request body must be valid JSON" });
          return;
        }
        const result = parseWifiCredentials(parsedBody);
        if (!result.ok) {
          log(`provisioning wifi POST :: rejected code=${result.code}`);
          sendJson(response, 400, { ok: false, code: result.code, message: result.message });
          return;
        }
        void service.acceptWifi(result.credentials).then((accepted) => {
          // Idempotent contract answer: one acceptance shape, never the payload.
          if (accepted) {
            log("provisioning wifi POST :: accepted (credentials persisted, switching network)");
            sendJson(response, 202, { ok: true, restartRequired: true, message: "WiFi configuration accepted" });
          } else {
            log("provisioning wifi POST :: persist failed");
            sendJson(response, 500, { ok: false, code: "PROVISIONING_FAILED", message: "Could not store the WiFi configuration" });
          }
        });
      });
      return;
    }
    sendJson(response, 404, { ok: false, code: "NOT_FOUND", message: "Unknown provisioning route" });
  });

  return {
    async start(bindIp, port) {
      if (server) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server = null;
          reject(error);
        };
        server = app;
        app.once("error", onError);
        app.listen(port, bindIp, () => {
          app.removeListener("error", onError);
          log(`provisioning server :: listening ${bindIp}:${port}`);
          resolve();
        });
      });
    },

    async close() {
      if (!server) {
        return;
      }
      const closing = server;
      server = null;
      await new Promise<void>((resolve) => {
        closing.close(() => resolve());
      });
      log("provisioning server :: closed (routes are now gone)");
    },

    isRunning() {
      return server !== null;
    }
  };
}
