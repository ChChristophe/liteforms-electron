/**
 * Cross-window wake-word cue relay (symptom: the alcove blink + greeting cue
 * fired by the bridge's CustomEvent in the main window never reached the
 * dedicated /hologram window, which is what the user actually watches).
 *
 * Same mechanism as mood/pose: the emitting window writes localStorage, every
 * other same-origin window receives the `storage` event and replays. The spec
 * guarantees the emitting window does not receive its own event, so no double
 * playback. Client-only module: localStorage access is guarded.
 */

export const WAKE_WORD_CUE_TRIGGER_KEY = "liteforms.wakewordCueTrigger";

export type WakeWordCueTriggerCue = {
  flashColor?: string;
  blinkDurationMs?: number;
  animationUrl?: string;
};

export type WakeWordCueTrigger = {
  id: number;
  cue?: WakeWordCueTriggerCue;
};

/** Writes the trigger for other windows; never throws. */
export function publishWakeWordCue(cue?: WakeWordCueTriggerCue): void {
  try {
    localStorage.setItem(
      WAKE_WORD_CUE_TRIGGER_KEY,
      JSON.stringify({ id: Date.now() + Math.random(), cue })
    );
  } catch {
    // localStorage may be unavailable in private browsing or when quota is exceeded.
  }
}

/** Tolerant parse of a stored trigger; null when invalid. */
export function parseWakeWordCueTrigger(raw: string | null): WakeWordCueTrigger | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const v = parsed as Record<string, unknown>;
    if (typeof v.id !== "number" || !Number.isFinite(v.id)) return null;
    if (v.cue === undefined) return { id: v.id };
    if (typeof v.cue !== "object" || v.cue === null) return null;
    const c = v.cue as Record<string, unknown>;
    const cue: WakeWordCueTriggerCue = {};
    if (typeof c.flashColor === "string") cue.flashColor = c.flashColor;
    if (typeof c.blinkDurationMs === "number" && Number.isFinite(c.blinkDurationMs)) {
      cue.blinkDurationMs = c.blinkDurationMs;
    }
    if (typeof c.animationUrl === "string") cue.animationUrl = c.animationUrl;
    return { id: v.id, cue };
  } catch {
    return null;
  }
}
