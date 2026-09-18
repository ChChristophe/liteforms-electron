/**
 * Wake-word visual cue sequencing (ETUDES_wakeword_feedback_et_streaming.md §5).
 *
 * Pure timing logic, no three.js / DOM dependencies: the caller supplies
 * callbacks so the module stays unit-testable and the AvatarScene wiring
 * stays trivial. Everything runs on timers off the audio critical path —
 * wake word detection → mic start latency is untouched.
 *
 * Sequence on each detection:
 *   playGreeting() immediately, then rapid ON/OFF alcove flashes covering
 *   roughly `durationMs`, always ending hidden (base tint restored).
 *   Restarting the cue cancels the previous blink mid-flight.
 */

/** Alcove flash color (Settings > Advanced > Wake word > Flash color). */
export const WAKE_WORD_CUE_FLASH_COLOR = "#22d3ee";
/** Total approximate blink duration. */
export const WAKE_WORD_CUE_DEFAULT_DURATION_MS = 900;
export const WAKE_WORD_CUE_MIN_DURATION_MS = 300;
export const WAKE_WORD_CUE_MAX_DURATION_MS = 3000;
/** Animation played on detection; must exist in ANIMATION_OPTIONS. */
export const WAKE_WORD_CUE_DEFAULT_ANIMATION_URL = "/animations/Greeting.vrma";

const FLASH_ON_MS = 160;
const FLASH_OFF_MS = 140;

export interface WakeWordCueHandles {
  /** Applies the flash tint to the alcove. */
  showFlash(): void;
  /** Restores the user's base tint on the alcove. */
  hideFlash(): void;
  /** Starts the greeting animation on the avatar. */
  playGreeting(): void;
}

export interface WakeWordCueOptions {
  /** Approximate total duration of the blink sequence. Default 900 ms. */
  durationMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

/** Cancels the cue; guarantees a final hideFlash() if a flash is active. */
export type CancelWakeWordCue = () => void;

const CYCLE_MS = FLASH_ON_MS + FLASH_OFF_MS;

function blinkCountForDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 1;
  }
  return Math.min(
    Math.floor(WAKE_WORD_CUE_MAX_DURATION_MS / CYCLE_MS),
    Math.max(1, Math.round(durationMs / CYCLE_MS)),
  );
}

export function startWakeWordCue(
  handles: WakeWordCueHandles,
  options: WakeWordCueOptions = {}
): CancelWakeWordCue {
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const blinkCount = blinkCountForDuration(options.durationMs ?? WAKE_WORD_CUE_DEFAULT_DURATION_MS);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let flashing = false;
  let cancelled = false;

  handles.playGreeting();

  const finish = (): void => {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
    if (flashing) {
      flashing = false;
      handles.hideFlash();
    }
  };

  const scheduleBlink = (index: number): void => {
    if (cancelled || index >= blinkCount) {
      return;
    }
    flashing = true;
    handles.showFlash();
    timer = setTimeoutFn(() => {
      flashing = false;
      handles.hideFlash();
      if (index + 1 < blinkCount) {
        timer = setTimeoutFn(() => scheduleBlink(index + 1), FLASH_OFF_MS);
      }
    }, FLASH_ON_MS);
  };

  scheduleBlink(0);

  return () => {
    cancelled = true;
    finish();
  };
}
