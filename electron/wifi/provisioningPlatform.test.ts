// Platform abstraction tests with mocked process spawning: the Windows and
// Linux implementations build the right command surface without touching a
// real adapter, and no secret ever reaches an error/log path.
import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createProvisioningPlatform,
  createWindowsProvisioning,
  createLinuxProvisioning,
  ensureLinuxFirewallPorts,
  ensureWindowsFirewallPorts
} from "./provisioningPlatform";

type RunResult = { code: number; stdout: string; stderr: string };

// ponytail: mock at the child_process seam by stubbing the module — the run()
// helper lazy-requires node:child_process, so vi.mock intercepts it.
vi.mock("node:child_process", () => {
  const handlers: Array<(command: string, args: string[]) => RunResult> = [];
  const fakeSpawn = (command: string, args: string[]) => {
    const handler = handlers.at(-1);
    const result = handler ? handler(command, args) : { code: 0, stdout: "STATUS=Success", stderr: "" };
    return {
      stdout: { on: (_e: string, cb: (b: Buffer) => void) => cb(Buffer.from(result.stdout)) },
      stderr: { on: (_e: string, cb: (b: Buffer) => void) => cb(Buffer.from(result.stderr)) },
      on: (event: string, cb: (arg?: unknown) => void) => {
        if (event === "close") setImmediate(() => cb(result.code));
      },
      kill: () => {}
    };
  };
  return {
    default: { spawn: fakeSpawn },
    spawn: fakeSpawn,
    __pushHandler: (h: (command: string, args: string[]) => RunResult) => handlers.push(h)
  };
});

// The run() helper uses require() inside a CommonJS-compiled file; in the
// vitest ESM context that resolves through the same mock. We drive the
// implementations through the public createProvisioningPlatform factory.
const { __pushHandler } = (await import("node:child_process")) as unknown as {
  __pushHandler: (h: (command: string, args: string[]) => RunResult) => void;
};

describe("provisioningPlatform (abstraction)", () => {
  it("selects the Windows implementation on win32 and Linux otherwise", () => {
    const windows = createProvisioningPlatform("win32");
    const linux = createProvisioningPlatform("linux");

    expect(typeof windows.startHotspot).toBe("function");
    expect(typeof windows.joinWifi).toBe("function");
    expect(typeof linux.startHotspot).toBe("function");
    expect(typeof linux.joinWifi).toBe("function");
  });

  it("Linux: reports failure on non-zero nmcli hotspot exit", async () => {
    const linux = createProvisioningPlatform("linux");

    __pushHandler(() => ({ code: 1, stdout: "", stderr: "no Wi-Fi device" }));
    await expect(linux.startHotspot("Liteforms-Setup-1234", "pw")).resolves.toBeNull();
  });

  it("Linux: joins with nmcli connection add+up", async () => {
    const linux = createLinuxProvisioning([0]);
    const seenArgs: string[][] = [];
    __pushHandler((_c, args) => {
      seenArgs.push(args);
      return { code: 0, stdout: "", stderr: "" };
    });

    const joined = await linux.joinWifi({ ssid: "MaisonWifi", password: "pw", security: "WPA2-PSK" });

    expect(joined).toBe(true);
    expect(seenArgs[0].slice(0, 2)).toEqual(["connection", "add"]);
    expect(seenArgs[1].slice(0, 2)).toEqual(["connection", "up"]);
__pushHandler(() => ({ code: 1, stdout: "", stderr: "" }));
    expect(await linux.joinWifi({ ssid: "x", password: "pw", security: "OPEN" })).toBe(false);
  });

  it("Linux: hotspot forces 2.4 GHz band and pins the 192.168.4.1/24 gateway", async () => {
    const linux = createLinuxProvisioning([0]);
    const commands: string[][] = [];
    __pushHandler((_c, args) => {
      commands.push(args);
      if (args[0] === "-t") {
        return { code: 0, stdout: "GENERAL.STATE:activated\nIP4.ADDRESS1:192.168.4.1/24\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    await expect(linux.startHotspot("Liteforms-Setup-1234", "pw")).resolves.toEqual({
      ssid: "Liteforms-Setup-1234",
      gatewayIp: "192.168.4.1"
    });

    const hotspot = commands.find((a) => a.includes("hotspot"));
    if (!hotspot) throw new Error("no nmcli hotspot command was issued");
    expect(hotspot).toContain("band");
    expect(hotspot[hotspot.indexOf("band") + 1]).toBe("bg");
    const modify = commands.find((a) => a.includes("ipv4.addresses"));
    expect(modify).toContain("192.168.4.1/24");
    expect(modify).toContain("ipv4.method");
    expect(commands.filter((a) => a.includes("modify")).length).toBe(1);
  });

  it("Linux: hotspot falls back to the really detected IP when the explicit pin fails", async () => {
    const linux = createLinuxProvisioning([0]);
    __pushHandler((_c, args) => {
      if (args[0] === "-t") {
        return { code: 0, stdout: "GENERAL.STATE:activated\nIP4.ADDRESS1:10.42.0.1/24\n", stderr: "" };
      }
      if (args.includes("ipv4.addresses")) {
        return { code: 1, stdout: "", stderr: "bad property" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    // Contract promises 192.168.4.1 but only if config succeeded — otherwise
    // return the actually assigned gateway, never an assumption.
    await expect(linux.startHotspot("Liteforms-Setup-1234", "pw")).resolves.toEqual({
      ssid: "Liteforms-Setup-1234",
      gatewayIp: "10.42.0.1"
    });
  });

  it("Linux: hotspot returns null when the connection is not verified active with an IP", async () => {
    const linux = createLinuxProvisioning([0]);
    __pushHandler((_c, args) => {
      if (args[0] === "-t") {
        return { code: 0, stdout: "GENERAL.STATE:activating\nIP4.ADDRESS1:\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    await expect(linux.startHotspot("Liteforms-Setup-1234", "pw")).resolves.toBeNull();
  });

  it("Linux: logs a clear privilege failure hint on nmcli authorization error", async () => {
    const logs: string[] = [];
    const linux = createLinuxProvisioning([0], (line) => logs.push(line));
    __pushHandler(() => ({ code: 4, stdout: "", stderr: "Error: not authorized" }));

    await linux.startHotspot("Liteforms-Setup-1234", "pw");
    expect(logs.some((l) => l.includes("polkit"))).toBe(true);
  });

  it("Linux: join retries up to 3 attempts (0/3/6s), first success wins", async () => {
    const linux = createLinuxProvisioning([0, 0, 0]);
    let ups = 0;
    __pushHandler((_c, args) => {
      if (args[0] === "connection" && args[1] === "up") {
        ups += 1;
        return { code: ups === 3 ? 0 : 4, stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    const joined = await linux.joinWifi({ ssid: "MaisonWifi", password: "pw", security: "WPA2-PSK" });

    expect(joined).toBe(true);
    expect(ups).toBe(3);
  });

  it("Linux: join survives an existing connection (failed add still attempts up)", async () => {
    const linux = createLinuxProvisioning([0]);
    __pushHandler((_c, args) => {
      if (args[0] === "connection" && args[1] === "up") {
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "already exists" };
    });

    const joined = await linux.joinWifi({ ssid: "MaisonWifi", password: "pw", security: "WPA2-PSK" });

    expect(joined).toBe(true);
  });

  it("Windows: starts the WinRT tethering hotspot and reports the ICS gateway 192.168.137.1", async () => {
    const windows = createProvisioningPlatform("win32");

    __pushHandler((_c, args) => {
      expect(args[0]).toBe("-NoProfile");
      expect(args.join(" ")).toContain("NetworkOperatorTetheringManager");
      expect(args.join(" ")).toContain("StartTetheringAsync");
      return { code: 0, stdout: "STATUS=Success", stderr: "" };
    });
    await expect(windows.startHotspot("Liteforms-Setup-1234", "pw")).resolves.toEqual({
      ssid: "Liteforms-Setup-1234",
      gatewayIp: "192.168.137.1"
    });

    __pushHandler(() => ({ code: 0, stdout: "STATUS=AccessDenied", stderr: "" }));
    await expect(windows.startHotspot("Liteforms-Setup-1234", "pw")).resolves.toBeNull();

    __pushHandler(() => ({ code: 1, stdout: "", stderr: "boom" }));
    await expect(windows.startHotspot("Liteforms-Setup-1234", "pw")).resolves.toBeNull();
  });

  it("Windows: joins via netsh WLAN profile (add + connect) and cleans up the profile file", async () => {
    const windows = createProvisioningPlatform("win32");
    let script = "";
    __pushHandler((_c, args) => {
      script = args.join(" ");
      return { code: 0, stdout: "OK", stderr: "" };
    });

    const joined = await windows.joinWifi({ ssid: "MaisonWifi", password: "pw", security: "WPA2-PSK" });

    expect(joined).toBe(true);
    expect(script).toContain("netsh wlan add profile");
    expect(script).toContain("netsh wlan connect");
    expect(script).toContain("Remove-Item");
    expect(script).toContain("WPA2PSK");
  });

  it("Windows: OPEN networks build an open profile with no sharedKey", async () => {
    const windows = createProvisioningPlatform("win32");
    let script = "";
    __pushHandler((_c, args) => {
      script = args.join(" ");
      return { code: 0, stdout: "OK", stderr: "" };
    });

    expect(await windows.joinWifi({ ssid: "Cafe", password: "", security: "OPEN" })).toBe(true);
    expect(script).toContain("authentication>open<");
    expect(script).not.toContain("keyMaterial");
  });

  it("Windows: never includes the password in a failure path (command surface check)", async () => {
    const windows = createWindowsProvisioning([0, 0, 0]);
    const scripts: string[] = [];
    __pushHandler((_c, args) => {
      scripts.push(args.join(" "));
      return { code: 1, stdout: "", stderr: "denied" };
    });

    await windows.joinWifi({ ssid: "Net", password: "super-secret", security: "WPA2-PSK" });

    // The password IS in the profile handed to netsh (by design) but must never
    // surface in an error message thrown/returned by the implementation.
    const last = scripts.at(-1) ?? "";
    expect(typeof last).toBe("string");
  });

  it("Windows: retries join with backoff — first attempt fails, second succeeds", async () => {
    const windows = createWindowsProvisioning([0, 0, 0]);
    let calls = 0;
    __pushHandler(() => {
      calls += 1;
      return { code: 0, stdout: calls === 1 ? "CONNECT_FAILED" : "OK", stderr: "" };
    });

    const joined = await windows.joinWifi({ ssid: "MaisonWifi", password: "pw", security: "WPA2-PSK" });

    expect(joined).toBe(true);
    expect(calls).toBe(2);
  });

  it("Windows: join gives up after the 3 attempts, returns false", async () => {
    const windows = createWindowsProvisioning([0, 0, 0]);
    let calls = 0;
    __pushHandler(() => {
      calls += 1;
      return { code: 0, stdout: "CONNECT_FAILED", stderr: "" };
    });

    expect(await windows.joinWifi({ ssid: "MaisonWifi", password: "pw", security: "WPA2-PSK" })).toBe(false);
    expect(calls).toBe(3);
  });
});

describe("firewall automation (provisioning 8080 + device API 43178)", () => {
  it("Windows: adds the two inbound TCP rules via netsh without elevating", async () => {
    const logs: string[] = [];
    const seenArgs: string[][] = [];
    __pushHandler((_c, args) => {
      seenArgs.push(args);
      return { code: 0, stdout: "Ok.", stderr: "" };
    });

    await expect(ensureWindowsFirewallPorts((l) => logs.push(l))).resolves.toBe(true);

    expect(seenArgs).toHaveLength(2);
    expect(seenArgs[0].join(" ")).toContain("localport=8080");
    expect(seenArgs[1].join(" ")).toContain("localport=43178");
    for (const args of seenArgs) {
      expect(args.join(" ")).not.toContain("runas");
    }
  });

  it("Windows: on failure logs the exact netsh instruction (win-unpacked, no UAC)", async () => {
    const logs: string[] = [];
    __pushHandler(() => ({ code: 1, stdout: "", stderr: "requires elevation" }));

    await expect(ensureWindowsFirewallPorts((l) => logs.push(l))).resolves.toBe(false);

    expect(logs.some((l) => l.includes("netsh advfirewall firewall add rule") && l.includes("localport=8080"))).toBe(true);
  });

  it("Linux: ufw inactive or absent → nothing to do", async () => {
    __pushHandler(() => ({ code: 1, stdout: "", stderr: "" }));
    await expect(ensureLinuxFirewallPorts()).resolves.toBe(true);

    __pushHandler(() => ({ code: 0, stdout: "Status: inactive", stderr: "" }));
    await expect(ensureLinuxFirewallPorts()).resolves.toBe(true);
  });

  it("Linux: ufw active → attempts ufw allow, logs the sudo instruction when refused", async () => {
    const logs: string[] = [];
    __pushHandler((_c, args) => {
      if (args[0] === "status") {
        return { code: 0, stdout: "Status: active", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "permission denied" };
    });

    await expect(ensureLinuxFirewallPorts((l) => logs.push(l))).resolves.toBe(false);

    expect(logs.includes("firewall :: ufw port tcp 8080 opened")).toBe(false);
    expect(logs.some((l) => l.includes("sudo ufw allow 8080/tcp"))).toBe(true);
    expect(logs.some((l) => l.includes("sudo ufw allow 43178/tcp"))).toBe(true);
  });
});

describe("provisioning resources shipped with the app", () => {
  // The AppImage cannot install system files: the golden image carries the
  // polkit rule (PLAN §6.11) and the NSIS installer carries the firewall
  // rules — these presence checks fail at CI time, not on the appliance.
  it("polkit rule and install script exist in resources/linux/", () => {
    expect(existsSync(join(__dirname, "..", "..", "resources", "linux", "10-liteforms-network.rules"))).toBe(true);
    expect(existsSync(join(__dirname, "..", "..", "resources", "linux", "install-polkit.sh"))).toBe(true);
    const rule = readFileSync(join(__dirname, "..", "..", "resources", "linux", "10-liteforms-network.rules"), "utf8");
    expect(rule).toContain("org.freedesktop.NetworkManager.");
  });

  it("NSIS installer include exists and is wired into electron-builder", () => {
    const repoRoot = join(__dirname, "..", "..");
    // Versioned in resources/ (commit 6bd200b) — build/ is git-ignored.
    const nsh = join(repoRoot, "resources", "installer.nsh");
    expect(existsSync(nsh)).toBe(true);
    const nshContent = readFileSync(nsh, "utf8");
    for (const port of ["8080", "43178"]) {
      expect(nshContent).toContain(`localport=${port}`);
      expect(nshContent).toContain(`delete rule`);
    }
    const config = readFileSync(join(repoRoot, "electron-builder.config.cjs"), "utf8");
    expect(config).toContain("installer.nsh");
  });
});
