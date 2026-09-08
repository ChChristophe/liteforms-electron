import type { AvatarLipSyncFrame } from "@/lib/avatar/lipSyncEvents";

export const hologramWindowName = "liteforms-hld-hologram";
export const hologramRoutePath = "/hologram";

export const hologramMessageOrigin = "liteforms:hologram";

export function isHologramWindow(): boolean {
  if (typeof window === "undefined") return false;
  if (window.name === hologramWindowName) return true;
  try {
    return window.location.pathname === hologramRoutePath;
  } catch {
    return false;
  }
}

export function buildHologramRouteUrl(baseOrigin: string, modelUrl?: string): string {
  const url = new URL(hologramRoutePath, baseOrigin);
  if (modelUrl) url.searchParams.set("model", modelUrl);
  return url.toString();
}

export type HologramToMainMessage =
  | { origin: typeof hologramMessageOrigin; kind: "session-started" }
  | { origin: typeof hologramMessageOrigin; kind: "session-ended" }
  | { origin: typeof hologramMessageOrigin; kind: "ready" };

export type HologramUtterancePayload = {
  mimeType: string;
  sampleRate?: number;
  words?: Array<{ word: string; start: number; end: number }>;
  lipSyncGain?: number;
  lipSyncMaxWeight?: number;
  lipSyncPreferMorphTarget?: boolean;
};

export type MainToHologramMessage =
  | { origin: typeof hologramMessageOrigin; kind: "lipsync"; frame: AvatarLipSyncFrame }
  | { origin: typeof hologramMessageOrigin; kind: "model-url"; url: string }
  | { origin: typeof hologramMessageOrigin; kind: "model-bytes"; bytes: ArrayBuffer }
  | { origin: typeof hologramMessageOrigin; kind: "enter-session" }
  | { origin: typeof hologramMessageOrigin; kind: "exit-session" }
  | { origin: typeof hologramMessageOrigin; kind: "utter-bytes"; utt: HologramUtterancePayload; bytes: ArrayBuffer }
  | { origin: typeof hologramMessageOrigin; kind: "live-audio"; bytes: ArrayBuffer };

export function postHologramMessage(
  target: Window,
  message: MainToHologramMessage | HologramToMainMessage,
  targetOrigin: string,
  transfer?: Transferable[],
) {
  target.postMessage(message, targetOrigin, transfer ?? []);
}

export function sendLipsyncToHologram(target: Window, frame: AvatarLipSyncFrame, targetOrigin: string) {
  postHologramMessage(target, { origin: hologramMessageOrigin, kind: "lipsync", frame }, targetOrigin);
}

export function sendModelUrlToHologram(target: Window, url: string, targetOrigin: string) {
  postHologramMessage(target, { origin: hologramMessageOrigin, kind: "model-url", url }, targetOrigin);
}

export function sendHologramCommand(target: Window, command: "enter-session" | "exit-session", targetOrigin: string) {
  postHologramMessage(target, { origin: hologramMessageOrigin, kind: command }, targetOrigin);
}

export function sendModelBytesToHologram(target: Window, bytes: ArrayBuffer, targetOrigin: string) {
  postHologramMessage(
    target,
    { origin: hologramMessageOrigin, kind: "model-bytes", bytes },
    targetOrigin,
    [bytes],
  );
}

export function sendUtteranceToHologram(
  target: Window,
  result: { audio: ArrayBuffer; sampleRate?: number; mimeType: string; lipSyncGain?: number; lipSyncMaxWeight?: number; lipSyncPreferMorphTarget?: boolean; words?: Array<{ word: string; start: number; end: number }> },
  targetOrigin: string,
) {
  const { audio, sampleRate, mimeType, lipSyncGain, lipSyncMaxWeight, lipSyncPreferMorphTarget, words } = result;
  const utt: HologramUtterancePayload = {
    mimeType,
    sampleRate,
    words,
    lipSyncGain,
    lipSyncMaxWeight,
    lipSyncPreferMorphTarget,
  };
  postHologramMessage(target, { origin: hologramMessageOrigin, kind: "utter-bytes", utt, bytes: audio }, targetOrigin, [audio]);
}

export function sendLiveAudioToHologram(target: Window, bytes: ArrayBuffer, targetOrigin: string) {
  postHologramMessage(target, { origin: hologramMessageOrigin, kind: "live-audio", bytes }, targetOrigin, [bytes]);
}
