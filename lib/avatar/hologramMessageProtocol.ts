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

export type MainToHologramMessage =
  | { origin: typeof hologramMessageOrigin; kind: "lipsync"; frame: AvatarLipSyncFrame }
  | { origin: typeof hologramMessageOrigin; kind: "model-url"; url: string }
  | { origin: typeof hologramMessageOrigin; kind: "model-bytes"; bytes: ArrayBuffer }
  | { origin: typeof hologramMessageOrigin; kind: "enter-session" }
  | { origin: typeof hologramMessageOrigin; kind: "exit-session" };

export function postHologramMessage(target: Window, message: MainToHologramMessage | HologramToMainMessage) {
  target.postMessage(message, "*");
}

export function sendLipsyncToHologram(target: Window, frame: AvatarLipSyncFrame) {
  postHologramMessage(target, { origin: hologramMessageOrigin, kind: "lipsync", frame });
}

export function sendModelUrlToHologram(target: Window, url: string) {
  postHologramMessage(target, { origin: hologramMessageOrigin, kind: "model-url", url });
}

export function sendHologramCommand(target: Window, command: "enter-session" | "exit-session") {
  postHologramMessage(target, { origin: hologramMessageOrigin, kind: command });
}

export async function sendModelBytesToHologram(target: Window, bytes: ArrayBuffer) {
  target.postMessage({ origin: hologramMessageOrigin, kind: "model-bytes", bytes }, "*", [bytes]);
}