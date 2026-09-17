import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getNativeBridgeLongType,
  getNativeBridgePreloadPlan,
  getNativeBridgeUnsignedLongByteLength,
  getNativeBridgeUnsignedLongType,
  readNativeBridgeUnsignedLong,
} from "./nativeBridgeProbe";

describe("native Bridge probe ABI helpers", () => {
  it("uses Windows unsigned long and long widths from the Bridge SDK header", () => {
    expect(getNativeBridgeUnsignedLongType("win32")).toBe("uint32_t");
    expect(getNativeBridgeLongType("win32")).toBe("int32_t");
    expect(getNativeBridgeUnsignedLongByteLength("win32")).toBe(4);
  });

  it("uses 64-bit unsigned long widths on Darwin", () => {
    expect(getNativeBridgeUnsignedLongType("darwin")).toBe("uint64_t");
    expect(getNativeBridgeLongType("darwin")).toBe("int64_t");
    expect(getNativeBridgeUnsignedLongByteLength("darwin")).toBe(8);
  });

  it("reads packed Windows display indices without skipping every other value", () => {
    const buffer = Buffer.alloc(8);
    buffer.writeUInt32LE(7, 0);
    buffer.writeUInt32LE(42, 4);

    expect(readNativeBridgeUnsignedLong(buffer, 0, "win32")).toBe(7);
    expect(readNativeBridgeUnsignedLong(buffer, 1, "win32")).toBe(42);
  });
});

describe("native Bridge Linux preload plan", () => {
  it("stays empty on non-Linux platforms (no preload off Linux)", () => {
    expect(getNativeBridgePreloadPlan({ runtimeDir: "C:\\bridge", platform: "win32" })).toEqual([]);
    expect(getNativeBridgePreloadPlan({ runtimeDir: "/bridge", platform: "darwin" })).toEqual([]);
  });

  it("stays empty when the runtime dir is missing", () => {
    expect(getNativeBridgePreloadPlan({ runtimeDir: "", platform: "linux" })).toEqual([]);
  });

  it("preloads the bundled mbedTLS chain then the appindicator candidates in upstream order", () => {
    const plan = getNativeBridgePreloadPlan({
      runtimeDir: "/opt/bridge",
      platform: "linux",
      existsSync: () => true,
    });

    expect(plan).toEqual([
      { name: join("/opt/bridge", "libmbedcrypto.so.1"), absolute: true },
      { name: join("/opt/bridge", "libmbedx509.so.0"), absolute: true },
      { name: join("/opt/bridge", "libmbedtls.so.10"), absolute: true },
      { name: "libappindicator3.so.1", absolute: false },
      { name: "libappindicator3.so", absolute: false },
      { name: "libappindicator.so.1", absolute: false },
      { name: "libappindicator.so", absolute: false },
      { name: "libayatana-appindicator3.so.1", absolute: false },
      { name: "libayatana-appindicator3.so", absolute: false },
    ]);
  });

  it("keeps only the mbedTLS libraries that exist in the runtime dir", () => {
    const plan = getNativeBridgePreloadPlan({
      runtimeDir: "/opt/bridge",
      platform: "linux",
      existsSync: (path) => path.endsWith("libmbedtls.so.10"),
    });

    expect(plan[0]).toEqual({ name: join("/opt/bridge", "libmbedtls.so.10"), absolute: true });
    expect(plan[1]).toEqual({ name: "libappindicator3.so.1", absolute: false });
  });
});
