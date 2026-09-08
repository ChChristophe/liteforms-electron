import type { LookingGlassDisplayBounds } from "@/lib/avatar/bridgeConnection";

export type HologramAutoOpenCurrent = {
  hasElectronApi: boolean;
  connected: boolean | undefined;
  display?: LookingGlassDisplayBounds;
  hologramActive: boolean;
};

export type HologramAutoOpenPrevious = {
  connected?: boolean;
  displayKey: string;
};

export type HologramAutoOpenDecision = "open" | "reopen" | "none";

export function displayKey(display?: LookingGlassDisplayBounds): string {
  return display ? `${display.left}:${display.top}:${display.width}:${display.height}` : "";
}

export function resolveHologramAutoOpen(
  current: HologramAutoOpenCurrent,
  previous: HologramAutoOpenPrevious,
): HologramAutoOpenDecision {
  if (!current.hasElectronApi || current.connected !== true || !current.display) return "none";
  if (previous.connected === true && previous.displayKey === displayKey(current.display)) return "none";
  return current.hologramActive ? "reopen" : "open";
}
