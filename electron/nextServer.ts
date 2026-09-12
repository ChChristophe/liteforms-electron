import http from "node:http";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export type EnvMap = Record<string, string | undefined>;
type NextServerEnv = Record<string, string> & {
  ELECTRON_RUN_AS_NODE: "1";
  HOSTNAME: string;
  NEXT_TELEMETRY_DISABLED: "1";
  NODE_ENV: "production";
  PORT: string;
};

export function resolveStandaloneDir({
  appPath,
  isPackaged,
  resourcesPath
}: {
  appPath: string;
  isPackaged: boolean;
  resourcesPath: string;
}) {
  if (isPackaged) {
    return join(resourcesPath, "next", "standalone");
  }

  return join(appPath, ".next", "standalone");
}

const FORWARDED_ENV_KEYS = [
  "APPDATA",
  "ComSpec",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "Path",
  "SystemRoot",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "WINDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  // Display/session variables: the native Bridge library links GTK3/SDL/X11 and
  // cannot run initialize_bridge in a child process without them on Linux.
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "XDG_RUNTIME_DIR",
  "XDG_SESSION_TYPE",
  "DBUS_SESSION_BUS_ADDRESS"
];

export function createForwardedShellEnv(baseEnv: EnvMap = process.env) {
  const env: Record<string, string> = {};

  for (const key of FORWARDED_ENV_KEYS) {
    const value = baseEnv[key];
    if (value) {
      env[key] = value;
    }
  }

  return env;
}

export function createNextServerEnv({ baseEnv = process.env, port, host = resolveServerHost(baseEnv) }: { baseEnv?: EnvMap; port: number; host?: string }): NextServerEnv {
  return {
    ...createForwardedShellEnv(baseEnv),
    ELECTRON_RUN_AS_NODE: "1",
    HOSTNAME: host,
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: "production",
    PORT: String(port)
  };
}

// Renderer keeps loading 127.0.0.1 (loopback always answers a 0.0.0.0/LAN bind),
// so the Chromium origin — and with it browser storage — stays unchanged.
// Binding wide is an explicit opt-in for the mobile POC; never the default.
export function resolveServerHost(baseEnv: EnvMap = process.env): string {
  const declared = baseEnv.LITEFORMS_SERVER_HOST;
  return declared === "0.0.0.0" || declared === "::" ? declared : "127.0.0.1";
}

// Fixed port: Chromium keys localStorage/IndexedDB per origin (host + port), so
// a random port per launch made every restart start from empty storage (API
// keys, session/character config, VRM were written but never read again).
export const LITEFORMS_SERVER_PORT = 43178;

export async function isHttpServerUp(url: string) {
  try {
    await probeHttpServer(url);
    return true;
  } catch {
    return false;
  }
}

export async function waitForHttpServer(url: string, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await probeHttpServer(url);
      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }

  const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for the packaged Next server at ${url}.${detail}`);
}

function probeHttpServer(url: string) {
  return new Promise<void>((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve();
    });

    request.setTimeout(2000, () => {
      request.destroy(new Error("HTTP probe timed out."));
    });
    request.on("error", reject);
  });
}
