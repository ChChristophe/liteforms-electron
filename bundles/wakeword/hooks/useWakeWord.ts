"use client";

/**
 * Liteforms wake word bundle — React hook.
 *
 * Creates one WakeWordController per mounted consumer, wires controller events
 * into the Zustand store, and tears everything down on unmount (StrictMode
 * safe: the controller's init token guards double-invoked effects).
 */

import { useCallback, useEffect, useRef } from "react";
import { WakeWordController } from "../controller/wakeWordController";
import {
  setWakeWordEnabled,
  setWakeWordError,
  setWakeWordLastDetection,
  setWakeWordScores,
  setWakeWordStatus,
  useWakeWordStore,
} from "../store/wakeWordStore";
import type {
  WakeWordControllerOptions,
  WakeWordDetectedEvent,
  WakeWordError,
} from "../types";

export interface UseWakeWordResult {
  status: ReturnType<typeof useWakeWordStore.getState>["status"];
  score: number;
  lastDetection: WakeWordDetectedEvent | null;
  error: WakeWordError | null;
  start: () => void;
  stop: () => void;
  /** Live-update the detection threshold (clamped to [0, 1]). */
  setThreshold: (threshold: number) => void;
}

/**
 * Mount the wake word pipeline. Pass `autoStart: true` to begin listening as
 * soon as the engine and microphone are ready (mic permission is requested on
 * first user gesture only if you call `start()` from an event handler).
 */
export function useWakeWord(
  options: WakeWordControllerOptions & { autoStart?: boolean } = {},
): UseWakeWordResult {
  const { autoStart = false, ...controllerOptions } = options;
  const controllerRef = useRef<WakeWordController | null>(null);
  // Keep latest options without re-creating the controller on every render.
  const optionsRef = useRef(controllerOptions);
  optionsRef.current = controllerOptions;

  const status = useWakeWordStore((s) => s.status);
  const score = useWakeWordStore((s) => s.score);
  const lastDetection = useWakeWordStore((s) => s.lastDetection);
  const error = useWakeWordStore((s) => s.error);

  useEffect(() => {
    setWakeWordEnabled(true);
    const controller = new WakeWordController(optionsRef.current);
    controllerRef.current = controller;

    const offs = [
      controller.on("status", setWakeWordStatus),
      controller.on("scores", (e) => setWakeWordScores(e.scores)),
      controller.on("detected", setWakeWordLastDetection),
      controller.on("error", setWakeWordError),
    ];

    if (autoStart) void controller.start();

    return () => {
      for (const off of offs) off();
      void controller.destroy();
      controllerRef.current = null;
      setWakeWordEnabled(false);
      setWakeWordStatus("disabled");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(() => {
    void controllerRef.current?.start();
  }, []);

  const stop = useCallback(() => {
    void controllerRef.current?.stop();
  }, []);

  const setThreshold = useCallback((threshold: number) => {
    controllerRef.current?.setThreshold(threshold);
  }, []);

  return { status, score, lastDetection, error, start, stop, setThreshold };
}
