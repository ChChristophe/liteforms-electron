// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  loadWakeWordConfig,
  WAKE_WORD_CONFIG_KEY,
} from "../storage/wakeWordConfig";
import { useWakeWordSettingsStore } from "./wakeWordSettingsStore";

function resetStore() {
  useWakeWordSettingsStore.setState({
    selected: null,
    cueFlashColor: "#22d3ee",
    cueBlinkDurationMs: 900,
    cueAnimationUrl: "/animations/Greeting.vrma",
    hydrated: false,
  });
  localStorage.clear();
}

describe("wake word settings store", () => {
  beforeEach(resetStore);

  it("hydrate reads the persisted selection once", () => {
    localStorage.setItem(
      WAKE_WORD_CONFIG_KEY,
      JSON.stringify({ version: 1, model: "hey_jarvis" }),
    );
    const { hydrate } = useWakeWordSettingsStore.getState();
    hydrate();
    expect(useWakeWordSettingsStore.getState().selected).toBe("hey_jarvis");
    expect(useWakeWordSettingsStore.getState().hydrated).toBe(true);

    // A second hydration must not overwrite newer in-memory state.
    useWakeWordSettingsStore.getState().setSelected(null);
    hydrate();
    expect(useWakeWordSettingsStore.getState().selected).toBeNull();
  });

  it("hydrate applies defaults when the config predates the cue fields", () => {
    localStorage.setItem(WAKE_WORD_CONFIG_KEY, JSON.stringify({ version: 1, model: "alexa" }));
    useWakeWordSettingsStore.getState().hydrate();
    expect(useWakeWordSettingsStore.getState().cueFlashColor).toBe("#22d3ee");
    expect(useWakeWordSettingsStore.getState().cueBlinkDurationMs).toBe(900);
    expect(useWakeWordSettingsStore.getState().cueAnimationUrl).toBe("/animations/Greeting.vrma");
  });

  it("hydrate without saved config yields null", () => {
    useWakeWordSettingsStore.getState().hydrate();
    expect(useWakeWordSettingsStore.getState().selected).toBeNull();
    expect(useWakeWordSettingsStore.getState().hydrated).toBe(true);
  });

  it("setSelected persists and updates the store", () => {
    useWakeWordSettingsStore.getState().hydrate();
    useWakeWordSettingsStore.getState().setSelected("alexa");
    expect(useWakeWordSettingsStore.getState().selected).toBe("alexa");
    expect(JSON.parse(localStorage.getItem(WAKE_WORD_CONFIG_KEY)!)).toEqual({
      version: 1,
      model: "alexa",
      cueFlashColor: "#22d3ee",
      cueBlinkDurationMs: 900,
      cueAnimationUrl: "/animations/Greeting.vrma",
    });

    useWakeWordSettingsStore.getState().setSelected(null);
    expect(useWakeWordSettingsStore.getState().selected).toBeNull();
    expect(JSON.parse(localStorage.getItem(WAKE_WORD_CONFIG_KEY)!).model).toBeNull();
  });

  it("cue setters persist alongside the model selection", () => {
    useWakeWordSettingsStore.getState().hydrate();
    const store = useWakeWordSettingsStore.getState();

    store.setSelected("hey_mycroft");
    store.setCueFlashColor("#ff0044");
    store.setCueBlinkDurationMs(1500);
    store.setCueAnimationUrl("/animations/Surprised.vrma");

    expect(useWakeWordSettingsStore.getState().cueAnimationUrl).toBe("/animations/Surprised.vrma");
    expect(loadWakeWordConfig()).toEqual({
      version: 1,
      model: "hey_mycroft",
      cueFlashColor: "#ff0044",
      cueBlinkDurationMs: 1500,
      cueAnimationUrl: "/animations/Surprised.vrma",
    });

    // Resetting the animation back to default keeps the other fields intact.
    store.setCueAnimationUrl("/animations/Greeting.vrma");
    expect(loadWakeWordConfig()?.cueAnimationUrl).toBe("/animations/Greeting.vrma");
  });
});
