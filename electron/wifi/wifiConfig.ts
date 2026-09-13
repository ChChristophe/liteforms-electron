// Contract mobile v1 — provisioning WiFi payloads (source of truth:
// Liteforms-Mobile-Application/docs/contract + protocol/DEVICE_API.md).
// Isomorphic: used by the main-process provisioning server and testable
// without Electron. The WiFi password NEVER appears in a returned message,
// a log line or an error — validation messages name the field, never the
// value. Unknown fields are ignored.

export const WIFI_SECURITY_VALUES = ["OPEN", "WPA2-PSK", "WPA3-SAE", "WPA2-WPA3"] as const;

export type WifiSecurity = (typeof WIFI_SECURITY_VALUES)[number];

export type WifiCredentials = {
  ssid: string;
  password: string;
  security: WifiSecurity;
};

export type WifiConfigParseResult =
  | { ok: true; credentials: WifiCredentials }
  | { ok: false; code: "INVALID_WIFI_CONFIG"; message: string };

const maxSsidLength = 32;
const maxPasswordLength = 64;

export function isWifiSecurity(value: unknown): value is WifiSecurity {
  return typeof value === "string" && (WIFI_SECURITY_VALUES as readonly string[]).includes(value);
}

/** Parse a `POST /api/provisioning/wifi` body. Contract: ssid 1–32 UTF-8
 * chars; password may be empty only for OPEN; security one of the four
 * allowed values (missing security defaults to WPA2-PSK, tolerant); unknown
 * fields ignored; invalid → `{ok:false, code:"INVALID_WIFI_CONFIG"}`. */
export function parseWifiCredentials(raw: unknown): WifiConfigParseResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, code: "INVALID_WIFI_CONFIG", message: "The request body must be a JSON object" };
  }
  const body = raw as Record<string, unknown>;

  if (typeof body.ssid !== "string" || body.ssid.length < 1 || body.ssid.length > maxSsidLength) {
    return { ok: false, code: "INVALID_WIFI_CONFIG", message: "ssid is required (1 to 32 characters)" };
  }

  const security = body.security === undefined ? "WPA2-PSK" : body.security;
  if (!isWifiSecurity(security)) {
    return {
      ok: false,
      code: "INVALID_WIFI_CONFIG",
      message: `security must be one of: ${WIFI_SECURITY_VALUES.join(", ")}`
    };
  }

  if (typeof body.password !== "string") {
    return { ok: false, code: "INVALID_WIFI_CONFIG", message: "password must be a string" };
  }
  if (security === "OPEN") {
    // Open network: any password field is ignored and normalized to "".
    if (body.password.length > maxPasswordLength) {
      return { ok: false, code: "INVALID_WIFI_CONFIG", message: "password is too long (64 characters max)" };
    }
    return { ok: true, credentials: { ssid: body.ssid, password: "", security } };
  }
  if (body.password.length < 1) {
    return { ok: false, code: "INVALID_WIFI_CONFIG", message: "password is required for a secured network" };
  }
  if (body.password.length > maxPasswordLength) {
    return { ok: false, code: "INVALID_WIFI_CONFIG", message: "password is too long (64 characters max)" };
  }

  return { ok: true, credentials: { ssid: body.ssid, password: body.password, security } };
}

// networkMode of the contract: "wifi" | "ethernet" | "provisioning". The main
// process computes it at boot and hands it to the Next server via
// LITEFORMS_NETWORK_MODE; the health route re-validates instead of trusting
// the env blindly.
export type NetworkMode = "wifi" | "ethernet" | "provisioning";

export function parseNetworkMode(value: unknown): NetworkMode {
  return value === "ethernet" || value === "provisioning" || value === "wifi" ? value : "wifi";
}

/** Effective provisioning port: configuration parameter of the Electron
 * (default 8080, announced in GET /api/provisioning/health — contract §1). */
export function resolveProvisioningPort(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number.parseInt(env.LITEFORMS_PROVISIONING_PORT ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : 8080;
}
