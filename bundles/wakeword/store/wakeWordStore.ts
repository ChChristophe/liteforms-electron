/**
 * Liteforms wake word bundle — Zustand store.
 *
 * First Zustand store in the repo; kept internal to the bundle so it does not
 * set an architectural precedent outside the feature. Exposes functional state
 * only — no audio data ever flows through here.
 */

import { create } from "zustand";
import type {
  WakeWordDetectedEvent,
  WakeWordError,
  WakeWordStatus,
} from "../types";

interface WakeWordState {
  enabled: boolean;
  status: WakeWordStatus;
  /** Latest per-frame scores keyed by label (live UI feedback). */
  lastScores: Record<string, number>;
  /** Convenience accessor for the primary label ("hey_jarvis"). */
  score: number;
  lastDetection: WakeWordDetectedEvent | null;
  error: WakeWordError | null;
}

export const useWakeWordStore = create<WakeWordState>()(() => ({
  enabled: false,
  status: "disabled",
  lastScores: {},
  score: 0,
  lastDetection: null,
  error: null,
}));

export function setWakeWordEnabled(enabled: boolean): void {
  useWakeWordStore.setState({ enabled });
}

export function setWakeWordStatus(status: WakeWordStatus): void {
  useWakeWordStore.setState({ status });
}

export function setWakeWordScores(scores: Record<string, number>): void {
  useWakeWordStore.setState({
    lastScores: scores,
    score: scores.hey_jarvis ?? 0,
  });
}

export function setWakeWordLastDetection(detection: WakeWordDetectedEvent): void {
  useWakeWordStore.setState({ lastDetection: detection });
}

export function setWakeWordError(error: WakeWordError): void {
  useWakeWordStore.setState({ error });
}
