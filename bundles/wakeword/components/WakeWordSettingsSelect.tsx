"use client";

/**
 * Wake word picker + visual-cue settings for ChatPanel's Settings > Advanced
 * section.
 *
 * Follows the Mood/alcove-color control conventions (vrm-row /
 * alcove-color-label / vrm-filename / advanced-hint). Selection is persisted
 * through the wake word settings store; choosing "None" clears it and returns
 * the chat to its initial manual-microphone state. The cue controls (flash
 * color, blink duration, greeting animation) only appear once a wake word is
 * selected.
 */

import { useEffect } from "react";
import {
  PRETRAINED_MODELS,
  WAKE_WORD_PHRASES,
  type WakewordModelName,
} from "../engine/modelsRegistry";
import { useWakeWordSettingsStore } from "../store/wakeWordSettingsStore";
import {
  WAKE_WORD_CUE_DEFAULT_ANIMATION_URL,
  WAKE_WORD_CUE_DEFAULT_DURATION_MS,
  WAKE_WORD_CUE_FLASH_COLOR,
  WAKE_WORD_CUE_MAX_DURATION_MS,
  WAKE_WORD_CUE_MIN_DURATION_MS,
} from "@/lib/avatar/wakeWordCue";
import { ANIMATION_OPTIONS } from "@/lib/avatar/animationOptions";
import { isBundleEnabled } from "@/lib/core/featureFlags";

const CUE_SLIDER_STEP_MS = 100;

/** The idle loop is the base pose, never a meaningful wake word cue. */
const CUE_ANIMATION_CHOICES = ANIMATION_OPTIONS.filter(
  (option) => option.url !== "/animations/idle_loop.vrma"
);

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

export function WakeWordSettingsSelect() {
  const enabled = isBundleEnabled("wakeword");
  const selected = useWakeWordSettingsStore((s) => s.selected);
  const cueFlashColor = useWakeWordSettingsStore((s) => s.cueFlashColor);
  const cueBlinkDurationMs = useWakeWordSettingsStore((s) => s.cueBlinkDurationMs);
  const cueAnimationUrl = useWakeWordSettingsStore((s) => s.cueAnimationUrl);
  const hydrated = useWakeWordSettingsStore((s) => s.hydrated);
  const hydrate = useWakeWordSettingsStore((s) => s.hydrate);
  const setSelected = useWakeWordSettingsStore((s) => s.setSelected);
  const setCueFlashColor = useWakeWordSettingsStore((s) => s.setCueFlashColor);
  const setCueBlinkDurationMs = useWakeWordSettingsStore((s) => s.setCueBlinkDurationMs);
  const setCueAnimationUrl = useWakeWordSettingsStore((s) => s.setCueAnimationUrl);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (!enabled || !hydrated) return null;

  return (
    <>
      <div className="vrm-row" aria-label="Wake word">
        <label className="alcove-color-label">
          Wake word
          <select
            value={selected ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              setSelected(value === "" ? null : (value as WakewordModelName));
            }}
          >
            <option value="">None</option>
            {(Object.keys(PRETRAINED_MODELS) as WakewordModelName[]).map((name) => (
              <option key={name} value={name}>
                {WAKE_WORD_PHRASES[name]}
              </option>
            ))}
          </select>
        </label>
        <span className="vrm-filename">
          {selected ? WAKE_WORD_PHRASES[selected] : "Manual microphone"}
        </span>
      </div>
      {selected ? (
        <>
          <div className="vrm-row" aria-label="Wake word feedback">
            <label className="alcove-color-label">
              Flash color
              <input
                type="color"
                aria-label="Wake word flash color"
                value={cueFlashColor}
                onChange={(event) => setCueFlashColor(event.target.value)}
              />
            </label>
            {cueFlashColor.toLowerCase() !== WAKE_WORD_CUE_FLASH_COLOR && (
              <button type="button" className="btn-ghost" onClick={() => setCueFlashColor(WAKE_WORD_CUE_FLASH_COLOR)}>
                Reset
              </button>
            )}
            <span className="vrm-filename">{cueFlashColor}</span>
          </div>
          <div className="vrm-row" aria-label="Wake word blink timing">
            <label className="alcove-color-label">
              Clignotement&nbsp;: {formatSeconds(cueBlinkDurationMs)}
              <input
                type="range"
                aria-label="Wake word blink duration"
                min={WAKE_WORD_CUE_MIN_DURATION_MS}
                max={WAKE_WORD_CUE_MAX_DURATION_MS}
                step={CUE_SLIDER_STEP_MS}
                value={cueBlinkDurationMs}
                onChange={(event) => setCueBlinkDurationMs(Number(event.target.value))}
              />
            </label>
            {cueBlinkDurationMs !== WAKE_WORD_CUE_DEFAULT_DURATION_MS && (
              <button type="button" className="btn-ghost" onClick={() => setCueBlinkDurationMs(WAKE_WORD_CUE_DEFAULT_DURATION_MS)}>
                Reset
              </button>
            )}
          </div>
          <div className="vrm-row" aria-label="Wake word animation choice">
            <label className="alcove-color-label">
              Animation
              <select
                aria-label="Wake word animation"
                value={cueAnimationUrl}
                onChange={(event) => setCueAnimationUrl(event.target.value)}
              >
                {CUE_ANIMATION_CHOICES.map((option) => (
                  <option key={option.url} value={option.url}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {cueAnimationUrl !== WAKE_WORD_CUE_DEFAULT_ANIMATION_URL && (
              <button type="button" className="btn-ghost" onClick={() => setCueAnimationUrl(WAKE_WORD_CUE_DEFAULT_ANIMATION_URL)}>
                Reset
              </button>
            )}
            <span className="vrm-filename">
              {CUE_ANIMATION_CHOICES.find((o) => o.url === cueAnimationUrl)?.label}
            </span>
          </div>
          <p className="advanced-hint">
            On detection the alcove flashes in this color for the set duration
            and the avatar plays the selected animation.
          </p>
        </>
      ) : (
        <p className="advanced-hint">
          Always-on voice trigger. While a wake word is selected the manual mic is
          disabled: say the phrase, speak your sentence, a short silence submits
          it. &ldquo;None&rdquo; restores the manual microphone.
        </p>
      )}
    </>
  );
}
