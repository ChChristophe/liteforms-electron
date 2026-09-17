import { describe, expect, it } from "vitest";
import { parseDeviceConfig, type PocDeviceConfig } from "./pocConfig";
import { DEFAULT_AVATAR_POSE } from "@/lib/avatar/avatarPose";

function withAvatar(avatar: Record<string, unknown>) {
  return {
    configVersion: "1.0" as const,
    character: { name: "Clawdia", pronouns: "SHE" as const, personality: "Curieuse.", greeting: "Salut !" },
    environment: { alcoveColor: "#4a90d9" },
    providers: {
      llm: { provider: "openai", model: "m", endpoint: "https://e", voiceId: null },
      tts: { provider: "kokoro", model: "m", endpoint: "https://e", voiceId: null },
      stt: { provider: "deepgram", model: "m", endpoint: "https://e", voiceId: null }
    },
    avatar
  };
}

function parseAvatar(avatar: Record<string, unknown>) {
  return parseDeviceConfig(withAvatar(avatar)) as
    | { config: PocDeviceConfig; warnings: string[] }
    | { error: string; message: string };
}

describe("parseDeviceConfig avatar.mood validation", () => {
  it("accepts a valid preset without a warning", () => {
    const result = parseAvatar({ mood: "happy" });

    expect("error" in result).toBe(false);
    const ok = result as { config: PocDeviceConfig; warnings: string[] };
    expect(ok.config.avatar.mood).toBe("happy");
    expect(ok.warnings).toEqual([]);
  });

  it("accepts null (Mobile 'Défaut') without an error or warning — regression: previously a 400", () => {
    const result = parseAvatar({ mood: null });

    expect("error" in result).toBe(false);
    const ok = result as { config: PocDeviceConfig; warnings: string[] };
    expect(ok.config.avatar.mood).toBeUndefined();
    expect(ok.warnings).toEqual([]);
  });

  it("accepts an absent mood without a warning", () => {
    const result = parseAvatar({ modelRef: { id: "x", fileName: "m.vrm", hash: null } });

    expect("error" in result).toBe(false);
    const ok = result as { config: PocDeviceConfig; warnings: string[] };
    expect(ok.config.avatar.mood).toBeUndefined();
    expect(ok.warnings).toEqual([]);
  });

  it("warns and drops an unknown preset instead of failing", () => {
    const result = parseAvatar({ mood: "ecstatic" });

    expect("error" in result).toBe(false);
    const ok = result as { config: PocDeviceConfig; warnings: string[] };
    expect(ok.config.avatar.mood).toBeUndefined();
    expect(ok.warnings).toEqual(["avatar.mood `ecstatic` ignored (unknown preset)"]);
  });

  it("warns and drops a non-string mood instead of failing", () => {
    const result = parseAvatar({ mood: 42 });

    expect("error" in result).toBe(false);
    const ok = result as { config: PocDeviceConfig; warnings: string[] };
    expect(ok.config.avatar.mood).toBeUndefined();
    expect(ok.warnings).toEqual(["avatar.mood `42` ignored (unknown preset)"]);
  });
});

describe("parseDeviceConfig avatar.pose validation", () => {
  function parsePose(pose: unknown) {
    return parseAvatar({ pose }) as
      | { config: PocDeviceConfig; warnings: string[] }
      | { error: string; message: string };
  }

  it("accepts a full valid pose, preserves values and emits no warning", () => {
    const result = parsePose({ avatarYaw: 0.4, alcoveYaw: -0.2, zoom: 1.5, depth: 0.2 });

    expect("error" in result).toBe(false);
    const ok = result as { config: PocDeviceConfig; warnings: string[] };
    expect(ok.config.avatar.pose).toEqual({ avatarYaw: 0.4, alcoveYaw: -0.2, zoom: 1.5, depth: 0.2 });
    expect(ok.warnings).toEqual([]);
  });

  it("resolves an absent or empty pose to the contract defaults without a warning", () => {
    for (const avatar of [{}, { pose: {} }]) {
      const result = parseAvatar(avatar) as { config: PocDeviceConfig; warnings: string[] };
      expect(result.config.avatar.pose).toEqual(DEFAULT_AVATAR_POSE);
      expect(result.warnings).toEqual([]);
    }
  });

  it("drops non-finite fields with a pose.<field> warning, keeping the other fields", () => {
    const result = parseAvatar({
      pose: { avatarYaw: Number.NaN, alcoveYaw: Number.POSITIVE_INFINITY, zoom: 2, depth: 0.1 }
    }) as { config: PocDeviceConfig; warnings: string[] };

    expect(result.config.avatar.pose).toEqual({ avatarYaw: 0, alcoveYaw: 0, zoom: 2, depth: 0.1 });
    expect(result.warnings).toEqual(["pose.avatarYaw ignored", "pose.alcoveYaw ignored"]);
  });

  it("drops a non-numeric field with a warning", () => {
    const result = parseAvatar({ pose: { zoom: "2" } }) as { config: PocDeviceConfig; warnings: string[] };

    expect(result.config.avatar.pose.zoom).toBe(1);
    expect(result.warnings).toEqual(["pose.zoom ignored"]);
  });

  it("clamps zoom and depth to the contract bounds", () => {
    const high = parseAvatar({ pose: { zoom: 99, depth: 5 } }) as { config: PocDeviceConfig };
    expect(high.config.avatar.pose.zoom).toBe(2.5);
    expect(high.config.avatar.pose.depth).toBe(0.25);

    const low = parseAvatar({ pose: { zoom: 0.01, depth: -5 } }) as { config: PocDeviceConfig; warnings: string[] };
    expect(low.config.avatar.pose.zoom).toBe(0.5);
    expect(low.config.avatar.pose.depth).toBe(-0.25);
    expect(low.warnings).toEqual([]);
  });

  it("never emits the legacy 'not applied' pose warning", () => {
    const result = parseAvatar({ pose: { avatarYaw: 1 } }) as { warnings: string[] };

    expect(result.warnings.join(" ")).not.toMatch(/not applied/i);
  });
});
