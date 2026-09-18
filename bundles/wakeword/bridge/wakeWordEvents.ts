/**
 * Wake word bundle — DOM events (ARCHITECTURE_BUNDLE.md §4.1 pattern).
 *
 * Mirrors lib/avatar/lipSyncEvents.ts so other bundles (avatar animations,
 * future integrations) can react to wake word detections without importing
 * anything from this bundle.
 */

export const WAKE_WORD_DETECTED_EVENT = "liteforms:wakeword-detected";

import type { WakeWordDetectedEvent } from "../types";

export function dispatchWakeWordDetected(event: WakeWordDetectedEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WAKE_WORD_DETECTED_EVENT, { detail: event }),
  );
}
