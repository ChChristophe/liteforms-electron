import { describe, expect, it } from "vitest";
import { getNativeBridgeLibraryName, getNativeBridgePlatformDir, resolveNativeBridgeRuntime } from "./nativeBridgePaths";

describe("native Bridge path resolution", () => {
  it("maps supported Windows, macOS and Linux platforms", () => {
    expect(getNativeBridgePlatformDir("win32", "x64")).toBe("win32-x64");
    expect(getNativeBridgePlatformDir("darwin", "x64")).toBe("darwin-x64");
    expect(getNativeBridgePlatformDir("darwin", "arm64")).toBe("darwin-arm64");
    expect(getNativeBridgePlatformDir("linux", "x64")).toBe("linux-x64");
    expect(getNativeBridgeLibraryName("win32")).toBe("bridge_inproc.dll");
    expect(getNativeBridgeLibraryName("darwin")).toBe("libbridge_inproc.dylib");
    expect(getNativeBridgeLibraryName("linux")).toBe("libbridge_inproc.so");
  });

  it("resolves the development native Bridge directory", () => {
    expect(
      resolveNativeBridgeRuntime({
        appPath: "C:\\repo\\liteforms-web",
        arch: "x64",
        env: {},
        isPackaged: false,
        platform: "win32",
        resourcesPath: "C:\\repo\\liteforms-web"
      })
    ).toEqual({
      supported: true,
      platformDir: "win32-x64",
      runtimeDir: "C:\\repo\\liteforms-web\\native\\bridge\\win32-x64",
      libraryPath: "C:\\repo\\liteforms-web\\native\\bridge\\win32-x64\\bridge_inproc.dll",
      libraryName: "bridge_inproc.dll",
      source: "bundled"
    });
  });

  it("resolves the packaged native Bridge directory under resources", () => {
    expect(
      resolveNativeBridgeRuntime({
        appPath: "C:\\Program Files\\Liteforms\\resources\\app.asar",
        arch: "x64",
        env: {},
        isPackaged: true,
        platform: "win32",
        resourcesPath: "C:\\Program Files\\Liteforms\\resources"
      })
    ).toEqual(
      expect.objectContaining({
        runtimeDir: "C:\\Program Files\\Liteforms\\resources\\bridge\\win32-x64",
        libraryPath: "C:\\Program Files\\Liteforms\\resources\\bridge\\win32-x64\\bridge_inproc.dll"
      })
    );
  });

  it("supports an override directory for local Bridge SDK testing", () => {
    expect(
      resolveNativeBridgeRuntime({
        appPath: "ignored",
        arch: "arm64",
        env: { LITEFORMS_NATIVE_BRIDGE_DIR: "/tmp/bridge" },
        isPackaged: false,
        platform: "darwin",
        resourcesPath: "ignored"
      })
    ).toEqual({
      supported: true,
      platformDir: "darwin-arm64",
      runtimeDir: "/tmp/bridge",
      libraryPath: "/tmp/bridge/libbridge_inproc.dylib",
      libraryName: "libbridge_inproc.dylib",
      source: "override"
    });
  });

  it("resolves the Linux runtime against the bundled Bridge SDK .so", () => {
    expect(
      resolveNativeBridgeRuntime({
        appPath: "/repo",
        arch: "x64",
        env: {},
        isPackaged: false,
        platform: "linux",
        resourcesPath: "/repo"
      })
    ).toEqual({
      supported: true,
      platformDir: "linux-x64",
      runtimeDir: "/repo/native/bridge/linux-x64",
      libraryPath: "/repo/native/bridge/linux-x64/libbridge_inproc.so",
      libraryName: "libbridge_inproc.so",
      source: "bundled"
    });
  });
});
