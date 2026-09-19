import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildGoogleLiveSetupMessage,
  buildGoogleLiveWebSocketUrl,
  createGoogleLiveBrowserSession,
  mapGoogleLiveEvent,
  normalizeGoogleLiveVoiceConfig,
  validateGoogleLiveWebSocketUrl
} from "./googleLive";
import { STT_PROVIDER_OPTIONS } from "./providerOptions";

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

const googleConfig = {
  provider: "google-live" as const,
  credential: "AIza-test",
  instructions: "PERSONA"
};

function startGoogleSession(input: { onFunctionCall?: (id: string, name: string, args: string) => void; onEnd?: () => void }) {
  const session = createGoogleLiveBrowserSession({
    config: googleConfig,
    ...input,
    WebSocketCtor: MockWebSocket as unknown as typeof WebSocket
  });
  session.start();
  MockWebSocket.latest!.emit("open");
  return session;
}

describe("Google Live realtime voice parity", () => {
  it("normalizes Google Live as a realtime voice capability", () => {
    expect(normalizeGoogleLiveVoiceConfig({ provider: "google-live", credential: "token" })).toMatchObject({
      provider: "google-live",
      model: "gemini-2.5-flash-native-audio-preview-12-2025",
      voice: "Kore",
      language: "en-US"
    });
    expect(buildGoogleLiveSetupMessage({ provider: "google-live", model: "gemini-live", voice: "Aoede" })).toMatchObject({
      setup: {
        model: "models/gemini-live",
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Aoede" }
            }
          }
        }
      }
    });
  });

  it("omits explicit language code for native audio models", () => {
    const setup = buildGoogleLiveSetupMessage({
      provider: "google-live",
      model: "gemini-2.5-flash-native-audio-preview-12-2025",
      voice: "Kore",
      language: "en-US"
    });
    expect(setup.setup.generationConfig.speechConfig).not.toHaveProperty("languageCode");
  });

  it("allows only trusted Google Live WebSocket endpoints and appends the browser token", () => {
    expect(
      buildGoogleLiveWebSocketUrl({
        provider: "google-live",
        ephemeralToken: "auth_tokens/browser-session",
        websocketUrl:
          "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?ignored=1"
      })
    ).toBe(
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=auth_tokens%2Fbrowser-session"
    );
    expect(() =>
      validateGoogleLiveWebSocketUrl("wss://attacker.test/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained")
    ).toThrow("Untrusted Google Live WebSocket host");
    expect(() => validateGoogleLiveWebSocketUrl("https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained")).toThrow(
      "Google Live WebSocket URL must use wss://"
    );
  });

  it("uses key auth for AI Studio API keys and access_token auth for browser session tokens", () => {
    expect(buildGoogleLiveWebSocketUrl({ provider: "google-live", credential: "AIza-test" })).toContain("?key=AIza-test");
    expect(buildGoogleLiveWebSocketUrl({ provider: "google-live", credential: "auth_tokens/session" })).toContain(
      "?access_token=auth_tokens%2Fsession"
    );
  });

  it("maps user transcript, assistant transcript, and audio events separately", () => {
    expect(
      mapGoogleLiveEvent({
        serverContent: {
          inputTranscription: { text: "hello" },
          outputTranscription: { text: "hi" },
          modelTurn: { parts: [{ inlineData: { data: "AAAA", mimeType: "audio/pcm" } }] },
          turnComplete: true
        }
      })
    ).toEqual([
      { type: "user_transcript", text: "hello", final: true },
      { type: "assistant_transcript", text: "hi", final: true },
      { type: "audio", audio: "AAAA", mimeType: "audio/pcm" },
      { type: "closed" }
    ]);
  });

  it("passes character persona instructions into the setup message", () => {
    const instructions = "You are Mira, a Liteforms avatar companion.\nPronouns: SHE.\nPersonality and behavior: Warm and encouraging.";
    const setup = buildGoogleLiveSetupMessage({ provider: "google-live", instructions });
    expect(setup.setup.systemInstruction.parts[0].text).toBe(instructions);
  });

  it("falls back to the default instructions when none are provided", () => {
    const setup = buildGoogleLiveSetupMessage({ provider: "google-live" });
    expect(setup.setup.systemInstruction.parts[0].text).toBe("Keep spoken replies brief and natural.");
  });

  it("does not register Google Live as an STT-only streaming provider", () => {
    expect(STT_PROVIDER_OPTIONS.map((option) => option.id)).not.toContain("google");
    expect(STT_PROVIDER_OPTIONS.map((option) => option.id)).not.toContain("google-live");
  });
});

describe("Google Live function calling", () => {
  beforeEach(() => {
    MockWebSocket.latest = null;
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not advertise tools or tool instructions without a function handler", () => {
    startGoogleSession({});
    const setup = JSON.parse(MockWebSocket.latest!.sent[0]);
    expect(setup.setup.tools).toBeUndefined();
    expect(setup.setup.systemInstruction.parts[0].text).toBe("PERSONA");
  });

  it("maps the shared catalogue to functionDeclarations when a handler is provided", () => {
    startGoogleSession({ onFunctionCall: vi.fn() });
    const setup = JSON.parse(MockWebSocket.latest!.sent[0]);
    const declarations = setup.setup.tools[0].functionDeclarations;
    expect(setup.setup.tools).toHaveLength(1);
    expect(declarations).toHaveLength(8);
    expect(declarations[0]).toEqual({
      name: "get_current_time",
      description: expect.any(String),
      parameters: { type: "OBJECT", properties: {}, required: [] }
    });
    expect(declarations.map((declaration: { name: string }) => declaration.name)).toContain("openclaw_web_search");
    expect(setup.setup.systemInstruction.parts[0].text).toContain("If you are unsure whether to use a tool, USE IT");
    expect(setup.setup.systemInstruction.parts[0].text).toContain("PERSONA");
  });

  it("uses the function name as the call id and raises it once", () => {
    const onFunctionCall = vi.fn();
    startGoogleSession({ onFunctionCall });
    MockWebSocket.latest!.emit("message", {
      data: JSON.stringify({
        serverContent: {
          modelTurn: { parts: [{ functionCall: { name: "get_current_time", args: {} } }] },
          turnComplete: true
        }
      })
    });
    expect(onFunctionCall).toHaveBeenCalledTimes(1);
    expect(onFunctionCall).toHaveBeenCalledWith("get_current_time", "get_current_time", "{}");
  });

  it("sends the functionResponse then turnComplete payloads after setup", () => {
    const session = startGoogleSession({ onFunctionCall: vi.fn() });
    MockWebSocket.latest!.emit("message", { data: JSON.stringify({ setupComplete: true }) });
    MockWebSocket.latest!.sent.length = 0;
    session.sendFunctionCallOutput("get_current_time", "Il est 10:00.");
    session.createResponse();
    expect(JSON.parse(MockWebSocket.latest!.sent[0])).toEqual({
      clientContent: {
        turns: [
          {
            role: "function",
            parts: [{ functionResponse: { name: "get_current_time", response: { result: "Il est 10:00." } } }]
          }
        ],
        turnComplete: true
      }
    });
    expect(JSON.parse(MockWebSocket.latest!.sent[1])).toEqual({ clientContent: { turnComplete: true } });
  });
});
