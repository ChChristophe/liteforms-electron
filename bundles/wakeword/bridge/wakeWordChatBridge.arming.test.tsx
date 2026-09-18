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

const { controllers } = vi.hoisted(() => ({
  controllers: [] as Array<MockController & { start: () => Promise<void> }>,
}));

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
