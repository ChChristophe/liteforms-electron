/**
 * Liteforms wake word bundle — user-facing selection store.
 *
 * Single source of truth for "which wake word is active" and the visual-cue
 * settings (ETUDES §5), hydrated once from localStorage and persisted on every
 * change. Consumed by the settings select (components/WakeWordSettingsSelect.tsx),
 * the ChatPanel bridge (arming + cue payload) and the mic-area hint in ChatPanel.
 */

import { create } from "zustand";
import {
  WAKE_WORD_CUE_DEFAULT_ANIMATION_URL,
  WAKE_WORD_CUE_DEFAULT_DURATION_MS,
  WAKE_WORD_CUE_FLASH_COLOR,
} from "@/lib/avatar/wakeWordCue";
import type { WakewordModelName } from "../engine/modelsRegistry";
import {
  loadWakeWordConfig,
  saveWakeWordConfig,
} from "../storage/wakeWordConfig";

interface WakeWordSettingsState {
  /** Selected wake word model, or null when none (manual microphone). */
  selected: WakewordModelName | null;
  /** Alcove flash color of the wake word cue ("#rrggbb"). */
  cueFlashColor: string;
  /** Approximate total alcove blink duration in ms. */
  cueBlinkDurationMs: number;
  /** Animation played on detection (ANIMATION_OPTIONS url). */
  cueAnimationUrl: string;
  /** True once the initial value has been read from localStorage. */
  hydrated: boolean;
  /** Reads the persisted settings. Idempotent; call on mount. */
  hydrate: () => void;
  /** Persists the selection and updates the store. */
  setSelected: (model: WakewordModelName | null) => void;
  /** Persists the cue flash color. */
  setCueFlashColor: (color: string) => void;
  /** Persists the alcove blink duration in ms. */
  setCueBlinkDurationMs: (ms: number) => void;
  /** Persists the animation played on detection. */
  setCueAnimationUrl: (url: string) => void;
}

export const useWakeWordSettingsStore = create<WakeWordSettingsState>()(
  (set, get) => ({
    selected: null,
    cueFlashColor: WAKE_WORD_CUE_FLASH_COLOR,
    cueBlinkDurationMs: WAKE_WORD_CUE_DEFAULT_DURATION_MS,
    cueAnimationUrl: WAKE_WORD_CUE_DEFAULT_ANIMATION_URL,
    hydrated: false,
    hydrate: () => {
      if (get().hydrated) return;
      const saved = loadWakeWordConfig();
      set({
        selected: saved?.model ?? null,
        cueFlashColor: saved?.cueFlashColor ?? WAKE_WORD_CUE_FLASH_COLOR,
        cueBlinkDurationMs:
          typeof saved?.cueBlinkDurationMs === "number"
            ? saved.cueBlinkDurationMs
            : WAKE_WORD_CUE_DEFAULT_DURATION_MS,
        cueAnimationUrl: saved?.cueAnimationUrl ?? WAKE_WORD_CUE_DEFAULT_ANIMATION_URL,
        hydrated: true,
      });
    },
    setSelected: (model) => {
      saveWakeWordConfig({ model, ...pickCueFields(get()) });
      set({ selected: model });
    },
    setCueFlashColor: (color) => {
      saveWakeWordConfig({ model: get().selected, ...pickCueFields(get()), cueFlashColor: color });
      set({ cueFlashColor: color });
    },
    setCueBlinkDurationMs: (ms) => {
      saveWakeWordConfig({ model: get().selected, ...pickCueFields(get()), cueBlinkDurationMs: ms });
      set({ cueBlinkDurationMs: ms });
    },
    setCueAnimationUrl: (url) => {
      saveWakeWordConfig({ model: get().selected, ...pickCueFields(get()), cueAnimationUrl: url });
      set({ cueAnimationUrl: url });
    },
  }),
);

function pickCueFields(state: WakeWordSettingsState): {
  cueFlashColor: string;
  cueBlinkDurationMs: number;
  cueAnimationUrl: string;
} {
  return {
    cueFlashColor: state.cueFlashColor,
    cueBlinkDurationMs: state.cueBlinkDurationMs,
    cueAnimationUrl: state.cueAnimationUrl,
  };
}
