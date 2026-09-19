// Main-process OpenClaw gateway token discovery (POC.md §7.1 — product
// decision 12/09/2026: remove the manual OpenClaw token entry). This module
// locates the token of the LOCAL OpenClaw installation so the user never has to
// paste it. Strictly local secret: the token is never logged, never served over
// HTTP and never sent to the Mobile; callers only get the value plus a coarse
// source label ("env" | "cli" | "env-file" | "config") suitable for a redacted
// diagnostic line.
//
// Resolution order (first non-empty wins):
//   1. process.env.OPENCLAW_GATEWAY_TOKEN
//   2. `openclaw config get gateway.auth.token` — the canonical path: the CLI
//      resolves JSON5, $include and SecretRefs itself.
//   3. env files (~/.openclaw/.env, ~/.openclaw/gateway.systemd.env,
//      $OPENCLAW_STATE_DIR/.env, $OPENCLAW_STATE_DIR/gateway.systemd.env,
//      ~/.config/openclaw/gateway.env), then the service definitions that hold
//      the gateway's real runtime env (systemd user units + drop-ins on Linux,
//      the gateway.cmd task script on Windows), then the `env` block of
//      openclaw.json.
//   4. literal `gateway.auth.token` in the OpenClaw config file.
//
// Any failure (missing/unreadable/malformed file, missing binary, spawn error,
// timeout) resolves to null: the renderer's manual entry stays as fallback.
import { spawn as nodeSpawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir as nodeHomedir } from "node:os";
import { posix, win32 } from "node:path";

export type OpenClawTokenSource = "env" | "cli" | "env-file" | "config";

export type OpenClawToken = {
  token: string;
  source: OpenClawTokenSource;
};

export type SpawnedChild = {
  stdout?: { on(event: "data", listener: (chunk: unknown) => void): unknown } | null;
  on(event: "error" | "close", listener: (value?: unknown) => void): unknown;
  kill?: () => unknown;
};

export type SpawnOptionsLike = {
  windowsHide?: boolean;
  timeout?: number;
  windowsVerbatimArguments?: boolean;
};

export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsLike
) => SpawnedChild;

export type OpenClawTokenDeps = {
  env: Record<string, string | undefined>;
  fs: {
    /** Returns the file text, or null when absent/unreadable. */
    readFile: (path: string) => string | null;
    exists: (path: string) => boolean;
    /**
     * Returns entry names, or null when the directory is absent/unreadable.
     * Optional so existing injected deps keep working; when omitted, directory
     * scans (systemd units) are simply skipped.
     */
    listDir?: (path: string) => string[] | null;
  };
  spawn: SpawnLike;
  homedir: () => string;
  platform: NodeJS.Platform;
  /** CLI timeout in ms (overridable for tests). Defaults to 5000. */
  timeoutMs?: number;
};

const CLI_TIMEOUT_MS = 5000;
const TOKEN_ENV_VAR = "OPENCLAW_GATEWAY_TOKEN";
/**
 * `openclaw config get` does not print secrets: it substitutes this sentinel
 * (verified against OpenClaw 2026.7.1-2). A sentinel is NOT a usable token —
 * treat it as absent so resolution falls through to the files.
 */
const REDACTED_SENTINEL = "__OPENCLAW_REDACTED__";
/** Candidate config basenames, including the tolerant/legacy variants. */
const CONFIG_FILE_NAMES = ["openclaw.json", "openclaw.json5", "openclaw.jsonc"];
/** Auth modes where the gateway deliberately has no bearer token. */
const TOKENLESS_AUTH_MODES = new Set(["password", "none", "trusted-proxy"]);
const SECRET_REF = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/;
const WINDOWS_SHIM = /\.(cmd|bat)$/i;

function defaultDeps(): OpenClawTokenDeps {
  return {
    env: process.env,
    fs: {
      readFile: (path) => {
        try {
          return readFileSync(path, "utf8");
        } catch {
          return null;
        }
      },
      exists: (path) => {
        try {
          return existsSync(path);
        } catch {
          return false;
        }
      },
      listDir: (path) => {
        try {
          return readdirSync(path);
        } catch {
          return null;
        }
      }
    },
    spawn: ((command: string, args: readonly string[], options: SpawnOptionsLike) =>
      nodeSpawn(command, args as string[], options as Parameters<typeof nodeSpawn>[2]) as unknown as SpawnedChild) as SpawnLike,
    homedir: nodeHomedir,
    platform: process.platform
  };
}

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** A usable token is non-empty and not OpenClaw's redaction sentinel. */
function usableToken(value: string | null | undefined): string | null {
  const trimmed = nonEmpty(value);
  if (trimmed === null || trimmed.includes(REDACTED_SENTINEL)) return null;
  return trimmed;
}

/** Path shape follows the injected platform so tests can exercise both OSes. */
function joinFor(platform: NodeJS.Platform, ...parts: string[]): string {
  return platform === "win32" ? win32.join(...parts) : posix.join(...parts);
}

function expandHome(value: string, home: string): string {
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) return `${home}${value.slice(1)}`;
  return value;
}

function configCandidates(deps: OpenClawTokenDeps): string[] {
  const home = deps.homedir();
  const candidates: string[] = [];
  const explicit = nonEmpty(deps.env.OPENCLAW_CONFIG_PATH);
  if (explicit) candidates.push(expandHome(explicit, home));
  const stateDir = nonEmpty(deps.env.OPENCLAW_STATE_DIR);
  if (stateDir) for (const name of CONFIG_FILE_NAMES) candidates.push(joinFor(deps.platform, stateDir, name));
  for (const name of CONFIG_FILE_NAMES) candidates.push(joinFor(deps.platform, home, ".openclaw", name));
  return candidates;
}

function envFileCandidates(deps: OpenClawTokenDeps): string[] {
  const home = deps.homedir();
  const candidates = [
    joinFor(deps.platform, home, ".openclaw", ".env"),
    joinFor(deps.platform, home, ".openclaw", "gateway.systemd.env")
  ];
  const stateDir = nonEmpty(deps.env.OPENCLAW_STATE_DIR);
  if (stateDir) {
    candidates.push(joinFor(deps.platform, stateDir, ".env"));
    candidates.push(joinFor(deps.platform, stateDir, "gateway.systemd.env"));
  }
  candidates.push(joinFor(deps.platform, home, ".config", "openclaw", "gateway.env"));
  return candidates;
}

function readFirstExistingConfig(deps: OpenClawTokenDeps): { path: string; text: string } | null {
  for (const path of configCandidates(deps)) {
    const text = deps.fs.readFile(path);
    if (text !== null) return { path, text };
  }
  return null;
}

/** Minimal `.env` reader: KEY=VALUE, optional `export`, optional quotes. */
function parseEnvFile(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const body = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (key.length > 0) out[key] = value;
  }
  return out;
}

/** Normalised check that `candidate` stays inside `root` (path-segment safe). */
function isWithinRoot(platform: NodeJS.Platform, candidate: string, root: string): boolean {
  const path = platform === "win32" ? win32 : posix;
  const normalised = path.normalize(candidate);
  const base = path.normalize(root);
  if (normalised === base) return true;
  const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  return platform === "win32"
    ? normalised.toLowerCase().startsWith(prefix.toLowerCase())
    : normalised.startsWith(prefix);
}

/**
 * Resolves one `EnvironmentFile=` word: strips the optional `-` (ignore-if-
 * missing) prefix, expands the systemd `%h` specifier and accepts only an
 * absolute path confined to the home or state dir — `/etc/...` is ignored.
 */
function resolveEnvironmentFilePath(
  deps: OpenClawTokenDeps,
  word: string,
  home: string
): string | null {
  const stripped = word.startsWith("-") ? word.slice(1) : word;
  if (stripped.length === 0) return null;
  const resolved = expandHome(stripped.replace(/%h/g, home), home);
  const path = deps.platform === "win32" ? win32 : posix;
  if (!path.isAbsolute(resolved)) return null;
  const roots = [home];
  const stateDir = nonEmpty(deps.env.OPENCLAW_STATE_DIR);
  if (stateDir) roots.push(expandHome(stateDir, home));
  return roots.some((root) => isWithinRoot(deps.platform, resolved, root)) ? resolved : null;
}

/** Splits a systemd value into words, honouring double and single quotes. */
function splitUnitWords(value: string): string[] {
  const words: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) words.push(match[1] ?? match[2] ?? match[3]);
  return words;
}

/** Extracts `OPENCLAW_GATEWAY_TOKEN=` from one `Environment=` directive value. */
function readUnitEnvironmentToken(value: string): string | null {
  let body = value.trim();
  const outer =
    body.length >= 2 &&
    ((body.startsWith('"') && body.endsWith('"')) || (body.startsWith("'") && body.endsWith("'")));
  if (outer) body = body.slice(1, -1);
  const marker = `${TOKEN_ENV_VAR}=`;
  const index = body.indexOf(marker);
  if (index < 0) return null;
  const rest = body.slice(index + marker.length).trimStart();
  const quote = rest.startsWith('"') || rest.startsWith("'") ? rest[0] : null;
  if (quote) {
    const end = rest.indexOf(quote, 1);
    return end < 0 ? null : rest.slice(1, end);
  }
  if (outer) return rest.trim();
  const match = /^\S+/.exec(rest);
  return match ? match[0] : null;
}

type SystemdUnitTokens = { token: string | null; envFiles: string[] };

/** Best-effort parse of a unit/drop-in: inline `Environment` + confined `EnvironmentFile`. */
function parseSystemdUnit(deps: OpenClawTokenDeps, text: string, home: string): SystemdUnitTokens {
  let token: string | null = null;
  const envFiles: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key === "Environment") {
      const found = usableToken(readUnitEnvironmentToken(value));
      if (token === null && found) token = found;
    } else if (key === "EnvironmentFile") {
      for (const word of splitUnitWords(value)) {
        const path = resolveEnvironmentFilePath(deps, word, home);
        if (path) envFiles.push(path);
      }
    }
  }
  return { token, envFiles };
}

/** Reads Linux systemd user units and drop-ins for the gateway token (best effort). */
function readSystemdToken(deps: OpenClawTokenDeps): string | null {
  const listDir = deps.fs.listDir;
  if (!listDir) return null;
  const home = deps.homedir();
  const userDir = joinFor(deps.platform, home, ".config", "systemd", "user");
  const entries = listDir(userDir);
  if (!entries) return null;
  const units = entries.filter((name) => /^openclaw-gateway.*\.service$/.test(name)).sort();
  const texts: string[] = [];
  for (const unit of units) {
    const text = deps.fs.readFile(joinFor(deps.platform, userDir, unit));
    if (text !== null) texts.push(text);
    const dropInDir = joinFor(deps.platform, userDir, `${unit}.d`);
    const dropIns = listDir(dropInDir);
    if (!dropIns) continue;
    for (const conf of dropIns.filter((name) => name.endsWith(".conf")).sort()) {
      const confText = deps.fs.readFile(joinFor(deps.platform, dropInDir, conf));
      if (confText !== null) texts.push(confText);
    }
  }
  let token: string | null = null;
  const envFiles: string[] = [];
  for (const text of texts) {
    const parsed = parseSystemdUnit(deps, text, home);
    if (token === null && parsed.token) token = parsed.token;
    envFiles.push(...parsed.envFiles);
  }
  if (token) return token;
  for (const path of envFiles) {
    const raw = deps.fs.readFile(path);
    if (raw === null) continue;
    const found = usableToken(parseEnvFile(raw)[TOKEN_ENV_VAR]);
    if (found) return found;
  }
  return null;
}

/** Reads the Windows `gateway.cmd` task script for `set OPENCLAW_GATEWAY_TOKEN=`. */
function parseCmdToken(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*set\s+"?OPENCLAW_GATEWAY_TOKEN=(.*)$/i.exec(line);
    if (!match) continue;
    let value = match[1].trim();
    if (value.startsWith('"')) {
      const end = value.indexOf('"', 1);
      if (end < 0) continue;
      value = value.slice(1, end);
    } else if (value.endsWith('"')) {
      value = value.slice(0, -1);
    }
    const found = usableToken(value);
    if (found) return found;
  }
  return null;
}

function readWindowsCmdToken(deps: OpenClawTokenDeps): string | null {
  const home = deps.homedir();
  const candidates: string[] = [];
  const stateDir = nonEmpty(deps.env.OPENCLAW_STATE_DIR);
  if (stateDir) candidates.push(joinFor(deps.platform, stateDir, "gateway.cmd"));
  candidates.push(joinFor(deps.platform, home, ".openclaw", "gateway.cmd"));
  for (const path of candidates) {
    const raw = deps.fs.readFile(path);
    if (raw === null) continue;
    const token = parseCmdToken(raw);
    if (token) return token;
  }
  return null;
}

/** Removes `//` and block comments while respecting quoted strings. */
function stripComments(source: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      out += char;
      if (char === "\\") {
        out += source[i + 1] ?? "";
        i++;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      continue;
    }
    if (char === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (char === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += char;
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Returns the body of the first `<key>: { ... }` object (brace-matched). */
function findObjectBody(source: string, key: string): string | null {
  const match = new RegExp(`(?:^|[\\s,{])["']?${escapeRegExp(key)}["']?\\s*:\\s*\\{`).exec(source);
  if (!match) return null;
  const openBrace = match.index + match[0].length - 1;
  let depth = 0;
  let quote: string | null = null;
  for (let i = openBrace; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === "\\") {
        i++;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return source.slice(openBrace + 1, i);
    }
  }
  return null;
}

/** Reads a scalar string value for `key` (quoted or bare). */
function readScalar(source: string, key: string): string | null {
  const pattern =
    `(?:^|[\\s,{])["']?${escapeRegExp(key)}["']?\\s*:\\s*` +
    `(?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)'|([^\\s,}]+))`;
  const match = new RegExp(pattern).exec(source);
  if (!match) return null;
  return nonEmpty(match[1] ?? match[2] ?? match[3]);
}

/** Parses an inline object body `{ KEY: VALUE, ... }` into a string map. */
function readObjectEntries(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pattern =
    `(?:^|[\\s,{])(?:"([^"]+)"|'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))\\s*:\\s*` +
    `(?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)'|([^\\s,}]+))`;
  const re = new RegExp(pattern, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const key = match[1] ?? match[2] ?? match[3];
    const value = match[4] ?? match[5] ?? match[6];
    if (key && value !== undefined) out[key] = value;
  }
  return out;
}

/** Resolves a `${VAR}` SecretRef against the known env, else returns literal. */
function resolveConfigToken(value: string, env: Record<string, string | undefined>): string | null {
  const match = SECRET_REF.exec(value);
  if (!match) return usableToken(value);
  return usableToken(env[match[1]]);
}

/** Picks the first existing CLI binary, else lets the OS resolve the name. */
function resolveOpenClawBinary(deps: OpenClawTokenDeps): string {
  const isWindows = deps.platform === "win32";
  const exeName = isWindows ? "openclaw.cmd" : "openclaw";
  const separator = isWindows ? ";" : ":";
  const pathDirs = (deps.env.PATH ?? "").split(separator).filter((dir) => dir.length > 0);
  const fallbacks = isWindows
    ? [
        joinFor(deps.platform, deps.env.APPDATA ?? "", "npm", exeName),
        joinFor(deps.platform, deps.env.ProgramFiles ?? "", "openclaw", exeName)
      ]
    : [
        "/usr/local/bin/openclaw",
        "/usr/bin/openclaw",
        joinFor(deps.platform, deps.homedir(), ".local/bin", exeName),
        // nvm's per-version bin dir is only covered when PATH exposes it.
        joinFor(deps.platform, deps.homedir(), ".npm-global/bin", exeName)
      ];
  for (const candidate of [...pathDirs.map((dir) => joinFor(deps.platform, dir, exeName)), ...fallbacks]) {
    try {
      if (deps.fs.exists(candidate)) return candidate;
    } catch {
      /* ignore a broken exists probe and keep looking */
    }
  }
  return exeName;
}

function runCommand(
  deps: OpenClawTokenDeps,
  command: string,
  args: readonly string[],
  verbatim: boolean
): Promise<string | null> {
  const timeoutMs = deps.timeoutMs ?? CLI_TIMEOUT_MS;
  return new Promise((resolve) => {
    let child: SpawnedChild;
    try {
      child = deps.spawn(command, args, {
        windowsHide: true,
        timeout: timeoutMs,
        ...(verbatim ? { windowsVerbatimArguments: true } : {})
      });
    } catch {
      resolve(null);
      return;
    }
    let settled = false;
    let output = "";
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try {
        child.kill?.();
      } catch {
        /* ignore a kill failure; we still fall back */
      }
      finish(null);
    }, timeoutMs);
    try {
      child.stdout?.on("data", (chunk) => {
        output += String(chunk);
      });
      child.on("error", () => finish(null));
      child.on("close", (code) => finish(code === 0 ? output.trim() || null : null));
    } catch {
      finish(null);
    }
  });
}

async function readTokenFromCli(deps: OpenClawTokenDeps): Promise<string | null> {
  const binary = resolveOpenClawBinary(deps);
  const args = ["config", "get", "gateway.auth.token"];
  // Windows `.cmd` shims cannot be spawned directly without a shell; the
  // arguments are hardcoded so there is nothing to inject. The verbatim,
  // double-quoted form survives spaces in the shim path.
  const isShim = deps.platform === "win32" && WINDOWS_SHIM.test(binary);
  const output = isShim
    ? await runCommand(deps, "cmd.exe", ["/d", "/s", "/c", `""${binary}" ${args.join(" ")}"`], true)
    : await runCommand(deps, binary, args, false);
  return usableToken(output);
}

/**
 * Resolves the local OpenClaw gateway token. Never throws; returns null when no
 * local token can be found (manual entry remains the fallback).
 */
export async function resolveOpenClawGatewayToken(
  deps: OpenClawTokenDeps = defaultDeps()
): Promise<OpenClawToken | null> {
  try {
    // 1. Direct environment variable.
    const direct = usableToken(deps.env[TOKEN_ENV_VAR]);
    if (direct) return { token: direct, source: "env" };

    // 2. Canonical CLI: resolves JSON5, $include and SecretRefs server-side.
    const fromCli = await readTokenFromCli(deps);
    if (fromCli) return { token: fromCli, source: "cli" };

    // 3. Env files, then the service definitions that carry the gateway's real
    //    runtime env, then the `env` block of the config file. A service value
    //    (systemd unit / drop-in, Windows task script) outranks a literal
    //    gateway.auth.token resolved later.
    const envMap: Record<string, string | undefined> = { ...deps.env };
    for (const path of envFileCandidates(deps)) {
      const raw = deps.fs.readFile(path);
      if (raw !== null) Object.assign(envMap, parseEnvFile(raw));
    }
    const serviceToken =
      deps.platform === "win32" ? readWindowsCmdToken(deps) : readSystemdToken(deps);
    if (serviceToken) return { token: serviceToken, source: "env-file" };

    const config = readFirstExistingConfig(deps);
    const configSource = config ? stripComments(config.text) : null;
    if (configSource) {
      const envBlock = findObjectBody(configSource, "env");
      if (envBlock) {
        for (const [key, value] of Object.entries(readObjectEntries(envBlock))) envMap[key] = value;
      }
    }
    const fromFiles = usableToken(envMap[TOKEN_ENV_VAR]);
    if (fromFiles) return { token: fromFiles, source: "env-file" };

    // 4. Literal gateway.auth.token, unless the gateway has no bearer token.
    if (configSource) {
      const gateway = findObjectBody(configSource, "gateway");
      const auth = gateway ? findObjectBody(gateway, "auth") : null;
      if (auth) {
        const mode = readScalar(auth, "mode")?.toLowerCase() ?? null;
        if (mode === null || !TOKENLESS_AUTH_MODES.has(mode)) {
          const rawToken = readScalar(auth, "token");
          if (rawToken) {
            const resolved = resolveConfigToken(rawToken, envMap);
            if (resolved) return { token: resolved, source: "config" };
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}
