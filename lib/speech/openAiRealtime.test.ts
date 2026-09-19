import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildOpenAiRealtimeSessionUpdateMessage,
  buildOpenAiRealtimeWebSocketProtocols,
  buildOpenAiRealtimeWebSocketUrl,
  createOpenAiRealtimeBrowserSession,
  mapOpenAiRealtimeEvent,
  normalizeOpenAiRealtimeVoiceConfig,
  validateOpenAiRealtimeWebSocketUrl
} from "./openAiRealtime";

class MockWebSocket {
  static latest: MockWebSocket | null = null;
  static OPEN = 1;

  readyState = MockWebSocket.OPEN;
  sent: string[] = [];
  handlers: Record<string, Array<(event: unknown) => void>> = {};

  constructor() {
    MockWebSocket.latest = this;
  }

  addEventListener(type: string, handler: (event: unknown) => void) {
    (this.handlers[type] ??= []).push(handler);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.handlers.close?.forEach((handler) => handler({}));
  }

  emit(type: string, event: unknown = {}) {
    this.handlers[type]?.forEach((handler) => handler(event));
  }
}

const realtimeConfig = {
  provider: "openai-realtime" as const,
  credential: "sk-test",
  instructions: "PERSONA"
};

function startOpenAiSession(input: { onFunctionCall?: (id: string, name: string, args: string) => void; onEnd?: () => void }) {
  const session = createOpenAiRealtimeBrowserSession({
    config: realtimeConfig,
    ...input,
    WebSocketCtor: MockWebSocket as unknown as typeof WebSocket
  });
  session.start();
  MockWebSocket.latest!.emit("open");
  return session;
}

describe("OpenAI Realtime voice", () => {
  it("normalizes OpenAI as an end-to-end realtime voice capability", () => {
    expect(normalizeOpenAiRealtimeVoiceConfig({ provider: "openai-realtime", credential: "sk-test" })).toMatchObject({
      provider: "openai-realtime",
      model: "gpt-realtime-2",
      voice: "coral",
      language: "en-US",
      websocketUrl: "wss://api.openai.com/v1/realtime"
    });
  });

  it("builds a GA realtime session.update message for audio in and audio out", () => {
    expect(
      buildOpenAiRealtimeSessionUpdateMessage({
        provider: "openai-realtime",
        model: "gpt-realtime-2",
        voice: "marin",
        instructions: "Keep replies brief."
      })
    ).toMatchObject({
      type: "session.update",
      session: {
        type: "realtime",
        model: "gpt-realtime-2",
        output_modalities: ["audio"],
        instructions: "Keep replies brief.",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: { model: "gpt-4o-transcribe", language: "en" },
            turn_detection: { type: "server_vad" }
          },
          output: {
            format: { type: "audio/pcm", rate: 24000 },
            voice: "marin"
          }
        }
      }
    });
  });

  it("sends audio.output.speed only when a speed is configured", () => {
    const withSpeed = buildOpenAiRealtimeSessionUpdateMessage({
      provider: "openai-realtime",
      speed: 1.25
    });
    expect(withSpeed.session.audio.output.speed).toBe(1.25);

    const without = buildOpenAiRealtimeSessionUpdateMessage({ provider: "openai-realtime" });
    expect(without.session.audio.output).not.toHaveProperty("speed");
    expect(without.session.audio.output.voice).toBe("coral");
  });

  it("uses the browser WebSocket subprotocol auth shape documented by OpenAI", () => {
    expect(buildOpenAiRealtimeWebSocketUrl({ provider: "openai-realtime", model: "gpt-realtime-2" })).toBe(
      "wss://api.openai.com/v1/realtime?model=gpt-realtime-2"
    );
    expect(buildOpenAiRealtimeWebSocketProtocols({ provider: "openai-realtime", credential: "sk-test" })).toEqual([
      "realtime",
      "openai-insecure-api-key.sk-test"
    ]);
  });

  it("allows only trusted OpenAI Realtime WebSocket endpoints", () => {
    expect(() => validateOpenAiRealtimeWebSocketUrl("wss://attacker.test/v1/realtime")).toThrow("Untrusted OpenAI Realtime WebSocket host");
    expect(() => validateOpenAiRealtimeWebSocketUrl("https://api.openai.com/v1/realtime")).toThrow(
      "OpenAI Realtime WebSocket URL must use wss://"
    );
  });

  it("maps transcripts, audio, speech start, and errors from GA and compatibility event names", () => {
    expect(mapOpenAiRealtimeEvent({ type: "input_audio_buffer.speech_started" })).toEqual([{ type: "speech_start" }]);
    expect(mapOpenAiRealtimeEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "hello" })).toEqual([
      { type: "user_transcript", text: "hello", final: true }
    ]);
    expect(mapOpenAiRealtimeEvent({ type: "response.output_audio_transcript.delta", delta: "hi" })).toEqual([
      { type: "assistant_transcript", text: "hi", final: false }
    ]);
    expect(mapOpenAiRealtimeEvent({ type: "response.output_audio.delta", delta: "AAAA" })).toEqual([
      { type: "audio", audio: "AAAA", mimeType: "audio/pcm;rate=24000" }
    ]);
    expect(mapOpenAiRealtimeEvent({ type: "response.audio.delta", delta: "BBBB" })).toEqual([
      { type: "audio", audio: "BBBB", mimeType: "audio/pcm;rate=24000" }
    ]);
    expect(mapOpenAiRealtimeEvent({ type: "error", error: { message: "bad request" } })).toEqual([{ type: "error", error: "bad request" }]);
  });
});

describe("OpenAI Realtime function calling", () => {
  beforeEach(() => {
    MockWebSocket.latest = null;
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not advertise tools or tool instructions without a function handler", () => {
    startOpenAiSession({});
    const update = JSON.parse(MockWebSocket.latest!.sent[0]);
    expect(update.session.tools).toBeUndefined();
    expect(update.session.tool_choice).toBeUndefined();
    expect(update.session.instructions).toBe("PERSONA");
  });

  it("maps the shared catalogue to the flat OpenAI format when a handler is provided", () => {
    startOpenAiSession({ onFunctionCall: vi.fn() });
    const update = JSON.parse(MockWebSocket.latest!.sent[0]);
    expect(update.session.tool_choice).toBe("auto");
    expect(update.session.tools).toHaveLength(8);
    expect(update.session.tools[0]).toEqual({
      type: "function",
      name: "get_current_time",
      description: expect.any(String),
      parameters: { type: "object", properties: {}, required: [] }
    });
    expect(update.session.tools.map((tool: { name: string }) => tool.name)).toContain("openclaw_web_search");
    expect(update.session.instructions).toContain("If you are unsure whether to use a tool, USE IT");
    expect(update.session.instructions).toContain("PERSONA");
  });

  it("raises a provider function call once even when the response output repeats it", () => {
    const onFunctionCall = vi.fn();
    startOpenAiSession({ onFunctionCall });
    MockWebSocket.latest!.emit("message", {
      data: JSON.stringify({
        type: "response.function_call_arguments.done",
        call_id: "call_1",
        name: "get_current_time",
        arguments: "{}"
      })
    });
    MockWebSocket.latest!.emit("message", {
      data: JSON.stringify({
        type: "response.done",
        response: { output: [{ type: "function_call", call_id: "call_1", name: "get_current_time", arguments: "{}" }] }
      })
    });
    expect(onFunctionCall).toHaveBeenCalledTimes(1);
    expect(onFunctionCall).toHaveBeenCalledWith("call_1", "get_current_time", "{}");
  });

  it("sends the function_call_output then response.create payloads", () => {
    const session = startOpenAiSession({ onFunctionCall: vi.fn() });
    MockWebSocket.latest!.sent.length = 0;
    session.sendFunctionCallOutput("call_1", "Il est 10:00.");
    session.createResponse();
    expect(JSON.parse(MockWebSocket.latest!.sent[0])).toEqual({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: "call_1", output: "Il est 10:00." }
    });
    expect(JSON.parse(MockWebSocket.latest!.sent[1])).toEqual({ type: "response.create" });
  });

  it("does not end the session while a function call is being executed", () => {
    const onEnd = vi.fn();
    const session = startOpenAiSession({ onFunctionCall: vi.fn(), onEnd });
    MockWebSocket.latest!.emit("message", {
      data: JSON.stringify({
        type: "response.function_call_arguments.done",
        call_id: "call_1",
        name: "get_current_time",
        arguments: "{}"
      })
    });
    MockWebSocket.latest!.emit("message", { data: JSON.stringify({ type: "response.done", response: { output: [] } }) });
    expect(onEnd).not.toHaveBeenCalled();

    session.sendFunctionCallOutput("call_1", "ok");
    MockWebSocket.latest!.emit("message", { data: JSON.stringify({ type: "response.done", response: { output: [] } }) });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
