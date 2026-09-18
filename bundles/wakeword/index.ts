export { WakeWordPocPanel } from "./components/WakeWordPocPanel";
export { WakeWordSettingsSelect } from "./components/WakeWordSettingsSelect";
export { useWakeWord } from "./hooks/useWakeWord";
export { WakeWordController } from "./controller/wakeWordController";
export {
  WAKE_WORD_DETECTED_EVENT,
  dispatchWakeWordDetected,
} from "./bridge/wakeWordEvents";
export {
  WakeWordChatBridge,
  shouldTriggerVoiceSession,
} from "./bridge/wakeWordChatBridge";
export {
  PRETRAINED_MODELS,
  WAKE_WORD_PHRASES,
} from "./engine/modelsRegistry";
export type { WakewordModelName } from "./engine/modelsRegistry";
export {
  clearWakeWordConfig,
  loadWakeWordConfig,
  saveWakeWordConfig,
  WAKE_WORD_CONFIG_KEY,
} from "./storage/wakeWordConfig";
export { useWakeWordSettingsStore } from "./store/wakeWordSettingsStore";
export { useWakeWordStore } from "./store/wakeWordStore";
export { WakeWordError } from "./types";
export type {
  WakeWordControllerOptions,
  WakeWordCueConfig,
  WakeWordDetectedEvent,
  WakeWordErrorCode,
  WakeWordEventMap,
  WakeWordLabel,
  WakeWordScoresEvent,
  WakeWordStatus,
} from "./types";

import type { ComponentType } from "react";
import { WakeWordPocPanel } from "./components/WakeWordPocPanel";

/**
 * Bundle manifest (ARCHITECTURE_BUNDLE.md §3).
 * Registered by a future lib/core loader; the POC page mounts
 * <WakeWordPocPanel /> directly meanwhile.
 */
export const wakewordBundle = {
  id: "wakeword",
  name: "Wake word (Hey Jarvis)",
  version: "0.1.0",
  components: {
    banner: [WakeWordPocPanel] satisfies ComponentType[],
  },
  onDestroy: () => {
    // Controllers are owned by React hooks; nothing global to tear down yet.
  },
};
