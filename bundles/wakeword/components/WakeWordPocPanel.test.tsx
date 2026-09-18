// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WakeWordPocPanel } from "./WakeWordPocPanel";

interface CapturedOptions {
  wakewordModels?: string[];
  autoStart?: boolean;
}

const { hookCalls, mockState } = vi.hoisted(() => ({
  hookCalls: [] as CapturedOptions[],
  mockState: { status: "disabled" as string },
}));

vi.mock("../hooks/useWakeWord", () => ({
  useWakeWord: (options: CapturedOptions) => {
    hookCalls.push(options);
    return {
      status: mockState.status,
      score: 0,
      lastDetection: null,
      error: null,
      start: vi.fn(),
      stop: vi.fn(),
      setThreshold: vi.fn(),
    };
  },
}));

describe("WakeWordPocPanel", () => {
  beforeEach(() => {
    hookCalls.length = 0;
    mockState.status = "disabled";
  });

  afterEach(() => {
    cleanup();
  });

  it("lists every registered wake word model, hey_jarvis default", () => {
    render(<WakeWordPocPanel />);
    const select = screen.getByLabelText("Modèle wake word") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["hey_jarvis", "alexa", "hey_mycroft", "hey_rhasspy"]);
    expect(select.value).toBe("hey_jarvis");
    expect(hookCalls[hookCalls.length - 1].wakewordModels).toEqual(["hey_jarvis"]);
  });

  it("recreates the pipeline bound to the selected model", () => {
    const { container } = render(<WakeWordPocPanel />);

    fireEvent.change(screen.getByLabelText("Modèle wake word"), {
      target: { value: "alexa" },
    });

    // Remount -> a second hook invocation bound to the new model.
    expect(hookCalls[hookCalls.length - 1].wakewordModels).toEqual(["alexa"]);
    expect(container.querySelector("section > p")?.textContent).toContain("Alexa");
  });

  it("restarts listening automatically when switching while running", () => {
    const view = render(<WakeWordPocPanel />);
    expect(hookCalls[0].autoStart).toBe(false);

    // Pipeline running -> switch model -> the new runner must auto-start.
    mockState.status = "listening";
    view.rerender(<WakeWordPocPanel />);
    fireEvent.change(screen.getByLabelText("Modèle wake word"), {
      target: { value: "hey_mycroft" },
    });

    expect(hookCalls[hookCalls.length - 1].wakewordModels).toEqual(["hey_mycroft"]);
    expect(hookCalls[hookCalls.length - 1].autoStart).toBe(true);
  });
});
