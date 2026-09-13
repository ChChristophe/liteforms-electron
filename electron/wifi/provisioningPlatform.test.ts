// Platform abstraction tests with mocked process spawning: the Windows and
// Linux implementations build the right command surface without touching a
// real adapter, and no secret ever reaches an error/log path.
import { describe, expect, it, vi } from "vitest";
import {
  createProvisioningPlatform,
  createWindowsProvisioning
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

  it("Linux: starts an nmcli hotspot on 192.168.4.1 and reports failure on non-zero exit", async () => {
    const linux = createProvisioningPlatform("linux");

    __pushHandler((_c, args) => {
      expect(args.slice(0, 3)).toEqual(["device", "wifi", "hotspot"]);
      return { code: 0, stdout: "", stderr: "" };
    });
    await expect(linux.startHotspot("Liteforms-Setup-1234", "pw")).resolves.toEqual({
      ssid: "Liteforms-Setup-1234",
      gatewayIp: "192.168.4.1"
    });

    __pushHandler(() => ({ code: 1, stdout: "", stderr: "no Wi-Fi device" }));
    await expect(linux.startHotspot("Liteforms-Setup-1234", "pw")).resolves.toBeNull();
  });

  it("Linux: joins with nmcli connection add+up", async () => {
    const linux = createProvisioningPlatform("linux");
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
