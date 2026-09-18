import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURE_MODELS, PRETRAINED_MODELS } from "./modelsRegistry";

const PROJECT_ROOT = resolve(__dirname, "../../..");

describe("wakeword models registry", () => {
  it("exposes the pretrained wake word models shipped with the bundle", () => {
    expect(Object.keys(PRETRAINED_MODELS)).toEqual([
      "hey_jarvis",
      "alexa",
      "hey_mycroft",
      "hey_rhasspy",
    ]);
    expect(PRETRAINED_MODELS.hey_jarvis).toBe("hey_jarvis_v0.1.onnx");
    expect(PRETRAINED_MODELS.alexa).toBe("alexa_v0.1.onnx");
    expect(PRETRAINED_MODELS.hey_mycroft).toBe("hey_mycroft_v0.1.onnx");
    expect(PRETRAINED_MODELS.hey_rhasspy).toBe("hey_rhasspy_v0.1.onnx");
  });

  it("exposes the two feature models required by the pipeline", () => {
    expect(FEATURE_MODELS.melspectrogram).toBe("melspectrogram.onnx");
    expect(FEATURE_MODELS.embedding).toBe("embedding_model.onnx");
  });

  it("points to model files that exist under public/models/wakeword/", () => {
    const dir = resolve(PROJECT_ROOT, "public/models/wakeword");
    for (const file of [
      ...Object.values(FEATURE_MODELS),
      ...Object.values(PRETRAINED_MODELS),
    ]) {
      expect(existsSync(resolve(dir, file)), file).toBe(true);
    }
  });
});
