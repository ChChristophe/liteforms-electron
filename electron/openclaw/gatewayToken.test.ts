import { win32 } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  resolveOpenClawGatewayToken,
  type OpenClawTokenDeps,
  type SpawnLike,
  type SpawnedChild,
  type SpawnOptionsLike
} from "./gatewayToken";

type SpawnBehaviour = {
  stdout?: string;
  code?: number | null;
  error?: Error;
  /** Never emits close/error: the module's own timeout must fire. */
  hang?: boolean;
  /** Throws synchronously out of spawn (missing binary on some platforms). */
  throwSync?: boolean;
};

type SpawnCall = { command: string; args: readonly string[]; options: SpawnOptionsLike };

function createSpawnStub(behaviour: (command: string, args: readonly string[]) => SpawnBehaviour = () => ({ code: 1 })) {
  const calls: SpawnCall[] = [];
  const kills: number[] = [];
  const spawn: SpawnLike = (command, args, options) => {
    calls.push({ command, args, options });
    const result = behaviour(command, args);
    if (result.throwSync) throw result.error ?? new Error("spawn failed");
    const dataListeners: Array<(chunk: unknown) => void> = [];
    const errorListeners: Array<(value?: unknown) => void> = [];
    const closeListeners: Array<(value?: unknown) => void> = [];
    const child: SpawnedChild = {
      stdout: {
        on: (_event, listener) => {
          dataListeners.push(listener);
        }
      },
      on: (event, listener) => {
        if (event === "error") errorListeners.push(listener);
        else closeListeners.push(listener);
      },
      kill: () => {
        kills.push(1);
      }
    };
    queueMicrotask(() => {
      if (result.hang) return;
      if (result.error) {
        errorListeners.forEach((listener) => listener());
        return;
      }
      if (result.stdout !== undefined) dataListeners.forEach((listener) => listener(result.stdout));
      closeListeners.forEach((listener) => listener(result.code ?? 0));
    });
    return child;
  };
  return { spawn, calls, kills };
}

type DepsOptions = {
  env?: Record<string, string | undefined>;
  files?: Record<string, string>;
  dirs?: Record<string, string[]>;
  spawn?: SpawnLike;
  homedir?: string;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
};

function makeDeps(options: DepsOptions = {}) {
  const files = options.files ?? {};
  const dirs = options.dirs ?? {};
  const readPaths: string[] = [];
  const deps: OpenClawTokenDeps = {
    env: options.env ?? {},
    fs: {
      readFile: (path) => {
        readPaths.push(path);
        return path in files ? files[path] : null;
      },
      exists: (path) => path in files,
      listDir: (path) => (path in dirs ? dirs[path] : null)
    },
    spawn: options.spawn ?? (() => {
      throw new Error("spawn not expected");
    }),
    homedir: () => options.homedir ?? "C:\\Users\\x",
    platform: options.platform ?? "win32",
    timeoutMs: options.timeoutMs
  };
  return { deps, readPaths };
}

const WINDOWS_CONFIG = win32.join("C:\\Users\\x", ".openclaw", "openclaw.json");
const WINDOWS_DOTENV = win32.join("C:\\Users\\x", ".openclaw", ".env");

const LINUX_HOME = "/home/x";
const LINUX_UNIT_DIR = "/home/x/.config/systemd/user";
const LINUX_UNIT = "/home/x/.config/systemd/user/openclaw-gateway.service";

describe("resolveOpenClawGatewayToken", () => {
  it("prefers OPENCLAW_GATEWAY_TOKEN from the environment and never spawns", async () => {
    const stub = createSpawnStub(() => ({ stdout: "cli-token" }));
    const { deps } = makeDeps({ env: { OPENCLAW_GATEWAY_TOKEN: "env-token" }, spawn: stub.spawn });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "env-token", source: "env" });
    expect(stub.calls).toHaveLength(0);
  });

  it("reads the token from the OpenClaw CLI on Windows through the .cmd shim", async () => {
    const stub = createSpawnStub(() => ({ stdout: "cli-token\n", code: 0 }));
    const { deps } = makeDeps({ spawn: stub.spawn, env: { APPDATA: "C:\\Users\\x\\AppData\\Roaming" } });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "cli-token", source: "cli" });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].command).toBe("cmd.exe");
    expect(stub.calls[0].options.windowsVerbatimArguments).toBe(true);
    const commandLine = String(stub.calls[0].args[stub.calls[0].args.length - 1]);
    expect(commandLine).toContain("config get gateway.auth.token");
  });

  it("spawns the binary directly on Linux", async () => {
    const stub = createSpawnStub(() => ({ stdout: "cli-linux", code: 0 }));
    const { deps } = makeDeps({
      platform: "linux",
      homedir: "/home/x",
      spawn: stub.spawn,
      files: { "/usr/local/bin/openclaw": "# shim" }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "cli-linux", source: "cli" });
    expect(stub.calls[0].command).toBe("/usr/local/bin/openclaw");
    expect(stub.calls[0].options.windowsVerbatimArguments).toBeUndefined();
  });

  it("falls back to env files when the CLI errors", async () => {
    const stub = createSpawnStub(() => ({ error: new Error("ENOENT") }));
    const { deps } = makeDeps({
      spawn: stub.spawn,
      files: { [WINDOWS_DOTENV]: "OPENCLAW_GATEWAY_TOKEN=file-token\n" }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "file-token", source: "env-file" });
  });

  it("falls back to the env block of openclaw.json", async () => {
    const stub = createSpawnStub(() => ({ code: 1 }));
    const { deps } = makeDeps({
      spawn: stub.spawn,
      files: {
        [WINDOWS_CONFIG]: '{\n  "env": { "OPENCLAW_GATEWAY_TOKEN": "block-token" },\n  "gateway": { "auth": { "mode": "token" } }\n}'
      }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "block-token", source: "env-file" });
  });

  it("resolves a config SecretRef for OPENCLAW_GATEWAY_TOKEN from ~/.openclaw/.env", async () => {
    const stub = createSpawnStub(() => ({ code: 1 }));
    const { deps } = makeDeps({
      spawn: stub.spawn,
      files: {
        [WINDOWS_DOTENV]: "OPENCLAW_GATEWAY_TOKEN=ref-secret\n",
        [WINDOWS_CONFIG]: '{"gateway":{"auth":{"mode":"token","token":"${OPENCLAW_GATEWAY_TOKEN}"}}}'
      }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "ref-secret", source: "env-file" });
  });

  it("resolves a config SecretRef for another variable through the config env map", async () => {
    const stub = createSpawnStub(() => ({ code: 1 }));
    const { deps } = makeDeps({
      spawn: stub.spawn,
      files: {
        [WINDOWS_DOTENV]: "MY_GATEWAY_REF=resolved-ref\n",
        [WINDOWS_CONFIG]: '{"gateway":{"auth":{"mode":"token","token":"${MY_GATEWAY_REF}"}}}'
      }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "resolved-ref", source: "config" });
  });

  it("treats the CLI redaction sentinel as absent and falls back to the config file", async () => {
    // OpenClaw 2026.7.1-2 prints this sentinel instead of the secret.
    const stub = createSpawnStub(() => ({ stdout: "__OPENCLAW_REDACTED__", code: 0 }));
    const { deps } = makeDeps({
      spawn: stub.spawn,
      files: { [WINDOWS_CONFIG]: '{"gateway":{"auth":{"mode":"token","token":"literal-token"}}}' }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "literal-token", source: "config" });
  });

  it("honours $OPENCLAW_CONFIG_PATH and $OPENCLAW_STATE_DIR", async () => {
    const stub = createSpawnStub(() => ({ code: 1 }));
    const customConfig = "C:\\custom\\openclaw.json";
    const stateEnv = "C:\\state\\.env";
    const { deps, readPaths } = makeDeps({
      spawn: stub.spawn,
      env: { OPENCLAW_CONFIG_PATH: customConfig, OPENCLAW_STATE_DIR: "C:\\state" },
      files: { [customConfig]: '{"gateway":{"auth":{"mode":"token","token":"path-token"}}}', [stateEnv]: "OTHER=1" }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "path-token", source: "config" });
    expect(readPaths).toContain(customConfig);
    expect(readPaths).toContain(stateEnv);
  });

  it("reads the literal gateway.auth.token from the config file", async () => {
    const stub = createSpawnStub(() => ({ code: 1 }));
    const { deps } = makeDeps({
      spawn: stub.spawn,
      files: { [WINDOWS_CONFIG]: '{ "gateway": { "auth": { "mode": "token", "token": "literal-token" } } }' }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "literal-token", source: "config" });
  });

  it("returns null when gateway.auth.mode has no bearer token", async () => {
    const stub = createSpawnStub(() => ({ code: 1 }));
    for (const mode of ["password", "none", "trusted-proxy"]) {
      const { deps } = makeDeps({
        spawn: stub.spawn,
        files: { [WINDOWS_CONFIG]: `{"gateway":{"auth":{"mode":"${mode}","token":"should-not-use"}}}` }
      });
      await expect(resolveOpenClawGatewayToken(deps)).resolves.toBeNull();
    }
  });

  it("returns null on a malformed config file", async () => {
    const stub = createSpawnStub(() => ({ code: 1 }));
    for (const raw of ['{"gateway": {"auth": {"mode": "token", "token": ', "this is not json"]) {
      const { deps } = makeDeps({ spawn: stub.spawn, files: { [WINDOWS_CONFIG]: raw } });
      await expect(resolveOpenClawGatewayToken(deps)).resolves.toBeNull();
    }
  });

  it("kills the CLI process on timeout and still falls back", async () => {
    const stub = createSpawnStub(() => ({ hang: true }));
    const { deps } = makeDeps({
      spawn: stub.spawn,
      timeoutMs: 10,
      files: { [WINDOWS_DOTENV]: "OPENCLAW_GATEWAY_TOKEN=file-token\n" }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "file-token", source: "env-file" });
    expect(stub.kills).toHaveLength(1);
  });

  it("never logs the token through console", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const stub = createSpawnStub(() => ({ stdout: "super-secret-token", code: 0 }));
      const { deps } = makeDeps({ spawn: stub.spawn });
      await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "super-secret-token", source: "cli" });

      const logged = [...log.mock.calls, ...error.mock.calls, ...warn.mock.calls].flat().join(" ");
      expect(logged).not.toContain("super-secret-token");
    } finally {
      log.mockRestore();
      error.mockRestore();
      warn.mockRestore();
    }
  });

  it("never throws when spawn and the filesystem probe throw", async () => {
    const stub = createSpawnStub(() => ({ throwSync: true }));
    const deps: OpenClawTokenDeps = {
      env: {},
      fs: {
        readFile: () => {
          throw new Error("read failed");
        },
        exists: () => {
          throw new Error("exists failed");
        }
      },
      spawn: stub.spawn,
      homedir: () => "C:\\Users\\x",
      platform: "win32"
    };

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toBeNull();
  });

  it("reads the Windows profile path ~/.openclaw/openclaw.json", async () => {
    const stub = createSpawnStub(() => ({ code: 1 }));
    const { deps, readPaths } = makeDeps({
      spawn: stub.spawn,
      homedir: "C:\\Users\\x",
      files: { [WINDOWS_CONFIG]: '{"gateway":{"auth":{"mode":"token","token":"win-token"}}}' }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "win-token", source: "config" });
    expect(readPaths).toContain("C:\\Users\\x\\.openclaw\\openclaw.json");
  });

  it("reads an inline systemd unit Environment token on Linux", async () => {
    const stub = createSpawnStub(() => ({ code: 1 }));
    const { deps } = makeDeps({
      platform: "linux",
      homedir: LINUX_HOME,
      spawn: stub.spawn,
      dirs: { [LINUX_UNIT_DIR]: ["openclaw-gateway.service"] },
      files: { [LINUX_UNIT]: "[Service]\nEnvironment=OPENCLAW_GATEWAY_TOKEN=unit-token\n" }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "unit-token", source: "env-file" });
  });

  it("reads a systemd drop-in .conf Environment token on Linux", async () => {
    const stub = createSpawnStub(() => ({ code: 1 }));
    const dropInDir = `${LINUX_UNIT_DIR}/openclaw-gateway.service.d`;
    const { deps } = makeDeps({
      platform: "linux",
      homedir: LINUX_HOME,
      spawn: stub.spawn,
      dirs: {
        [LINUX_UNIT_DIR]: ["openclaw-gateway.service"],
        [dropInDir]: ["10-token.conf"]
      },
      files: {
        [LINUX_UNIT]: "[Service]\nEnvironment=FOO=bar\n",
        [`${dropInDir}/10-token.conf`]: "[Service]\nEnvironment=OPENCLAW_GATEWAY_TOKEN=dropin-token\n"
      }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "dropin-token", source: "env-file" });
  });

  it("reads a confined systemd EnvironmentFile resolved from %h", async () => {
    const stub = createSpawnStub(() => ({ code: 1 }));
    const envPath = "/home/x/.openclaw/service-token.env";
    const { deps } = makeDeps({
      platform: "linux",
      homedir: LINUX_HOME,
      spawn: stub.spawn,
      dirs: { [LINUX_UNIT_DIR]: ["openclaw-gateway.service"] },
      files: {
        [LINUX_UNIT]: "[Service]\nEnvironmentFile=%h/.openclaw/service-token.env\n",
        [envPath]: "OPENCLAW_GATEWAY_TOKEN=unit-file-token\n"
      }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "unit-file-token", source: "env-file" });
  });

  it("ignores a systemd EnvironmentFile outside the home/state dir", async () => {
    const stub = createSpawnStub(() => ({ code: 1 }));
    const { deps } = makeDeps({
      platform: "linux",
      homedir: LINUX_HOME,
      spawn: stub.spawn,
      dirs: { [LINUX_UNIT_DIR]: ["openclaw-gateway.service"] },
      files: {
        [LINUX_UNIT]: "[Service]\nEnvironmentFile=-/etc/openclaw/gateway.env\n",
        "/etc/openclaw/gateway.env": "OPENCLAW_GATEWAY_TOKEN=outside-token\n"
      }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toBeNull();
  });

  it("prefers a systemd unit token over the literal gateway.auth.token", async () => {
    const stub = createSpawnStub(() => ({ code: 1 }));
    const { deps } = makeDeps({
      platform: "linux",
      homedir: LINUX_HOME,
      spawn: stub.spawn,
      dirs: { [LINUX_UNIT_DIR]: ["openclaw-gateway.service"] },
      files: {
        [LINUX_UNIT]: "[Service]\nEnvironment=OPENCLAW_GATEWAY_TOKEN=unit-token\n",
        "/home/x/.openclaw/openclaw.json": '{"gateway":{"auth":{"mode":"token","token":"literal-token"}}}'
      }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "unit-token", source: "env-file" });
  });

  it("reads ~/.openclaw/gateway.systemd.env", async () => {
    const stub = createSpawnStub(() => ({ code: 1 }));
    const { deps } = makeDeps({
      platform: "linux",
      homedir: LINUX_HOME,
      spawn: stub.spawn,
      files: { "/home/x/.openclaw/gateway.systemd.env": "OPENCLAW_GATEWAY_TOKEN=systemd-env-token\n" }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "systemd-env-token", source: "env-file" });
  });

  it("reads $OPENCLAW_STATE_DIR/gateway.systemd.env", async () => {
    const stub = createSpawnStub(() => ({ code: 1 }));
    const { deps } = makeDeps({
      platform: "linux",
      homedir: LINUX_HOME,
      env: { OPENCLAW_STATE_DIR: "/opt/openclaw" },
      spawn: stub.spawn,
      files: { "/opt/openclaw/gateway.systemd.env": "OPENCLAW_GATEWAY_TOKEN=state-env-token\n" }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "state-env-token", source: "env-file" });
  });

  it("reads a Windows gateway.cmd `set` token", async () => {
    const stub = createSpawnStub(() => ({ code: 1 }));
    const { deps } = makeDeps({
      spawn: stub.spawn,
      files: {
        "C:\\Users\\x\\.openclaw\\gateway.cmd": "@echo off\r\nset OPENCLAW_GATEWAY_TOKEN=cmd-token\r\n"
      }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "cmd-token", source: "env-file" });
  });

  it('reads a Windows gateway.cmd `set "..."` token', async () => {
    const stub = createSpawnStub(() => ({ code: 1 }));
    const { deps } = makeDeps({
      spawn: stub.spawn,
      files: {
        "C:\\Users\\x\\.openclaw\\gateway.cmd": '@echo off\r\nset "OPENCLAW_GATEWAY_TOKEN=cmd-quoted-token"\r\n'
      }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "cmd-quoted-token", source: "env-file" });
  });

  it("prefers the state-dir gateway.cmd over the profile one", async () => {
    const stub = createSpawnStub(() => ({ code: 1 }));
    const { deps } = makeDeps({
      env: { OPENCLAW_STATE_DIR: "C:\\state" },
      spawn: stub.spawn,
      files: {
        "C:\\state\\gateway.cmd": "set OPENCLAW_GATEWAY_TOKEN=state-cmd-token\r\n",
        "C:\\Users\\x\\.openclaw\\gateway.cmd": "set OPENCLAW_GATEWAY_TOKEN=profile-cmd-token\r\n"
      }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "state-cmd-token", source: "env-file" });
  });

  it("falls back unchanged when no service artifact exists", async () => {
    const stub = createSpawnStub(() => ({ code: 1 }));
    const { deps } = makeDeps({
      spawn: stub.spawn,
      files: { [WINDOWS_CONFIG]: '{"gateway":{"auth":{"mode":"token","token":"literal-token"}}}' }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toEqual({ token: "literal-token", source: "config" });
  });

  it("returns null when no service artifact and no config token exist", async () => {
    const stub = createSpawnStub(() => ({ code: 1 }));
    const { deps } = makeDeps({
      platform: "linux",
      homedir: LINUX_HOME,
      spawn: stub.spawn,
      dirs: { [LINUX_UNIT_DIR]: [] }
    });

    await expect(resolveOpenClawGatewayToken(deps)).resolves.toBeNull();
  });
});
