// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearWakeWordConfig,
  loadWakeWordConfig,
  WAKE_WORD_CONFIG_KEY,
} from "../storage/wakeWordConfig";
import { useWakeWordSettingsStore } from "../store/wakeWordSettingsStore";
import { WakeWordSettingsSelect } from "./WakeWordSettingsSelect";

function saveModelForTest(model: string) {
  localStorage.setItem(WAKE_WORD_CONFIG_KEY, JSON.stringify({ version: 1, model }));
}

describe("WakeWordSettingsSelect", () => {
  beforeEach(() => {
    useWakeWordSettingsStore.setState({
      selected: null,
      cueFlashColor: "#22d3ee",
      cueBlinkDurationMs: 900,
      cueAnimationUrl: "/animations/Greeting.vrma",
      hydrated: false,
    });
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("lists every registered wake word plus the None option", async () => {
    render(<WakeWordSettingsSelect />);
    const select = (await screen.findByRole("combobox", {
      name: "Wake word",
    })) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["", "hey_jarvis", "alexa", "hey_mycroft", "hey_rhasspy"]);
    expect(select.value).toBe("");
    expect(screen.getByText("Manual microphone")).toBeTruthy();
  });

  it("hides the cue controls while no wake word is selected", () => {
    render(<WakeWordSettingsSelect />);
    expect(screen.queryByLabelText("Wake word flash color")).toBeNull();
    expect(screen.queryByLabelText("Wake word blink duration")).toBeNull();
    expect(screen.queryByLabelText("Wake word animation")).toBeNull();
  });

  it("selecting a wake word persists it and shows its phrase", () => {
    const { container } = render(<WakeWordSettingsSelect />);
    const select = screen.getByRole("combobox", { name: "Wake word" });

    fireEvent.change(select, { target: { value: "hey_jarvis" } });

    expect(useWakeWordSettingsStore.getState().selected).toBe("hey_jarvis");
    expect(loadWakeWordConfig()?.model).toBe("hey_jarvis");
    expect(container.querySelector(".vrm-filename")?.textContent).toBe("Hey Jarvis");

    // A reload hydrates back the same selection.
    useWakeWordSettingsStore.setState({ selected: null, hydrated: false });
    cleanup();
    render(<WakeWordSettingsSelect />);
    const reloaded = screen.getByRole("combobox", { name: "Wake word" }) as HTMLSelectElement;
    expect(reloaded.value).toBe("hey_jarvis");
  });

  it("shows and persists the flash color once a wake word is chosen", () => {
    saveModelForTest("alexa");
    useWakeWordSettingsStore.getState().hydrate();
    render(<WakeWordSettingsSelect />);

    const color = screen.getByLabelText("Wake word flash color") as HTMLInputElement;
    expect(color.value.toLowerCase()).toBe("#22d3ee");

    fireEvent.change(color, { target: { value: "#ff8800" } });

    const saved = loadWakeWordConfig();
    expect(saved?.cueFlashColor).toBe("#ff8800");
    expect(saved?.model).toBe("alexa");

    const reset = screen.getByRole("button", { name: "Reset" });
    fireEvent.click(reset);
    expect(loadWakeWordConfig()?.cueFlashColor).toBe("#22d3ee");
  });

  it("shows and persists the alcove blink duration", () => {
    saveModelForTest("alexa");
    useWakeWordSettingsStore.getState().hydrate();
    render(<WakeWordSettingsSelect />);

    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(slider.value).toBe("900");
    expect(screen.getByText(/Clignotement/)).toBeTruthy();

    fireEvent.change(slider, { target: { value: "2000" } });

    expect(loadWakeWordConfig()?.cueBlinkDurationMs).toBe(2000);
    expect(useWakeWordSettingsStore.getState().cueBlinkDurationMs).toBe(2000);
    expect(screen.getByText(/2,0 s/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(loadWakeWordConfig()?.cueBlinkDurationMs).toBe(900);
    expect((screen.getByRole("slider") as HTMLInputElement).value).toBe("900");

    clearWakeWordConfig();
  });

  it("offers the animation choice and persists it once a wake word is chosen", () => {
    saveModelForTest("alexa");
    useWakeWordSettingsStore.getState().hydrate();
    render(<WakeWordSettingsSelect />);

    const animation = screen.getByLabelText("Wake word animation") as HTMLSelectElement;
    expect(animation.value).toBe("/animations/Greeting.vrma");

    const values = Array.from(animation.options).map((o) => o.value);
    expect(values).toContain("/animations/Greeting.vrma");
    expect(values).toContain("/animations/Spin.vrma");
    expect(values).not.toContain("/animations/idle_loop.vrma");
    expect(values.every((url) => url.startsWith("/animations/"))).toBe(true);

    fireEvent.change(animation, { target: { value: "/animations/Surprised.vrma" } });

    const saved = loadWakeWordConfig();
    expect(saved?.cueAnimationUrl).toBe("/animations/Surprised.vrma");
    expect(saved?.model).toBe("alexa");

    // Reset restores Greeting and keeps everything else.
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(loadWakeWordConfig()?.cueAnimationUrl).toBe("/animations/Greeting.vrma");

    // A reload hydrates the same animation back.
    useWakeWordSettingsStore.setState({ hydrated: false });
    cleanup();
    render(<WakeWordSettingsSelect />);
    const reloaded = screen.getByLabelText("Wake word animation") as HTMLSelectElement;
    expect(reloaded.value).toBe("/animations/Greeting.vrma");

    clearWakeWordConfig();
  });

  it("selecting None clears the persisted wake word", () => {
    saveModelForTest("alexa");
    useWakeWordSettingsStore.getState().hydrate();
    render(<WakeWordSettingsSelect />);
    const select = screen.getByRole("combobox", { name: "Wake word" }) as HTMLSelectElement;
    expect(select.value).toBe("alexa");

    fireEvent.change(select, { target: { value: "" } });

    expect(useWakeWordSettingsStore.getState().selected).toBeNull();
    expect(loadWakeWordConfig()?.model).toBeNull();
    expect(screen.getByText("Manual microphone")).toBeTruthy();
    expect(localStorage.getItem(WAKE_WORD_CONFIG_KEY)).not.toBeNull();
    clearWakeWordConfig();
  });
});
