import { logDiagnostic } from "@/lib/avatar/diagnosticLog";
import type { RmsLipSyncFrame, VisemeFrame } from "@/lib/speech";

export const avatarLipSyncEventName = "liteforms:avatar-lip-sync";

export type AvatarLipSyncFrame = VisemeFrame | RmsLipSyncFrame;

let dispatchLogCounter = 0;

export function dispatchAvatarLipSyncFrame(frame: AvatarLipSyncFrame, target: Window = window) {
  dispatchLogCounter++;
  if (dispatchLogCounter === 1 || dispatchLogCounter % 50 === 0) {
    logDiagnostic(`lipsync dispatch total=${dispatchLogCounter} firstWeight=${frame.weight.toFixed(3)}`);
  }
  target.dispatchEvent(new CustomEvent<AvatarLipSyncFrame>(avatarLipSyncEventName, { detail: frame }));
}
