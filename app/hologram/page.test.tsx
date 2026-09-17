// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { saveMoodConfig, MOOD_CONFIG_KEY } from "@/lib/storage/moodConfig";
import { saveEnvironmentConfig, ENVIRONMENT_CONFIG_KEY } from "@/lib/storage/environmentConfig";
import { savePoseConfig, POSE_CONFIG_KEY } from "@/lib/storage/poseConfig";
import { DEFAULT_AVATAR_POSE } from "@/lib/avatar/avatarPose";
import HologramPage from "./page";

const captured = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));

vi.mock("@/components/avatar/AvatarScene", () => ({
  AvatarScene: (props: Record<string, unknown>) => {
    captured.props = props;
    return null;
  },
}));

describe("hologram page alcove tint", () => {
  beforeEach(() => {
    localStorage.clear();
    captured.props = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("reads the alcove color from the environmentConfig store at mount", () => {
    saveEnvironmentConfig({ alcoveColor: "#4a90d9" });

    render(<HologramPage />);

    expect(captured.props).not.toBeNull();
    expect(captured.props?.environmentTint).toBe("#4a90d9");
  });

  it("applies alcove color changes from the storage event without a reload", () => {
    render(<HologramPage />);

    expect(captured.props?.environmentTint).toBeUndefined();

    saveEnvironmentConfig({ alcoveColor: "#22aa55" });
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: ENVIRONMENT_CONFIG_KEY }));
    });

    expect(captured.props?.environmentTint).toBe("#22aa55");
  });
});

describe("hologram page mood preset", () => {
  beforeEach(() => {
    localStorage.clear();
    captured.props = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("reads the mood preset from the moodConfig store at mount", () => {
    saveMoodConfig({ mood: "happy" });

    render(<HologramPage />);

    expect(captured.props?.expressionPreset).toBe("happy");
  });

  it("applies mood preset changes from the storage event without a reload", () => {
    render(<HologramPage />);

    expect(captured.props?.expressionPreset).toBeUndefined();

    saveMoodConfig({ mood: "sad" });
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: MOOD_CONFIG_KEY }));
    });

    expect(captured.props?.expressionPreset).toBe("sad");
  });
});

describe("hologram page presentation pose", () => {
  const pose = { avatarYaw: 0.4, alcoveYaw: -0.2, zoom: 1.5, depth: 0.1 };

  beforeEach(() => {
    localStorage.clear();
    captured.props = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("reads the pose from the poseConfig store at mount", () => {
    savePoseConfig(pose);

    render(<HologramPage />);

    expect(captured.props?.pose).toEqual(pose);
  });

  it("defaults to the neutral pose when nothing is stored", () => {
    render(<HologramPage />);

    expect(captured.props?.pose).toEqual(DEFAULT_AVATAR_POSE);
  });

  it("applies pose changes from the storage event without a reload", () => {
    render(<HologramPage />);

    savePoseConfig(pose);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: POSE_CONFIG_KEY }));
    });

    expect(captured.props?.pose).toEqual(pose);
  });
});
