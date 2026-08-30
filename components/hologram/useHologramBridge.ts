"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { logDiagnostic } from "@/lib/avatar/diagnosticLog";
import { openHldHologramWindow } from "@/lib/avatar/hologramWindow";
import {
  buildHologramRouteUrl,
  sendLipsyncToHologram,
  sendModelBytesToHologram,
} from "@/lib/avatar/hologramMessageProtocol";
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
      sendLipsyncToHologram(win, frame);
    };
    window.addEventListener(avatarLipSyncEventName, onFrame);
    relayRef.current = onFrame;
    logDiagnostic(`holo-bridge relay start name=${win.name}`);
  }, []);

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
    setHologramActive(false);
    if (win && !win.closed) {
      win.close();
    }
  }, [stopRelay, stopClosePoller]);

  const open = useCallback(async (modelUrl: string | undefined) => {
    if (holoWinRef.current && !holoWinRef.current.closed) return;
    stopClosePoller();

    const shareable = await resolveShareableModel(modelUrl);
    const base = window.location.origin;
    const shareUrl = shareable && "url" in shareable ? shareable.url : undefined;
    const url = buildHologramRouteUrl(base, shareUrl);
    const popup = await openHldHologramWindow(window, url);
    if (!popup) return;

    holoWinRef.current = popup;
    startRelay(popup);

    if (shareable && "bytes" in shareable) {
      void sendModelBytesToHologram(popup, shareable.bytes);
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
      setHologramActive(false);
      logDiagnostic("holo-bridge window closed");
    }, 1000);

    setHologramActive(true);
  }, [startRelay, stopRelay, stopClosePoller]);

  useEffect(() => {
    return () => close();
  }, [close]);

  return { hologramActive, open, close };
}