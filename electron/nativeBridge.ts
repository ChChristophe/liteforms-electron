import type { IpcMain } from "electron";
import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { createForwardedShellEnv } from "./nextServer";
import { resolveNativeBridgeRuntime } from "./nativeBridgePaths";

export const nativeBridgeGetStateChannel = "liteforms:nativeBridge:getState";
export const nativeBridgeGetDriverStatusChannel = "liteforms:nativeBridge:getDriverStatus";

type NativeBridgeState =
  | {
      available: true;
      source: "native";
      display: unknown;
      calibration: unknown;
      viewControls?: unknown;
    }
  | {
      available: false;
      source: "native";
      error: string;
    };

type NativeBridgeDriverStatus =
  | {
      available: true;
      source: "native";
      platformDir: string;
      runtimeDir: string;
      libraryPath: string;
      libraryName: string;
      runtimeSource: "bundled" | "override";
    }
  | {
      available: false;
      source: "native";
      error: string;
    };

type SupportedNativeBridgeRuntime = Extract<ReturnType<typeof resolveNativeBridgeRuntime>, { supported: true }>;
type ElectronChildProcessEnv = NodeJS.ProcessEnv & { NODE_ENV: string };

type NativeBridgeService = {
  getDriverStatus(): Promise<NativeBridgeDriverStatus>;
  getState(): Promise<NativeBridgeState>;
  dispose(): void;
};

type NativeBridgeLogger = (line: string) => void;

// The bridge runtime ships inside an AppImage built with compression: "maximum"
// (squashfs), so a cold dlopen of libbridge_inproc.so and its bundled
// ffmpeg/GTK dependency graph takes several seconds on mini-PC hardware. 7s was
// hit exactly at the boundary and produced false negatives; allow for a slow
// first load.
const probeTimeoutMs = 30000;
const cacheTtlMs = 2500;
const nativeBridgeProbeResultFd = 3;
const nativeBridgeProbeResultFdEnv = "LITEFORMS_NATIVE_BRIDGE_RESULT_FD";
const maxStderrExcerptLength = 300;
const probeSigkillDelayMs = 2000;

function singleLine(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function summarizeNativeBridgeState(state: NativeBridgeState): string {
  if (!state.available) return `available=false error="${singleLine(state.error)}"`;

  const display = state.display as {
    name?: string;
    serial?: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
  };
  const viewControls = state.viewControls as
    | { columns?: number; rows?: number; quiltResolution?: { width?: number; height?: number } }
    | undefined;
  const quilt = viewControls?.columns && viewControls?.rows
    ? ` quilt=${viewControls.columns}x${viewControls.rows}`
    : "";
  return (
    `available=true display="${display.name || "?"}" serial="${display.serial || "-"}" ` +
    `${display.width ?? "?"}x${display.height ?? "?"} pos=${display.x ?? "?"},${display.y ?? "?"}${quilt}`
  );
}

/**
 * Collapses concurrent calls onto one in-flight promise: while `run` is pending
 * every caller receives the same promise, and the slot is cleared once it
 * settles (success, rejection or timeout) so the next call starts fresh.
 */
export function createSingleFlight<T>(run: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | undefined;
  return () => {
    if (!inFlight) {
      inFlight = run().finally(() => {
        inFlight = undefined;
      });
    }
    return inFlight;
  };
}

/**
 * A probe blocked inside a native dlopen has no working event loop and may never
 * honour SIGTERM, so escalate to SIGKILL after a short grace period. The
 * follow-up timer is unref'd so it cannot keep the host process alive.
 */
function killProbe(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  child.kill("SIGTERM");
  const escalation = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }, probeSigkillDelayMs);
  escalation.unref();
}

export function createNativeBridgeService(log?: NativeBridgeLogger): NativeBridgeService {
  let activeProbe: ChildProcess | undefined;
  let cachedState: { state: NativeBridgeState; createdAt: number } | undefined;
  let lastLoggedStateKey: string | undefined;

  const logState = (state: NativeBridgeState) => {
    const key = summarizeNativeBridgeState(state);
    if (key === lastLoggedStateKey) return;
    lastLoggedStateKey = key;
    log?.(`nativeBridge probe :: ${key}`);
  };

  const getState = async (): Promise<NativeBridgeState> => {
    if (cachedState && Date.now() - cachedState.createdAt < cacheTtlMs) {
      logState(cachedState.state);
      return cachedState.state;
    }

    // Single-flight: overlapping calls (page.tsx polls every 1500ms while the
    // cache TTL is 2500ms) must await the same probe instead of spawning
    // multiple 96MB children.
    const state = await probeOnce();
    cachedState = { state, createdAt: Date.now() };
    logState(state);
    return state;
  };

  const getResolvedRuntime = () => {
    const resolved = resolveNativeBridgeRuntime({
      appPath: app.getAppPath(),
      arch: process.arch,
      env: process.env,
      isPackaged: app.isPackaged,
      platform: process.platform,
      resourcesPath: process.resourcesPath
    });

    return resolved;
  };

  const getDriverStatus = async (): Promise<NativeBridgeDriverStatus> => {
    const resolved = getResolvedRuntime();

    if (!resolved.supported) {
      return {
        available: false,
        source: "native",
        error: resolved.reason
      };
    }

    if (!existsSync(resolved.libraryPath)) {
      return {
        available: false,
        source: "native",
        error: `Missing native Bridge library at ${resolved.libraryPath}.`
      };
    }

    return {
      available: true,
      source: "native",
      platformDir: resolved.platformDir,
      runtimeDir: resolved.runtimeDir,
      libraryPath: resolved.libraryPath,
      libraryName: resolved.libraryName,
      runtimeSource: resolved.source
    };
  };

  const probeNativeBridge = async (): Promise<NativeBridgeState> => {
    const resolved = getResolvedRuntime();

    if (!resolved.supported) {
      return {
        available: false,
        source: "native",
        error: resolved.reason
      };
    }

    if (!existsSync(resolved.libraryPath)) {
      return {
        available: false,
        source: "native",
        error: `Missing native Bridge library at ${resolved.libraryPath}.`
      };
    }

    const helperPath = join(__dirname, "nativeBridgeProbe.js");
    if (!existsSync(helperPath)) {
      return {
        available: false,
        source: "native",
        error: `Missing native Bridge probe helper at ${helperPath}.`
      };
    }

    return await new Promise<NativeBridgeState>((resolve) => {
      const env = createNativeBridgeProbeEnv(resolved);
      const child = spawn(process.execPath, [helperPath], {
        cwd: resolved.runtimeDir,
        env,
        stdio: ["ignore", "pipe", "pipe", "pipe"],
        windowsHide: true
      });
      activeProbe = child;
      log?.(`nativeBridge probe start :: ${resolved.libraryPath}`);

      let resultOutput = "";
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        activeProbe = undefined;
        killProbe(child);
        log?.(`nativeBridge probe timed out after ${probeTimeoutMs}ms`);
        resolve({
          available: false,
          source: "native",
          error: `Native Bridge probe timed out after ${probeTimeoutMs}ms.`
        });
      }, probeTimeoutMs);

      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.stdio[nativeBridgeProbeResultFd]?.on("data", (chunk) => {
        resultOutput += chunk.toString();
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        activeProbe = undefined;
        clearTimeout(timeout);
        log?.(`nativeBridge probe error :: ${error.message}`);
        resolve({
          available: false,
          source: "native",
          error: error.message
        });
      });
      child.on("close", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        activeProbe = undefined;

        const output = (resultOutput || stdout).trim();
        if (!output) {
          const stderrExcerpt = singleLine(stderr).slice(0, maxStderrExcerptLength);
          const reason = stderrExcerpt || `probe exited with code ${code ?? "null"} and signal ${signal ?? "null"}`;
          log?.(`nativeBridge probe failed :: ${reason}`);
          resolve({
            available: false,
            source: "native",
            // A silent exit (code 0, no output) is how the in-process Bridge
            // library reports an initialization failure (no reachable device,
            // missing USB permission or missing system library). Surface what
            // the library printed so the failure is diagnosable in the field.
            error: `Native Bridge probe returned no data (${reason}).` +
              (stderrExcerpt
                ? ""
                : " Check that the Looking Glass is connected over USB (not only HDMI), is USB-accessible (udev permissions) and that required system libraries are installed.")
          });
          return;
        }

        try {
          resolve(JSON.parse(output) as NativeBridgeState);
        } catch {
          log?.(`nativeBridge probe returned invalid JSON :: ${singleLine(output).slice(0, maxStderrExcerptLength)}`);
          resolve({
            available: false,
            source: "native",
            error: `Native Bridge probe returned invalid JSON: ${output}`
          });
        }
      });
    });
  };

  const probeOnce = createSingleFlight<NativeBridgeState>(probeNativeBridge);

  return {
    getDriverStatus,
    getState,
    dispose() {
      if (activeProbe) {
        killProbe(activeProbe);
      }
      activeProbe = undefined;
    }
  };
}

function createNativeBridgeProbeEnv(resolved: SupportedNativeBridgeRuntime): ElectronChildProcessEnv {
  const env: ElectronChildProcessEnv = {
    ...createForwardedShellEnv(process.env),
    ELECTRON_RUN_AS_NODE: "1",
    LITEFORMS_NATIVE_BRIDGE_LIBRARY: resolved.libraryPath,
    [nativeBridgeProbeResultFdEnv]: String(nativeBridgeProbeResultFd),
    LITEFORMS_NATIVE_BRIDGE_RUNTIME_DIR: resolved.runtimeDir,
    NODE_ENV: process.env.NODE_ENV ?? "production"
  };

  if (process.platform === "win32") {
    const pathKey = env.Path ? "Path" : "PATH";
    const currentPath = env.Path ?? env.PATH ?? "";
    delete env.PATH;
    delete env.Path;
    env[pathKey] = currentPath ? `${resolved.runtimeDir}${delimiter}${currentPath}` : resolved.runtimeDir;
  }

  if (process.platform === "darwin") {
    const currentPath = env.DYLD_LIBRARY_PATH ?? "";
    env.DYLD_LIBRARY_PATH = currentPath ? `${resolved.runtimeDir}${delimiter}${currentPath}` : resolved.runtimeDir;
  }

  if (process.platform === "linux") {
    const currentPath = env.LD_LIBRARY_PATH ?? "";
    env.LD_LIBRARY_PATH = currentPath ? `${resolved.runtimeDir}:${currentPath}` : resolved.runtimeDir;
  }

  return env;
}

export function registerNativeBridgeIpc(ipcMain: IpcMain, log?: NativeBridgeLogger) {
  const service = createNativeBridgeService(log);
  ipcMain.handle(nativeBridgeGetDriverStatusChannel, () => service.getDriverStatus());
  ipcMain.handle(nativeBridgeGetStateChannel, () => service.getState());
  return service;
}
