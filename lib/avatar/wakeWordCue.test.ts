import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startWakeWordCue,
  WAKE_WORD_CUE_DEFAULT_DURATION_MS,
} from "./wakeWordCue";

const ON_MS = 160;
const OFF_MS = 140;
const CYCLE_MS = ON_MS + OFF_MS;

function makeHandles() {
  return {
    showFlash: vi.fn(),
    hideFlash: vi.fn(),
    playGreeting: vi.fn()
  };
}

describe("startWakeWordCue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function runBlinks(handles: ReturnType<typeof makeHandles>, count: number) {
    for (let i = 0; i < count; i++) {
      expect(handles.showFlash).toHaveBeenCalledTimes(i + 1);
      vi.advanceTimersByTime(ON_MS);
      expect(handles.hideFlash).toHaveBeenCalledTimes(i + 1);
      if (i + 1 < count) {
        vi.advanceTimersByTime(OFF_MS);
      }
    }
  }

  it("derives the flash count from the requested duration", () => {
    const handles = makeHandles();
    const cancel = startWakeWordCue(handles, { durationMs: 4 * CYCLE_MS });
    runBlinks(handles, 4);
    vi.advanceTimersByTime(10_000);
    expect(handles.showFlash).toHaveBeenCalledTimes(4);
    cancel();
  });

  it("always performs at least one flash for very short durations", () => {
    const handles = makeHandles();
    const cancel = startWakeWordCue(handles, { durationMs: 100 });
    runBlinks(handles, 1);
    vi.advanceTimersByTime(10_000);
    expect(handles.showFlash).toHaveBeenCalledTimes(1);
    expect(handles.hideFlash).toHaveBeenCalledTimes(1);
    cancel();
  });

  it("default duration matches the documented default constant", () => {
    const handles = makeHandles();
    const expectedCount = Math.max(
      1,
      Math.round(WAKE_WORD_CUE_DEFAULT_DURATION_MS / CYCLE_MS)
    );
    const cancel = startWakeWordCue(handles);
    runBlinks(handles, expectedCount);
    vi.advanceTimersByTime(10_000);
    expect(handles.showFlash).toHaveBeenCalledTimes(expectedCount);
    cancel();
  });

  it("plays the greeting immediately and ends hidden with no trailing timer", () => {
    const handles = makeHandles();
    const cancel = startWakeWordCue(handles, { durationMs: 2 * CYCLE_MS });
    expect(handles.playGreeting).toHaveBeenCalledTimes(1);
    runBlinks(handles, 2);
    expect(vi.getTimerCount()).toBe(0);
    cancel();
  });

  it("cancel stops the sequence and restores the base tint exactly once", () => {
    const handles = makeHandles();
    const cancel = startWakeWordCue(handles, { durationMs: 6 * CYCLE_MS });

    vi.advanceTimersByTime(ON_MS); // flash 1 -> off
    vi.advanceTimersByTime(OFF_MS); // flash 2 on
    expect(handles.showFlash).toHaveBeenCalledTimes(2);
    expect(handles.hideFlash).toHaveBeenCalledTimes(1);

    cancel();

    expect(handles.hideFlash).toHaveBeenCalledTimes(2); // restored
    vi.advanceTimersByTime(10_000);
    expect(handles.showFlash).toHaveBeenCalledTimes(2); // frozen
    expect(handles.hideFlash).toHaveBeenCalledTimes(2); // no extra restore

    // Double cancel is safe.
    cancel();
    expect(handles.hideFlash).toHaveBeenCalledTimes(2);
  });

  it("invalid durations fall back to a single flash", () => {
    const handles = makeHandles();
    const cancel = startWakeWordCue(handles, { durationMs: Number.NaN });
    runBlinks(handles, 1);
    vi.advanceTimersByTime(10_000);
    expect(handles.showFlash).toHaveBeenCalledTimes(1);
    cancel();
  });
});
