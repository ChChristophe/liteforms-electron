// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWakeWordSettingsStore } from "../store/wakeWordSettingsStore";

interface MockController {
  options: Record<string, unknown>;
  listeners: Map<string, (event?: unknown) => void>;
  started: boolean;
  destroyed: boolean;
}

const { controllers, publishWakeWordCue } = vi.hoisted(() => ({
  controllers: [] as Array<MockController & { start: () => Promise<void> }>,
  publishWakeWordCue: vi.fn(),
}));

// The bridge owns the cross-window relay (the main window's AvatarScene is
// unmounted while the hologram is active), so it must be covered here.
vi.mock("@/lib/storage/wakeWordCueTrigger", () => ({ publishWakeWordCue }));

vi.mock("../controller/wakeWordController", () => {
  class WakeWordController {
    options: Record<string, unknown>;
    listeners = new Map<string, (event?: unknown) => void>();
    started = false;
    destroyed = false;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      const handle = this as unknown as MockController & {
        start: () => Promise<void>;
      };
      controllers.push(handle);
    }
    on(event: string, fn: (event?: unknown) => void): () => void {
      this.listeners.set(event, fn);
      return () => undefined;
    }
    async start(): Promise<void> {
      this.started = true;
    }
    setPaused(): void {}
    async resetBuffers(): Promise<void> {}
    async destroy(): Promise<void> {
      this.destroyed = true;
    }
  }
  return { WakeWordController };
});

import { WakeWordChatBridge } from "./wakeWordChatBridge";

function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("WakeWordChatBridge arming", () => {
  beforeEach(() => {
    controllers.length = 0;
    publishWakeWordCue.mockClear();
    useWakeWordSettingsStore.setState({ selected: null, hydrated: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("does not arm while no wake word is selected", async () => {
    const onArmedChange = vi.fn();
    render(
      <WakeWordChatBridge
        speechStatus="idle"
        realtimeActive={false}
        streaming={false}
        requestStartMic={vi.fn()}
        getMicrophoneStream={async () => new MediaStream()}
        onArmedChange={onArmedChange}
      />,
    );
    await flush();
    expect(controllers).toHaveLength(0);
    expect(onArmedChange).toHaveBeenCalledWith(false);
  });

  it("arms the controller bound to the selected model", async () => {
    const onArmedChange = vi.fn();
    render(
      <WakeWordChatBridge
        speechStatus="idle"
        realtimeActive={false}
        streaming={false}
        requestStartMic={vi.fn()}
        getMicrophoneStream={async () => new MediaStream()}
        onArmedChange={onArmedChange}
      />,
    );

    act(() => {
      useWakeWordSettingsStore.getState().setSelected("hey_jarvis");
    });
    await flush();

    expect(controllers).toHaveLength(1);
    expect(controllers[0].options.wakewordModels).toEqual(["hey_jarvis"]);
    expect(controllers[0].started).toBe(true);
    expect(onArmedChange).toHaveBeenLastCalledWith(true);
  });

  it("switching models destroys the previous controller", async () => {
    render(
      <WakeWordChatBridge
        speechStatus="idle"
        realtimeActive={false}
        streaming={false}
        requestStartMic={vi.fn()}
        getMicrophoneStream={async () => new MediaStream()}
      />,
    );

    act(() => {
      useWakeWordSettingsStore.getState().setSelected("hey_jarvis");
    });
    await flush();
    act(() => {
      useWakeWordSettingsStore.getState().setSelected("alexa");
    });
    await flush();

    expect(controllers).toHaveLength(2);
    expect(controllers[0].destroyed).toBe(true);
    expect(controllers[1].options.wakewordModels).toEqual(["alexa"]);
  });

  it("publishes the cross-window relay and the same-window event on detection", async () => {
    const dispatched = vi.fn();
    window.addEventListener("liteforms:wakeword-detected", dispatched);
    render(
      <WakeWordChatBridge
        speechStatus="idle"
        realtimeActive={false}
        streaming={false}
        requestStartMic={vi.fn()}
        getMicrophoneStream={async () => new MediaStream()}
      />,
    );
    act(() => {
      useWakeWordSettingsStore.getState().setSelected("hey_jarvis");
    });
    await flush();

    act(() => {
      controllers[0].listeners.get("detected")?.({
        label: "hey_jarvis",
        score: 0.9,
        timestamp: 1,
      });
    });
    await flush();

    expect(publishWakeWordCue).toHaveBeenCalledTimes(1);
    expect(publishWakeWordCue).toHaveBeenCalledWith({
      flashColor: expect.any(String),
      blinkDurationMs: expect.any(Number),
      animationUrl: expect.any(String),
    });
    expect(dispatched).toHaveBeenCalledTimes(1);
    window.removeEventListener("liteforms:wakeword-detected", dispatched);
  });

  it("deselecting destroys the controller and disarms", async () => {
    const onArmedChange = vi.fn();
    render(
      <WakeWordChatBridge
        speechStatus="idle"
        realtimeActive={false}
        streaming={false}
        requestStartMic={vi.fn()}
        getMicrophoneStream={async () => new MediaStream()}
        onArmedChange={onArmedChange}
      />,
    );

    act(() => {
      useWakeWordSettingsStore.getState().setSelected("hey_rhasspy");
    });
    await flush();
    act(() => {
      useWakeWordSettingsStore.getState().setSelected(null);
    });
    await flush();

    expect(controllers[0].destroyed).toBe(true);
    expect(onArmedChange).toHaveBeenLastCalledWith(false);
  });
});
