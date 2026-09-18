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

describe("parseDeviceConfig wakeWord validation (protocol 18/09/2026)", () => {
  function parseWakeWord(wakeWord: unknown) {
    return parseDeviceConfig({ ...withAvatar({}), wakeWord }) as
      | { config: PocDeviceConfig; warnings: string[] }
      | { error: string; message: string };
  }

  it("absent block: default null, key omitted, no warning", () => {
    const result = parseDeviceConfig(withAvatar({})) as { config: PocDeviceConfig; warnings: string[] };

    expect(result.config.wakeWord?.model ?? null).toBeNull();
    // Omitted (not an injected {model:null}) so a config roundtrip and the
    // "absent = leave the local desktop selection" apply rule both hold.
    expect(result.config.wakeWord).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it("accepts each of the four known model ids without a warning", () => {
    for (const model of ["hey_jarvis", "alexa", "hey_mycroft", "hey_rhasspy"] as const) {
      const result = parseWakeWord({ model }) as { config: PocDeviceConfig; warnings: string[] };
      expect(result.config.wakeWord).toEqual({ model });
      expect(result.warnings).toEqual([]);
    }
  });

  it("accepts model null (manual microphone) without a warning", () => {
    const result = parseWakeWord({ model: null }) as { config: PocDeviceConfig; warnings: string[] };

    expect(result.config.wakeWord).toEqual({ model: null });
    expect(result.warnings).toEqual([]);
  });

  it("warns and resolves an unknown model to null instead of failing", () => {
    const result = parseWakeWord({ model: "computer" }) as { config: PocDeviceConfig; warnings: string[] };

    expect(result.config.wakeWord).toEqual({ model: null });
    expect(result.warnings).toEqual(["wakeWord.model `computer` ignoré (inconnu)"]);
  });

  it("warns and resolves a non-string model to null instead of failing", () => {
    const result = parseWakeWord({ model: 42 }) as { config: PocDeviceConfig; warnings: string[] };

    expect(result.config.wakeWord).toEqual({ model: null });
    expect(result.warnings).toEqual(["wakeWord.model `42` ignoré (inconnu)"]);
  });

  it("accepts a full valid cue (all three fields) without a warning", () => {
    const cue = { flashColor: "#ff0044", blinkDurationMs: 1500, animationUrl: "/animations/Greeting.vrma" };
    const result = parseWakeWord({ model: "hey_jarvis", cue }) as { config: PocDeviceConfig; warnings: string[] };

    expect(result.config.wakeWord).toEqual({ model: "hey_jarvis", cue });
    expect(result.warnings).toEqual([]);
  });

  it("accepts a partial cue (only the fields sent are kept)", () => {
    const result = parseWakeWord({ model: "alexa", cue: { flashColor: "#22d3ee" } }) as {
      config: PocDeviceConfig;
      warnings: string[];
    };

    expect(result.config.wakeWord).toEqual({ model: "alexa", cue: { flashColor: "#22d3ee" } });
    expect(result.warnings).toEqual([]);
  });

  it("dropping cue fields independently: invalid color/duration/animation warned and omitted, valid ones kept", () => {
    const result = parseWakeWord({
      model: "alexa",
      cue: { flashColor: "#FF0044", blinkDurationMs: 900, animationUrl: "/animations/nope.vrma" }
    }) as { config: PocDeviceConfig; warnings: string[] };

    // Flash color must be lowercase strict, animation must exist in ANIMATION_OPTIONS.
    expect(result.config.wakeWord).toEqual({ model: "alexa", cue: { blinkDurationMs: 900 } });
    expect(result.warnings).toEqual([
      "wakeWord.cue.flashColor ignoré (attendu #rrggbb minuscule)",
      "wakeWord.cue.animationUrl ignoré (animation inconnue)"
    ]);
  });

  it("drops an out-of-bounds or non-integer blinkDurationMs with a warning", () => {
    for (const bad of [299, 3001, 900.5, Number.NaN, "900"]) {
      const result = parseWakeWord({ cue: { blinkDurationMs: bad } }) as {
        config: PocDeviceConfig;
        warnings: string[];
      };
      expect(result.config.wakeWord?.cue).toBeUndefined();
      expect(result.warnings).toEqual([
        "wakeWord.cue.blinkDurationMs ignoré (entier 300–3000 attendu)"
      ]);
    }
  });

  it("omits a cue that has no valid field (local cue settings survive)", () => {
    const result = parseWakeWord({ model: "hey_jarvis", cue: { flashColor: "red", animationUrl: 7 } }) as {
      config: PocDeviceConfig;
      warnings: string[];
    };

    expect(result.config.wakeWord).toEqual({ model: "hey_jarvis" });
    expect(result.warnings).toHaveLength(2);
  });

  it("absent cue keeps the existing model semantics and emits no warning", () => {
    const result = parseWakeWord({ model: "hey_mycroft" }) as { config: PocDeviceConfig; warnings: string[] };

    expect(result.config.wakeWord).toEqual({ model: "hey_mycroft" });
    expect(result.warnings).toEqual([]);
  });
});
