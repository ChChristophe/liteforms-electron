"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { logDiagnostic } from "@/lib/avatar/diagnosticLog";
import { openHldHologramWindow, type ScreenLike } from "@/lib/avatar/hologramWindow";
import {
  buildHologramRouteUrl,
  hologramMessageOrigin,
  postHologramMessage,
  type MainToHologramMessage,
} from "@/lib/avatar/hologramMessageProtocol";
import type { TtsResult } from "@/lib/speech";
import { avatarLipSyncEventName, type AvatarLipSyncFrame } from "@/lib/avatar/lipSyncEvents";

async function resolveShareableModel(modelUrl: string | undefined): Promise<
  { url: string } | { bytes: ArrayBuffer } | undefined
> {
  if (!modelUrl) return undefined;
  if (!modelUrl.startsWith("blob:")) return { url: modelUrl };
  try {
    const response = await fetch(modelUrl);
    const bytes = await response.arrayBuffer();
    return { bytes };
  } catch {
    return undefined;
  }
}

export function useHologramBridge() {
  const [hologramActive, setHologramActive] = useState(false);
  const holoWinRef = useRef<Window | null>(null);
  const relayRef = useRef<((event: Event) => void) | null>(null);
  const closePollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const forwardedCountRef = useRef(0);
  const readyRef = useRef(false);
  const targetOriginRef = useRef<string | null>(null);
  const pendingMessagesRef = useRef<MainToHologramMessage[]>([]);
  const readyListenerRef = useRef<((event: MessageEvent) => void) | null>(null);
  const openingRef = useRef(false);

  const sendPendingMessage = useCallback((win: Window, message: MainToHologramMessage, targetOrigin: string) => {
    const transfer = "bytes" in message ? [message.bytes] : undefined;
    postHologramMessage(win, message, targetOrigin, transfer);
  }, []);

  const sendMessage = useCallback((win: Window, message: MainToHologramMessage): boolean => {
    const targetOrigin = targetOriginRef.current;
    if (!targetOrigin || win.closed) return false;

    if (!readyRef.current) {
      if (message.kind === "lipsync") {
        pendingMessagesRef.current = pendingMessagesRef.current.filter(({ kind }) => kind !== "lipsync");
      } else if (pendingMessagesRef.current.length >= 64) {
        logDiagnostic(`holo-bridge message dropped kind=${message.kind} reason=queue-full`);
        return false;
      } else {
        // A queued (not sent) message is otherwise invisible in diagnostics.
        logDiagnostic(`holo-bridge message queued kind=${message.kind} pending=${pendingMessagesRef.current.length + 1}`);
      }
      pendingMessagesRef.current.push(message);
      return true;
    }

    try {
      sendPendingMessage(win, message, targetOrigin);
      return true;
    } catch {
      return false;
    }
  }, [sendPendingMessage]);

  const resetTransport = useCallback(() => {
    if (readyListenerRef.current) {
      window.removeEventListener("message", readyListenerRef.current);
      readyListenerRef.current = null;
    }
    readyRef.current = false;
    targetOriginRef.current = null;
    pendingMessagesRef.current = [];
  }, []);

  const stopClosePoller = useCallback(() => {
    if (closePollerRef.current !== null) {
      clearInterval(closePollerRef.current);
      closePollerRef.current = null;
    }
  }, []);

  const startRelay = useCallback((win: Window) => {
    forwardedCountRef.current = 0;
    const onFrame = (event: Event) => {
      const frame = (event as CustomEvent<AvatarLipSyncFrame>).detail;
      forwardedCountRef.current++;
      if (forwardedCountRef.current === 1 || forwardedCountRef.current % 50 === 0) {
        logDiagnostic(`holo-bridge relay forward total=${forwardedCountRef.current} firstWeight=${frame.weight.toFixed(3)}`);
      }
      sendMessage(win, { origin: hologramMessageOrigin, kind: "lipsync", frame });
    };
    window.addEventListener(avatarLipSyncEventName, onFrame);
    relayRef.current = onFrame;
    logDiagnostic(`holo-bridge relay start name=${win.name}`);
  }, [sendMessage]);

  const stopRelay = useCallback(() => {
    if (relayRef.current) {
      window.removeEventListener(avatarLipSyncEventName, relayRef.current);
      relayRef.current = null;
      logDiagnostic("holo-bridge relay stop");
    }
  }, []);

  const close = useCallback(() => {
    const win = holoWinRef.current;
    holoWinRef.current = null;
    stopClosePoller();
    stopRelay();
    resetTransport();
    setHologramActive(false);
    if (win && !win.closed) {
      logDiagnostic(`holo-bridge window close requested name=${win.name}`);
      win.close();
      // Electron closes the child asynchronously; verify so a silently
      // surviving hologram window (black Looking Glass candidate) is visible
      // in the diagnostic log instead of assumed.
      window.setTimeout(() => {
        logDiagnostic(win.closed
          ? "holo-bridge window close confirmed"
          : "holo-bridge window close NOT confirmed");
      }, 500);
    }
  }, [resetTransport, stopRelay, stopClosePoller]);

  const open = useCallback(async (modelUrl: string | undefined, targetScreen?: ScreenLike) => {
    if (holoWinRef.current && !holoWinRef.current.closed) return;
    if (openingRef.current) return;
    stopClosePoller();

    // open() awaits before assigning holoWinRef; without this in-flight guard
    // two concurrent calls (e.g. rapid reopen) both pass the check above and
    // create duplicate hologram windows / duplicate relay listeners.
    openingRef.current = true;
    let popup: Window | null = null;
    let url = "";
    let shareable: Awaited<ReturnType<typeof resolveShareableModel>>;
    try {
      shareable = await resolveShareableModel(modelUrl);
      const base = window.location.origin;
      const shareUrl = shareable && "url" in shareable ? shareable.url : undefined;
      url = buildHologramRouteUrl(base, shareUrl);
      popup = await openHldHologramWindow(window, url, targetScreen);
    } finally {
      openingRef.current = false;
    }
    if (!popup) return;

    holoWinRef.current = popup;
    targetOriginRef.current = new URL(url).origin;
    readyRef.current = false;
    const onReadyMessage = (event: MessageEvent) => {
      if (event.source !== popup || event.origin !== targetOriginRef.current) return;
      const data = event.data as { origin?: unknown; kind?: unknown } | undefined;
      if (data?.origin !== hologramMessageOrigin || data.kind !== "ready") return;

      readyRef.current = true;
      const pending = pendingMessagesRef.current;
      pendingMessagesRef.current = [];
      const targetOrigin = targetOriginRef.current;
      if (!targetOrigin) return;
      for (const message of pending) {
        try {
          sendPendingMessage(popup, message, targetOrigin);
        } catch {
          // The popup may have closed between ready and flush.
          break;
        }
      }
    };
    readyListenerRef.current = onReadyMessage;
    window.addEventListener("message", onReadyMessage);
    startRelay(popup);

    if (shareable && "bytes" in shareable) {
      sendMessage(popup, { origin: hologramMessageOrigin, kind: "model-bytes", bytes: shareable.bytes });
    } else if (shareable && "url" in shareable) {
      sendMessage(popup, { origin: hologramMessageOrigin, kind: "model-url", url: shareable.url });
    }

    logDiagnostic(`holo-bridge window open name=${popup.name} url=${url}`);

    // Poll popup.closed instead of subscribing to the popup's pagehide event:
    // pagehide fires spuriously on Electron child windows during navigation and
    // used to tear down the relay permanently even though the hologram window
    // stayed open (killing lip-sync forwarding).
    closePollerRef.current = setInterval(() => {
      const current = holoWinRef.current;
      if (!current || current === popup && !current.closed) return;
      stopClosePoller();
      holoWinRef.current = null;
      stopRelay();
      resetTransport();
      setHologramActive(false);
      logDiagnostic("holo-bridge window closed");
    }, 1000);

    setHologramActive(true);
  }, [resetTransport, sendMessage, sendPendingMessage, startRelay, stopRelay, stopClosePoller]);

  const reopen = useCallback(async (modelUrl: string | undefined, targetScreen?: ScreenLike) => {
    close();
    await open(modelUrl, targetScreen);
  }, [close, open]);

  const handleTtsResult = useCallback((result: TtsResult): boolean => {
    const win = holoWinRef.current;
    if (!win || win.closed) return false;
    const byteLength = result.audio.byteLength;
    if (!sendMessage(win, {
      origin: hologramMessageOrigin,
      kind: "utter-bytes",
      utt: {
        mimeType: result.mimeType,
        sampleRate: result.sampleRate,
        words: result.words,
        lipSyncGain: result.lipSyncGain,
        lipSyncMaxWeight: result.lipSyncMaxWeight,
        lipSyncPreferMorphTarget: result.lipSyncPreferMorphTarget,
      },
      bytes: result.audio,
    })) return false;
    logDiagnostic(`holo-bridge utter forwarded mime=${result.mimeType} bytes=${byteLength}`);
    return true;
  }, [sendMessage]);

  const forwardRealtimeAudio = useCallback(async (blob: Blob): Promise<boolean> => {
    const win = holoWinRef.current;
    if (!win || win.closed) return false;
    try {
      const bytes = await blob.arrayBuffer();
      if (!sendMessage(win, { origin: hologramMessageOrigin, kind: "live-audio", bytes })) return false;
      return true;
    } catch (err) {
      logDiagnostic(`holo-bridge live-audio forward error ${String(err)}`);
      return false;
    }
  }, [sendMessage]);

  const updateModel = useCallback(async (modelUrl: string | undefined): Promise<boolean> => {
    const win = holoWinRef.current;
    if (!win || win.closed) {
      logDiagnostic(`holo-bridge updateModel skip no-window url=${modelUrl ?? "-"}`);
      return false;
    }
    const shareable = await resolveShareableModel(modelUrl);
    if (!shareable) {
      logDiagnostic(`holo-bridge updateModel resolve-failed url=${modelUrl ?? "-"}`);
      return false;
    }
    const byteLength = "url" in shareable ? 0 : shareable.bytes.byteLength;
    const sent = "url" in shareable
      ? sendMessage(win, { origin: hologramMessageOrigin, kind: "model-url", url: shareable.url })
      : sendMessage(win, { origin: hologramMessageOrigin, kind: "model-bytes", bytes: shareable.bytes });
    logDiagnostic(
      "url" in shareable
        ? `holo-bridge updateModel model-url url=${shareable.url} sent=${sent}`
        : `holo-bridge updateModel model-bytes bytes=${byteLength} sent=${sent}`
    );
    return sent;
  }, [sendMessage]);

  useEffect(() => {
    return () => close();
  }, [close]);

  return { hologramActive, open, reopen, close, handleTtsResult, forwardRealtimeAudio, updateModel };
}
