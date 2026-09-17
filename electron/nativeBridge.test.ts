import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("electron", () => ({
  app: {
    getAppPath: () => "C:\\repo\\liteforms-web",
    isPackaged: false,
  },
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("node:fs", () => ({
  existsSync: () => true,
}));

function createProbeChild(pipe: PassThrough) {
  const child = new EventEmitter() as EventEmitter & {
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
    stderr: PassThrough;
    stdout: PassThrough;
    stdio: Array<PassThrough | null>;
  };
  child.killed = false;
  child.kill = vi.fn();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdio = [null, child.stdout, child.stderr, pipe];
  return child;
}

describe("createSingleFlight", () => {
  it("returns the same in-flight promise to concurrent callers, then clears the slot", async () => {
    const { createSingleFlight } = await import("./nativeBridge");
    const deferred: { resolve: (value: string) => void } = { resolve: () => {} };
    let call = 0;
    const run = vi.fn(() => {
      call += 1;
      if (call === 1) {
        return new Promise<string>((resolve) => {
          deferred.resolve = resolve;
        });
      }
      return Promise.resolve("again");
    });
    const singleFlight = createSingleFlight(run);

    const first = singleFlight();
    const second = singleFlight();
    expect(run).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);

    deferred.resolve("done");
    await expect(first).resolves.toBe("done");

    await expect(singleFlight()).resolves.toBe("again");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("clears the slot after a rejection so the next call retries", async () => {
    const { createSingleFlight } = await import("./nativeBridge");
    const run = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("ok");
    const singleFlight = createSingleFlight(run);

    await expect(singleFlight()).rejects.toThrow("boom");
    await expect(singleFlight()).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("native Bridge service", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("reads probe JSON from fd 3 because the native Bridge DLL redirects stdout", async () => {
    const state = {
      available: true,
      source: "native",
      display: {
        id: "0",
        name: "Looking Glass Go",
        serial: "LKG-G123",
        width: 2560,
        height: 1440,
      },
      calibration: {
        configVersion: "1.0",
        pitch: { value: 1 },
        slope: { value: 2 },
        center: { value: 3 },
        viewCone: { value: 4 },
        invView: { value: 0 },
        verticalAngle: { value: 0 },
        DPI: { value: 300 },
        screenW: { value: 2560 },
        screenH: { value: 1440 },
        flipImageX: { value: 0 },
        flipImageY: { value: 0 },
        flipSubp: { value: 0 },
        serial: "LKG-G123",
        subpixelCells: [],
        CellPatternMode: { value: 0 },
      },
    };

    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        killed: boolean;
        kill: ReturnType<typeof vi.fn>;
        stderr: PassThrough;
        stdout: PassThrough;
        stdio: Array<PassThrough | null>;
      };
      const resultPipe = new PassThrough();

      child.killed = false;
      child.kill = vi.fn();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdio = [null, child.stdout, child.stderr, resultPipe];

      process.nextTick(() => {
        resultPipe.end(JSON.stringify(state));
        child.emit("close", 0, null);
      });

      return child;
    });

    const { createNativeBridgeService } = await import("./nativeBridge");
    const service = createNativeBridgeService();

    await expect(service.getState()).resolves.toEqual(state);

    const spawnOptions = spawnMock.mock.calls[0][2];
    expect(spawnOptions.stdio).toEqual(["ignore", "pipe", "pipe", "pipe"]);
    expect(spawnOptions.env.LITEFORMS_NATIVE_BRIDGE_RESULT_FD).toBe("3");
  });

  it("surfaces probe stderr in the error when the probe writes no result", async () => {
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        killed: boolean;
        kill: ReturnType<typeof vi.fn>;
        stderr: PassThrough;
        stdout: PassThrough;
        stdio: Array<PassThrough | null>;
      };
      child.killed = false;
      child.kill = vi.fn();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdio = [null, child.stdout, child.stderr, new PassThrough()];

      process.nextTick(() => {
        child.stderr?.write("dlopen failed: libdbusmenu-glib.so.4: cannot open shared object file\n");
        child.emit("close", 1, null);
      });

      return child;
    });

    const { createNativeBridgeService } = await import("./nativeBridge");
    const service = createNativeBridgeService();

    const state = await service.getState();
    expect(state.available).toBe(false);
    if (!state.available) {
      expect(state.error).toContain("libdbusmenu-glib.so.4");
      expect(state.error).toContain("Native Bridge probe returned no data");
    }
  });

  it("explains a silent probe exit with the USB/udev checklist", async () => {
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        killed: boolean;
        kill: ReturnType<typeof vi.fn>;
        stderr: PassThrough;
        stdout: PassThrough;
        stdio: Array<PassThrough | null>;
      };
      child.killed = false;
      child.kill = vi.fn();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdio = [null, child.stdout, child.stderr, new PassThrough()];

      process.nextTick(() => {
        child.emit("close", 0, null);
      });

      return child;
    });

    const { createNativeBridgeService } = await import("./nativeBridge");
    const service = createNativeBridgeService();

    const state = await service.getState();
    expect(state.available).toBe(false);
    if (!state.available) {
      expect(state.error).toContain("exited with code 0");
      expect(state.error).toContain("USB");
    }
  });

  it("single-flights concurrent getState calls into exactly one spawn", async () => {
    const state = {
      available: true,
      source: "native",
      display: { id: "0", name: "Looking Glass Go", serial: "LKG-G123", width: 2560, height: 1440 },
      calibration: { configVersion: "1.0", serial: "LKG-G123", subpixelCells: [] },
    };

    spawnMock.mockImplementation(() => {
      const resultPipe = new PassThrough();
      const child = createProbeChild(resultPipe);

      process.nextTick(() => {
        resultPipe.end(JSON.stringify(state));
        child.emit("close", 0, null);
      });

      return child;
    });

    const { createNativeBridgeService } = await import("./nativeBridge");
    const service = createNativeBridgeService();

    const [first, second] = await Promise.all([service.getState(), service.getState()]);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(state);
    expect(second).toEqual(state);
  });

  it("logs the probe state only when it changes", async () => {
    const log = vi.fn();
    const state = {
      available: true,
      source: "native",
      display: { id: "0", name: "Looking Glass Go", serial: "LKG-G123", width: 2560, height: 1440 },
      calibration: {
        configVersion: "1.0",
        pitch: { value: 1 },
        slope: { value: 2 },
        center: { value: 3 },
        viewCone: { value: 4 },
        invView: { value: 0 },
        verticalAngle: { value: 0 },
        DPI: { value: 300 },
        screenW: { value: 2560 },
        screenH: { value: 1440 },
        flipImageX: { value: 0 },
        flipImageY: { value: 0 },
        flipSubp: { value: 0 },
        serial: "LKG-G123",
        subpixelCells: [],
        CellPatternMode: { value: 0 },
      },
    };

    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        killed: boolean;
        kill: ReturnType<typeof vi.fn>;
        stderr: PassThrough;
        stdout: PassThrough;
        stdio: Array<PassThrough | null>;
      };
      const resultPipe = new PassThrough();
      child.killed = false;
      child.kill = vi.fn();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdio = [null, child.stdout, child.stderr, resultPipe];

      process.nextTick(() => {
        resultPipe.end(JSON.stringify(state));
        child.emit("close", 0, null);
      });

      return child;
    });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const { createNativeBridgeService } = await import("./nativeBridge");
      const service = createNativeBridgeService(log);

      await service.getState();
      await service.getState(); // cache hit within the TTL: no new state log
      // Two log lines per probe: "start" + the state summary. Only the summary
      // is deduplicated across probes.
      const stateLogs = log.mock.calls.map((call) => call[0] as string).filter((line) => line.startsWith("nativeBridge probe ::"));
      expect(stateLogs).toHaveLength(1);
      expect(stateLogs[0]).toContain('available=true display="Looking Glass Go" serial="LKG-G123" 2560x1440');

      vi.setSystemTime(3000); // cache expired, same state: still no new state log
      await service.getState();
      expect(log.mock.calls.map((call) => call[0] as string).filter((line) => line.startsWith("nativeBridge probe ::"))).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
