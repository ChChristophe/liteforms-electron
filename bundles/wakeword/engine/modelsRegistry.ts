/**
 * Adapted from the openWakeWord browser port:
 *   https://github.com/dscripka/openWakeWord/pull/339
 *   commit 1c76cd9b66400bccbed2a09fd86e70bb429dabd7 (web/src/models.js)
 * Original code licensed Apache-2.0 — see ../LICENSE.
 * Modifications: registry restricted to the pre-trained wake word models
 * shipped under public/models/wakeword/ plus the two required feature models;
 * silero_vad and the non-wakeword models (timer, weather) are intentionally
 * omitted.
 */

export const FEATURE_MODELS = {
  melspectrogram: "melspectrogram.onnx",
  embedding: "embedding_model.onnx",
} as const;

export const PRETRAINED_MODELS = {
  hey_jarvis: "hey_jarvis_v0.1.onnx",
  alexa: "alexa_v0.1.onnx",
  hey_mycroft: "hey_mycroft_v0.1.onnx",
  hey_rhasspy: "hey_rhasspy_v0.1.onnx",
} as const;

export type WakewordModelName = keyof typeof PRETRAINED_MODELS;

/** Spoken phrase / display label for each registered wake word model. */
export const WAKE_WORD_PHRASES: Record<WakewordModelName, string> = {
  hey_jarvis: "Hey Jarvis",
  alexa: "Alexa",
  hey_mycroft: "Hey Mycroft",
  hey_rhasspy: "Hey Rhasspy",
};
