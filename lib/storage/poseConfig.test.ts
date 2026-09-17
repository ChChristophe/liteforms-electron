import { beforeEach, describe, expect, it } from "vitest";
import {
  POSE_CONFIG_KEY,
  clearPoseConfig,
  loadPoseConfig,
  loadPoseOrDefault,
  savePoseConfig
} from "./poseConfig";
import { DEFAULT_AVATAR_POSE } from "@/lib/avatar/avatarPose";

// Lightweight localStorage stub
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  }
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

describe("loadPoseConfig", () => {
  it("returns null when nothing is stored", () => {
    expect(loadPoseConfig()).toBeNull();
  });

  it("returns null for corrupted JSON", () => {
    store[POSE_CONFIG_KEY] = "not-json{{{";
    expect(loadPoseConfig()).toBeNull();
  });

  it("returns null when the version field is wrong", () => {
    store[POSE_CONFIG_KEY] = JSON.stringify({ version: 2, pose: DEFAULT_AVATAR_POSE });
    expect(loadPoseConfig()).toBeNull();
  });

  it("returns null when a pose field is not a finite number", () => {
    store[POSE_CONFIG_KEY] = JSON.stringify({ version: 1, pose: { ...DEFAULT_AVATAR_POSE, zoom: "1" } });
    expect(loadPoseConfig()).toBeNull();

    store[POSE_CONFIG_KEY] = JSON.stringify({ version: 1, pose: { ...DEFAULT_AVATAR_POSE, depth: null } });
    expect(loadPoseConfig()).toBeNull();
  });
});

describe("savePoseConfig + loadPoseConfig round-trip", () => {
  it("persists and restores a pose", () => {
    const pose = { avatarYaw: 0.5, alcoveYaw: -0.25, zoom: 1.5, depth: 0.1 };
    savePoseConfig(pose);

    expect(loadPoseConfig()).toEqual({ version: 1, pose });
  });

  it("overwrites an existing entry on repeated saves", () => {
    savePoseConfig({ avatarYaw: 1, alcoveYaw: 0, zoom: 1, depth: 0 });
    savePoseConfig(DEFAULT_AVATAR_POSE);

    expect(loadPoseConfig()?.pose).toEqual(DEFAULT_AVATAR_POSE);
  });

  it("silently ignores localStorage failures without throwing", () => {
    const failing = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
      removeItem: () => {
        throw new Error("storage unavailable");
      }
    };
    Object.defineProperty(globalThis, "localStorage", { value: failing, writable: true });

    expect(() => savePoseConfig(DEFAULT_AVATAR_POSE)).not.toThrow();
    expect(loadPoseConfig()).toBeNull();
    expect(() => clearPoseConfig()).not.toThrow();

    Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });
  });
});

describe("loadPoseOrDefault", () => {
  it("returns the neutral pose when nothing is stored", () => {
    expect(loadPoseOrDefault()).toEqual(DEFAULT_AVATAR_POSE);
  });

  it("returns the stored pose when present", () => {
    const pose = { avatarYaw: 0.2, alcoveYaw: 0.1, zoom: 0.5, depth: -0.2 };
    savePoseConfig(pose);

    expect(loadPoseOrDefault()).toEqual(pose);
  });
});

describe("clearPoseConfig", () => {
  it("removes the stored config so loadPoseConfig returns null", () => {
    savePoseConfig(DEFAULT_AVATAR_POSE);

    clearPoseConfig();

    expect(loadPoseConfig()).toBeNull();
  });

  it("does not throw when nothing was stored", () => {
    expect(() => clearPoseConfig()).not.toThrow();
  });
});
