import { describe, expect, it } from "vitest";
import { parseDeviceConfig, type PocDeviceConfig } from "./pocConfig";

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
