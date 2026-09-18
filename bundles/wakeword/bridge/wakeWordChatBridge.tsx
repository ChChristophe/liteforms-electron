"use client";

/**
 * Wake word bundle — ChatPanel bridge (phase 2).
 *
 * Mounted ONCE inside components/chat/ChatPanel.tsx (documented derogation,
 * ARCHITECTURE_BUNDLE.md §4.4 / plan §22) because triggering the existing
 * hands-free flow requires ChatPanel-internal callbacks:
 *
 *   wake word sélectionné (Settings > Advanced, persisté)
 *     → contrôleur armé sur ce modèle
 *     → phrase détectée
 *       → dispatchWakeWordDetected()  (CustomEvent, pour les autres bundles)
 *       → si la session vocale est libre : requestStartMic()
 *         (startMicRecording de ChatPanel → STT → soumission auto → réponse)
 *
 * This component renders nothing: the selection lives in the settings store
 * (bundles/wakeword/store/wakeWordSettingsStore.ts) and the UI control in
 * components/WakeWordSettingsSelect.tsx. Audio sharing follows plan §25
 * option (a): ONE getUserMedia owned by ChatPanel, this bundle builds its own
 * AudioWorklet graph on the same MediaStream.
 */

import { useEffect, useRef } from "react";
import { WakeWordController } from "../controller/wakeWordController";
import { useWakeWordSettingsStore } from "../store/wakeWordSettingsStore";
import { isBundleEnabled } from "@/lib/core/featureFlags";
import {
  WAKE_WORD_DETECTED_EVENT,
  dispatchWakeWordDetected,
} from "./wakeWordEvents";
import { publishWakeWordCue } from "@/lib/storage/wakeWordCueTrigger";

export interface VoiceSessionGateInput {
  /** ChatPanel's SpeechStatus ("idle" | "speaking" | "listening" | ...). */
  speechStatus: string;
  /** A Gemini/OpenAI realtime voice session owns the mic. */
  realtimeActive: boolean;
  /** An LLM answer is currently streaming into the chat. */
  streaming: boolean;
}

/**
 * A detection starts a voice session only when the assistant is completely
 * idle. Any other state (listening/transcribing/speaking/testing/error,
 * streaming reply) must not be interrupted.
 *
 * Note: `realtimeActive` intentionally does NOT block the gate. It is a
 * config flag (provider type), not a session state. When a realtime voice
 * provider is configured but no session is running yet, the wake word
 * should be allowed to start one. The `speechStatus` field already covers
 * the "session is running" case ("listening" while active).
 */
export function shouldTriggerVoiceSession(
  input: VoiceSessionGateInput,
): boolean {
  return (
    input.speechStatus === "idle" &&
    !input.streaming
  );
}

export type WakeWordChatBridgeProps = VoiceSessionGateInput & {
  /**
   * Starts ChatPanel's STT flow. The bridge always passes
   * `forceSentenceAutoSubmit` so the triggered session behaves like mic mode
   * "auto" (RMS pause detection ends the sentence -> auto submit), regardless
   * of the user's selected manual mic mode.
   */
  requestStartMic: (options?: { forceSentenceAutoSubmit?: boolean }) => void;
  getMicrophoneStream: () => Promise<MediaStream>;
  /** Notifies ChatPanel when the wake word takes over the microphone. */
  onArmedChange?: (armed: boolean) => void;
};

export function WakeWordChatBridge(props: WakeWordChatBridgeProps) {
  const enabled = isBundleEnabled("wakeword");
  const selected = useWakeWordSettingsStore((s) => s.selected);
  const hydrate = useWakeWordSettingsStore((s) => s.hydrate);
  const { requestStartMic, getMicrophoneStream, onArmedChange } = props;

  // Restore the persisted selection on first mount so a page reload re-arms
  // the previously chosen wake word without touching the settings panel.
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Latest gate inputs / callbacks without re-binding the controller on
  // every render (the effect below intentionally depends only on [armed,
  // selected]).
  const gateRef = useRef<VoiceSessionGateInput>({
    speechStatus: props.speechStatus,
    realtimeActive: props.realtimeActive,
    streaming: props.streaming,
  });
  gateRef.current = {
    speechStatus: props.speechStatus,
    realtimeActive: props.realtimeActive,
    streaming: props.streaming,
  };
  const micProviderRef = useRef(getMicrophoneStream);
  micProviderRef.current = getMicrophoneStream;
  const requestStartMicRef = useRef(requestStartMic);
  requestStartMicRef.current = requestStartMic;
  const onArmedChangeRef = useRef(onArmedChange);
  onArmedChangeRef.current = onArmedChange;

  const armed = enabled && selected !== null;

  // Wake word armed = exclusive voice mode: tell ChatPanel to disable the
  // manual mic controls while a wake word is selected.
  useEffect(() => {
    onArmedChangeRef.current?.(armed);
    return () => onArmedChangeRef.current?.(false);
  }, [armed]);

  const controllerRef = useRef<WakeWordController | null>(null);

  // While a voice session owns the airtime (ASR listening/transcribing,
  // TTS speaking, LLM streaming), pause wake-word processing entirely: no
  // detections from TTS echo or captured speech, no wasted inference.
  // On return to idle, reset streaming buffers so stale audio cannot
  // trigger a spurious detection.
  const busy = !shouldTriggerVoiceSession({
    speechStatus: props.speechStatus,
    realtimeActive: props.realtimeActive,
    streaming: props.streaming,
  });
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setPaused(busy);
    if (!busy) void controller.resetBuffers();
  }, [busy]);

  useEffect(() => {
    if (!armed || selected === null) return;

    let disposed = false;
    let controller: WakeWordController | null = null;

    void (async () => {
      controller = new WakeWordController({
        streamProvider: () => micProviderRef.current(),
        wakewordModels: [selected],
      });
      controller.on("detected", (event) => {
        const { cueFlashColor, cueBlinkDurationMs, cueAnimationUrl } =
          useWakeWordSettingsStore.getState();
        const cue = {
          flashColor: cueFlashColor,
          blinkDurationMs: cueBlinkDurationMs,
          animationUrl: cueAnimationUrl,
        };
        dispatchWakeWordDetected({ ...event, cue });
        // Cross-window relay: while the hologram is active the main window's
        // AvatarScene is UNMOUNTED (app/page.tsx), so the cue must be published
        // by the bridge (always mounted) for the /hologram window to replay it.
        publishWakeWordCue(cue);
        if (shouldTriggerVoiceSession(gateRef.current)) {
          requestStartMicRef.current({ forceSentenceAutoSubmit: true });
        }
      });
      await controller.start();
      controller.setPaused(
        !shouldTriggerVoiceSession(gateRef.current),
      );
      if (disposed) {
        void controller.destroy();
        return;
      }
      controllerRef.current = controller;
    })();

    return () => {
      disposed = true;
      controllerRef.current = null;
      void controller?.destroy();
    };
  }, [armed, selected]);

  return null;
}

export { WAKE_WORD_DETECTED_EVENT };
