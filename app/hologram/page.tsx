"use client";

import { useEffect, useState } from "react";
import { AvatarScene } from "@/components/avatar/AvatarScene";
import { logDiagnostic } from "@/lib/avatar/diagnosticLog";
import {
  hologramMessageOrigin,
  isHologramWindow,
  type MainToHologramMessage,
  type HologramToMainMessage,
} from "@/lib/avatar/hologramMessageProtocol";
import { dispatchAvatarLipSyncFrame } from "@/lib/avatar/lipSyncEvents";

function readInitialModelUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const param = new URLSearchParams(window.location.search).get("model");
  return param && param.length > 0 ? param : undefined;
}

export default function HologramPage() {
  const [modelUrl, setModelUrl] = useState<string | undefined>(readInitialModelUrl);

  useEffect(() => {
    if (!isHologramWindow()) return;

    let lipsyncCount = 0;
    let lipsyncLoggedAt = 0;

    const onMessage = (event: MessageEvent) => {
      const data = event.data as MainToHologramMessage | undefined;
      if (!data || data.origin !== hologramMessageOrigin) return;

      switch (data.kind) {
        case "lipsync":
          lipsyncCount++;
          if (lipsyncLoggedAt === 0 || lipsyncCount - lipsyncLoggedAt >= 50) {
            lipsyncLoggedAt = lipsyncCount;
            logDiagnostic(`holo-page lipsync received total=${lipsyncCount} firstWeight=${data.frame.weight.toFixed(3)}`);
          }
          dispatchAvatarLipSyncFrame(data.frame);
          break;
        case "model-url":
          if (data.url) setModelUrl(data.url);
          break;
        case "model-bytes": {
          const blob = new Blob([data.bytes]);
          setModelUrl(URL.createObjectURL(blob));
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener("message", onMessage);
    logDiagnostic("holo-page message listener attached");

    const opener = window.opener as Window | null;
    if (opener) {
      const ready: HologramToMainMessage = { origin: hologramMessageOrigin, kind: "ready" };
      opener.postMessage(ready, "*");
      logDiagnostic("holo-page sent ready to opener");
    }

    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="hologram-stage">
      <AvatarScene modelUrl={modelUrl} />
    </div>
  );
}