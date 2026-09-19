import { TOOL_DEFINITIONS, TOOL_INSTRUCTIONS, type ToolDefinition } from "@/lib/llm/toolCatalogue";

export type OpenAiRealtimeVoiceConfig = {
  provider: "openai-realtime";
  credential?: string;
  model?: string;
  voice?: string;
  language?: string;
  instructions?: string;
  websocketUrl?: string;
  /** Output voice speed (`session.audio.output.speed`, GA). Optional:
   * absent = OpenAI default, and no `speed` is sent at all. */
  speed?: number;
};

/** Flat OpenAI Realtime tool shape, mapped from the shared tool catalogue. */
export type OpenAiRealtimeTool = {
  type: "function";
  name: string;
  description: string;
  parameters: ToolDefinition["parameters"];
};

export type OpenAiRealtimeServerEvent =
  | { type: "user_transcript"; text: string; final: boolean }
  | { type: "assistant_transcript"; text: string; final: boolean }
  | { type: "audio"; audio: string; mimeType: string }
  | { type: "speech_start" }
  | { type: "function_call"; id: string; name: string; arguments: string }
  | { type: "error"; error: string }
  | { type: "closed" };

export type OpenAiRealtimeBrowserSession = {
  start(stream?: MediaStream): void;
  stop(): void;
  isActive(): boolean;
  sendText(text: string): void;
  sendFunctionCallOutput(callId: string, output: string): void;
  createResponse(): void;
};

export type CreateOpenAiRealtimeBrowserSessionInput = {
  config: OpenAiRealtimeVoiceConfig;
  onUserTranscript?: (text: string, final: boolean) => void;
  onAssistantTranscript?: (text: string, final: boolean) => void;
  onAudio?: (audio: Blob) => void;
  onFunctionCall?: (id: string, name: string, args: string) => void;
  onError?: (error: Error) => void;
  onEnd?: () => void;
  WebSocketCtor?: typeof WebSocket;
};

export const OPENAI_REALTIME_DEFAULT_MODEL = "gpt-realtime-2";
export const OPENAI_REALTIME_DEFAULT_VOICE = "coral";
export const OPENAI_REALTIME_DEFAULT_WS_URL = "wss://api.openai.com/v1/realtime";

const OPENAI_REALTIME_ALLOWED_HOSTS = new Set(["api.openai.com"]);
const OPENAI_REALTIME_ALLOWED_PATH = "/v1/realtime";

export function normalizeOpenAiRealtimeVoiceConfig(config: OpenAiRealtimeVoiceConfig) {
  return {
    provider: "openai-realtime" as const,
    credential: config.credential ?? "",
    model: config.model ?? OPENAI_REALTIME_DEFAULT_MODEL,
    voice: config.voice ?? OPENAI_REALTIME_DEFAULT_VOICE,
    language: config.language ?? "en-US",
    instructions: config.instructions ?? "Keep spoken replies brief and natural.",
    websocketUrl: config.websocketUrl ?? OPENAI_REALTIME_DEFAULT_WS_URL,
    // Optional: only a finite number is honoured, undefined means "provider
    // default" and the session.update omits the field entirely.
    speed: Number.isFinite(config.speed) ? config.speed : undefined
  };
}

export function buildOpenAiRealtimeWebSocketUrl(config: OpenAiRealtimeVoiceConfig) {
  const normalized = normalizeOpenAiRealtimeVoiceConfig(config);
  const url = validateOpenAiRealtimeWebSocketUrl(normalized.websocketUrl);
  url.searchParams.set("model", normalized.model);
  return url.toString();
}

export function buildOpenAiRealtimeWebSocketProtocols(config: OpenAiRealtimeVoiceConfig) {
  const normalized = normalizeOpenAiRealtimeVoiceConfig(config);
  const protocols = ["realtime"];
  if (normalized.credential) protocols.push(`openai-insecure-api-key.${normalized.credential.trim()}`);
  return protocols;
}

export function validateOpenAiRealtimeWebSocketUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid OpenAI Realtime WebSocket URL");
  }
  if (url.protocol !== "wss:") throw new Error("OpenAI Realtime WebSocket URL must use wss://");
  if (!OPENAI_REALTIME_ALLOWED_HOSTS.has(url.hostname)) throw new Error("Untrusted OpenAI Realtime WebSocket host");
  if (url.username || url.password) throw new Error("OpenAI Realtime WebSocket URL must not include credentials");
  if (url.pathname !== OPENAI_REALTIME_ALLOWED_PATH) throw new Error("Untrusted OpenAI Realtime WebSocket path");
  url.search = "";
  return url;
}

/** Maps the shared catalogue to OpenAI Realtime's flat `tools` array. */
export function mapToolDefinitionsToOpenAi(definitions: ToolDefinition[]): OpenAiRealtimeTool[] {
  return definitions.map((definition) => ({
    type: "function" as const,
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters
  }));
}

export function buildOpenAiRealtimeSessionUpdateMessage(
  config: OpenAiRealtimeVoiceConfig,
  tools?: OpenAiRealtimeTool[]
) {
  const normalized = normalizeOpenAiRealtimeVoiceConfig(config);
  const language = normalized.language.split("-")[0] || normalized.language;
  return {
    type: "session.update",
    session: {
      type: "realtime",
      model: normalized.model,
      output_modalities: ["audio"],
      // Tools and their instructions are only advertised when a handler will
      // execute the calls: without one the app keeps its previous behaviour.
      instructions: tools ? `${TOOL_INSTRUCTIONS}\n\n${normalized.instructions}` : normalized.instructions,
      ...(tools ? { tools, tool_choice: "auto" } : {}),
      audio: {
        input: {
            format: { type: "audio/pcm", rate: 24000 },
          transcription: { model: "gpt-4o-transcribe", language },
          turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 800 }
        },
        output: {
          format: { type: "audio/pcm", rate: 24000 },
          voice: normalized.voice,
          // Only sent when configured: don't override the provider default.
          ...(normalized.speed !== undefined ? { speed: normalized.speed } : {})
        }
      }
    }
  };
}

export function mapOpenAiRealtimeEvent(event: unknown): OpenAiRealtimeServerEvent[] {
  const record = readRecord(event);
  if (!record) return [];
  const type = typeof record.type === "string" ? record.type : "";
  const events: OpenAiRealtimeServerEvent[] = [];

  if (type === "input_audio_buffer.speech_started") events.push({ type: "speech_start" });
  if (type === "conversation.item.input_audio_transcription.delta" && typeof record.delta === "string") {
    events.push({ type: "user_transcript", text: record.delta, final: false });
  }
  if (type === "conversation.item.input_audio_transcription.completed" && typeof record.transcript === "string") {
    events.push({ type: "user_transcript", text: record.transcript, final: true });
  }
  if ((type === "response.output_audio_transcript.delta" || type === "response.audio_transcript.delta") && typeof record.delta === "string") {
    events.push({ type: "assistant_transcript", text: record.delta, final: false });
  }
  if ((type === "response.output_audio_transcript.done" || type === "response.audio_transcript.done") && typeof record.transcript === "string") {
    events.push({ type: "assistant_transcript", text: record.transcript, final: true });
  }
  if ((type === "response.output_audio.delta" || type === "response.audio.delta") && typeof record.delta === "string") {
    events.push({ type: "audio", audio: record.delta, mimeType: "audio/pcm;rate=24000" });
  }
  if (type === "response.function_call_arguments.done") {
    if (typeof record.call_id === "string" && typeof record.name === "string") {
      events.push({
        type: "function_call",
        id: record.call_id,
        name: record.name,
        arguments: typeof record.arguments === "string" ? record.arguments : "{}"
      });
    }
  }
  if (type === "response.done") {
    const response = readRecord(record.response);
    const output = Array.isArray(response?.output) ? response.output : [];
    let hasFunctionCall = false;
    for (const item of output) {
      const entry = readRecord(item);
      if (entry?.type === "function_call" && typeof entry.call_id === "string" && typeof entry.name === "string") {
        hasFunctionCall = true;
        events.push({
          type: "function_call",
          id: entry.call_id,
          name: entry.name,
          arguments: typeof entry.arguments === "string" ? entry.arguments : "{}"
        });
      }
    }
    if (!hasFunctionCall) events.push({ type: "closed" });
  }
  if (type === "error") events.push({ type: "error", error: readError(record.error) });
  return events;
}

export function createOpenAiRealtimeBrowserSession({
  config,
  onUserTranscript,
  onAssistantTranscript,
  onAudio,
  onFunctionCall,
  onError,
  onEnd,
  WebSocketCtor = WebSocket
}: CreateOpenAiRealtimeBrowserSessionInput): OpenAiRealtimeBrowserSession {
  const normalized = normalizeOpenAiRealtimeVoiceConfig(config);
  let socket: WebSocket | null = null;
  let context: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let active = false;
  let assistantTranscript = "";
  let pendingMessages: unknown[] = [];
  let pendingFunctionCalls = 0;
  const emittedFunctionCallIds = new Set<string>();
  const tools = onFunctionCall ? mapToolDefinitionsToOpenAi(TOOL_DEFINITIONS) : undefined;

  const emitError = (caught: unknown) => {
    onError?.(caught instanceof Error ? caught : new Error("OpenAI Realtime session failed."));
  };

  const cleanupAudio = () => {
    processor?.disconnect();
    source?.disconnect();
    void context?.close?.();
    processor = null;
    source = null;
    context = null;
    active = false;
    assistantTranscript = "";
    pendingMessages = [];
    pendingFunctionCalls = 0;
    emittedFunctionCallIds.clear();
  };

  const sendJson = (message: unknown) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return;
    }
    pendingMessages.push(message);
  };

  const flushPendingMessages = () => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    for (const message of pendingMessages) {
      socket.send(JSON.stringify(message));
    }
    pendingMessages = [];
  };

  const handleMappedEvent = (mapped: OpenAiRealtimeServerEvent) => {
    if (mapped.type === "user_transcript") onUserTranscript?.(mapped.text, mapped.final);
    if (mapped.type === "assistant_transcript") {
      assistantTranscript = mapped.final ? mapped.text : assistantTranscript + mapped.text;
      onAssistantTranscript?.(assistantTranscript, mapped.final);
      if (mapped.final) assistantTranscript = "";
    }
    if (mapped.type === "audio") onAudio?.(base64PcmToWavBlob(mapped.audio, parseAudioSampleRate(mapped.mimeType)));
    if (mapped.type === "function_call") {
      // The provider can repeat the same call via both the arguments event and
      // the response output; dedupe by call id so the handler runs once.
      if (!emittedFunctionCallIds.has(mapped.id)) {
        emittedFunctionCallIds.add(mapped.id);
        pendingFunctionCalls += 1;
        onFunctionCall?.(mapped.id, mapped.name, mapped.arguments);
      }
    }
    if (mapped.type === "error") emitError(new Error(mapped.error));
    // A tool call is still being executed: don't end the session yet.
    if (mapped.type === "closed" && pendingFunctionCalls === 0) onEnd?.();
  };

  return {
    start(stream) {
      if (active) return;
      try {
        socket = new WebSocketCtor(
          buildOpenAiRealtimeWebSocketUrl(normalized),
          buildOpenAiRealtimeWebSocketProtocols(normalized)
        );
        socket.addEventListener("open", () => {
          sendJson(buildOpenAiRealtimeSessionUpdateMessage(normalized, tools));
          flushPendingMessages();
        });
        socket.addEventListener("message", (event) => {
          const handle = (text: string) => {
            try {
              const parsed = JSON.parse(text);
              for (const mapped of mapOpenAiRealtimeEvent(parsed)) handleMappedEvent(mapped);
            } catch (caught) {
              emitError(caught);
            }
          };
          if (event.data instanceof Blob) {
            event.data.text().then(handle).catch(emitError);
          } else {
            handle(String(event.data));
          }
        });
        socket.addEventListener("error", () => emitError(new Error("OpenAI Realtime WebSocket failed.")));
        socket.addEventListener("close", cleanupAudio);

        if (stream) {
          const AudioContextCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
          if (!AudioContextCtor) throw new Error("Web Audio capture is unavailable.");
          context = new AudioContextCtor();
          source = context.createMediaStreamSource(stream);
          processor = context.createScriptProcessor(4096, 1, 1);
          processor.onaudioprocess = (event) => {
            const samples = mixAndResampleInputBuffer(event.inputBuffer, 24000);
            sendJson({ type: "input_audio_buffer.append", audio: bytesToBase64(encodePcm16(samples)) });
          };
          source.connect(processor);
          processor.connect(context.destination);
        }
        active = true;
      } catch (caught) {
        cleanupAudio();
        emitError(caught);
      }
    },
    stop() {
      sendJson({ type: "input_audio_buffer.commit" });
      socket?.close();
      cleanupAudio();
    },
    isActive() {
      return active;
    },
    sendText(text) {
      const trimmed = text.trim();
      if (!trimmed) return;
      sendJson({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: trimmed }]
        }
      });
      sendJson({ type: "response.create" });
    },
    sendFunctionCallOutput(callId, output) {
      pendingFunctionCalls = Math.max(0, pendingFunctionCalls - 1);
      sendJson({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output
        }
      });
    },
    createResponse() {
      sendJson({ type: "response.create" });
    }
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function readError(value: unknown): string {
  if (typeof value === "string") return value;
  const record = readRecord(value);
  const message = record?.message;
  const code = record?.code;
  if (typeof message === "string") return message;
  if (typeof code === "string") return code;
  if (typeof code === "number") return String(code);
  return "OpenAI Realtime error";
}

function mixAndResampleInputBuffer(buffer: AudioBuffer, targetSampleRate: number) {
  const mono = new Float32Array(buffer.length);
  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const channel = buffer.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < mono.length; sampleIndex += 1) {
      mono[sampleIndex] += channel[sampleIndex] / buffer.numberOfChannels;
    }
  }
  if (buffer.sampleRate === targetSampleRate) return mono;
  const outputLength = Math.max(1, Math.round((mono.length * targetSampleRate) / buffer.sampleRate));
  const output = new Float32Array(outputLength);
  const ratio = buffer.sampleRate / targetSampleRate;
  for (let outputIndex = 0; outputIndex < output.length; outputIndex += 1) {
    const sourceIndex = outputIndex * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(left + 1, mono.length - 1);
    const weight = sourceIndex - left;
    output[outputIndex] = mono[left] * (1 - weight) + mono[right] * weight;
  }
  return output;
}

function encodePcm16(samples: Float32Array) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(input: string) {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseAudioSampleRate(mimeType: string) {
  const match = /rate=(\d+)/.exec(mimeType);
  return match ? Number.parseInt(match[1], 10) : 24000;
}

function base64PcmToWavBlob(input: string, sampleRate: number) {
  const pcm = base64ToBytes(input);
  const buffer = new ArrayBuffer(44 + pcm.byteLength);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.byteLength, true);
  new Uint8Array(buffer, 44).set(pcm);
  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}
