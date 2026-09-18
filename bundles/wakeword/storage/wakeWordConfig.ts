/**
 * Persisted wake word selection + visual-cue settings
 * (Settings > Advanced > Wake word).
 *
 * Follows the repo-wide localStorage template (see lib/storage/moodConfig.ts)
 * but lives inside the bundle so the core never touches wake-word specifics.
 *
 * The cue fields are additive/optional so configs saved before their
 * introduction stay valid (version stays 1).
 */

import {
  WAKE_WORD_CUE_MAX_DURATION_MS,
  WAKE_WORD_CUE_MIN_DURATION_MS,
} from "@/lib/avatar/wakeWordCue";
import { ANIMATION_OPTIONS } from "@/lib/avatar/animationOptions";
import { PRETRAINED_MODELS, type WakewordModelName } from "../engine/modelsRegistry";

export const WAKE_WORD_CONFIG_KEY = "liteforms.wakewordConfig";

/** Matches the environmentConfig alcove color validation. */
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

export type WakeWordConfigStore = {
  version: 1;
  model: WakewordModelName | null;
  /** Alcove flash color for the wake word cue; null = default (#22d3ee). */
  cueFlashColor?: string | null;
  /** Approximate total alcove blink duration in ms. */
  cueBlinkDurationMs?: number | null;
  /** Animation played on detection; must be one of ANIMATION_OPTIONS urls. */
  cueAnimationUrl?: string | null;
};

export function saveWakeWordConfig(config: Omit<WakeWordConfigStore, "version">): void {
  try {
    localStorage.setItem(WAKE_WORD_CONFIG_KEY, JSON.stringify({ version: 1, ...config }));
  } catch {
    // localStorage may be unavailable in private browsing or when quota is exceeded.
  }
}

export function loadWakeWordConfig(): WakeWordConfigStore | null {
  try {
    const raw = localStorage.getItem(WAKE_WORD_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isWakeWordConfigStore(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearWakeWordConfig(): void {
  try {
    localStorage.removeItem(WAKE_WORD_CONFIG_KEY);
  } catch {
    // ignore
  }
}

function isWakeWordConfigStore(value: unknown): value is WakeWordConfigStore {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (
    v.version !== 1 ||
    !(v.model === null ||
      (typeof v.model === "string" && v.model in PRETRAINED_MODELS))
  ) {
    return false;
  }
  const validColor = (x: unknown): boolean =>
    x === undefined || x === null || (typeof x === "string" && HEX_COLOR_PATTERN.test(x));
  const validDuration = (x: unknown): boolean =>
    x === undefined ||
    x === null ||
    (typeof x === "number" &&
      Number.isInteger(x) &&
      x >= WAKE_WORD_CUE_MIN_DURATION_MS &&
      x <= WAKE_WORD_CUE_MAX_DURATION_MS);
  const knownAnimationUrls = new Set(ANIMATION_OPTIONS.map((option) => option.url));
  const validAnimation = (x: unknown): boolean =>
    x === undefined || x === null || (typeof x === "string" && knownAnimationUrls.has(x));
  return validColor(v.cueFlashColor) && validDuration(v.cueBlinkDurationMs) && validAnimation(v.cueAnimationUrl);
}
