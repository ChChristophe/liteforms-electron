"use client";

import { useEffect, useRef, useState } from "react";
import { AvatarScene } from "@/components/avatar/AvatarScene";
import { logDiagnostic } from "@/lib/avatar/diagnosticLog";
import {
  hologramMessageOrigin,
  isHologramWindow,
  type MainToHologramMessage,
  type HologramToMainMessage,
} from "@/lib/avatar/hologramMessageProtocol";
import { dispatchAvatarLipSyncFrame } from "@/lib/avatar/lipSyncEvents";
import { createRmsLipSyncFrame, playTtsResult } from "@/lib/speech";
import type { TtsResult } from "@/lib/speech";

let sharedAudioContext: AudioContext | null = null;
let liveAnalyser: AnalyserNode | null = null;
let liveSamples: Uint8Array<ArrayBuffer> | null = null;
let livePlaying = false;
let liveLoopStarted = false;
let liveAnimationFrame: number | null = null;
let nextLiveTime = 0;

function getSharedAudioContext(): AudioContext {
  if (sharedAudioContext) return sharedAudioContext;
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  sharedAudioContext = new Ctor();
  return sharedAudioContext;
}

function ensureLiveAnalyser(): AnalyserNode {
  const context = getSharedAudioContext();
  if (!liveAnalyser) {
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.connect(context.destination);
    liveAnalyser = analyser;
    liveSamples = new Uint8Array(analyser.frequencyBinCount);
  }
  return liveAnalyser;
}

function startLiveLipSyncLoop() {
  if (liveLoopStarted) return;
  liveLoopStarted = true;
  const tick = () => {
    if (!livePlaying) {
      liveLoopStarted = false;
      liveAnimationFrame = null;
      return;
    }
    if (liveAnalyser && liveSamples) {
      liveAnalyser.getByteTimeDomainData(liveSamples);
      let sum = 0;
      for (let i = 0; i < liveSamples.length; i++) {
        const centered = (liveSamples[i] - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / liveSamples.length);
      if (rms > 0.015) {
        dispatchAvatarLipSyncFrame(createRmsLipSyncFrame(Math.min(1, Math.max(0, (rms - 0.01) / 0.18))));
      }
    }
    liveAnimationFrame = requestAnimationFrame(tick);
  };
  liveAnimationFrame = requestAnimationFrame(tick);
}

function readInitialModelUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const param = new URLSearchParams(window.location.search).get("model");
  return param && param.length > 0 ? param : undefined;
}

export default function HologramPage() {
  const [modelUrl, setModelUrl] = useState<string | undefined>(readInitialModelUrl);
  const utterChain = useRef<Promise<void>>(Promise.resolve());
  const liveChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!isHologramWindow()) return;

    let lipsyncCount = 0;
    let lipsyncLoggedAt = 0;
    const opener = window.opener as Window | null;
    const modelObjectUrlRef = { current: null as string | null };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== opener) return;
      const data = event.data as MainToHologramMessage | undefined;
      if (!data || data.origin !== hologramMessageOrigin) return;

      switch (data.kind) {
        case "utter-bytes": {
          if (
            !(data.bytes instanceof ArrayBuffer)
            || !data.utt
            || typeof data.utt !== "object"
            || typeof data.utt.mimeType !== "string"
          ) return;
          const result: TtsResult = {
            audio: data.bytes,
            mimeType: data.utt.mimeType,
            sampleRate: data.utt.sampleRate,
            lipSyncGain: data.utt.lipSyncGain,
            lipSyncMaxWeight: data.utt.lipSyncMaxWeight,
            lipSyncPreferMorphTarget: data.utt.lipSyncPreferMorphTarget,
            words: data.utt.words,
          };
          utterChain.current = utterChain.current
            .then(() => playTtsResult(result, {
              audioContextFactory: () => getSharedAudioContext(),
              onLipSyncFrame: dispatchAvatarLipSyncFrame,
            }))
            .catch((err) => {
              logDiagnostic(`holo-page utter playback error ${String(err)}`);
            });
          break;
        }
        case "live-audio": {
          if (!(data.bytes instanceof ArrayBuffer)) return;
          liveChainRef.current = liveChainRef.current.then(async () => {
            try {
              const context = getSharedAudioContext();
              const buffer = await context.decodeAudioData(data.bytes);
              const source = context.createBufferSource();
              source.buffer = buffer;
              source.connect(ensureLiveAnalyser());
              const startTime = Math.max(context.currentTime + 0.1, nextLiveTime);
              source.start(startTime);
              nextLiveTime = startTime + buffer.duration;
              livePlaying = true;
              source.addEventListener("ended", () => {
                if (nextLiveTime <= context.currentTime) livePlaying = false;
              }, { once: true });
              startLiveLipSyncLoop();
            } catch {
              // Ignore individual chunk decode failures.
            }
          });
          break;
        }
        case "lipsync":
          lipsyncCount++;
          if (lipsyncLoggedAt === 0 || lipsyncCount - lipsyncLoggedAt >= 50) {
            lipsyncLoggedAt = lipsyncCount;
            logDiagnostic(`holo-page lipsync received total=${lipsyncCount} firstWeight=${data.frame.weight.toFixed(3)}`);
          }
          dispatchAvatarLipSyncFrame(data.frame);
          break;
        case "model-url":
          if (typeof data.url === "string" && data.url) setModelUrl(data.url);
          break;
        case "model-bytes": {
          if (!(data.bytes instanceof ArrayBuffer)) return;
          const blob = new Blob([data.bytes]);
          const nextUrl = URL.createObjectURL(blob);
          if (modelObjectUrlRef.current) URL.revokeObjectURL(modelObjectUrlRef.current);
          modelObjectUrlRef.current = nextUrl;
          setModelUrl(nextUrl);
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener("message", onMessage);
    logDiagnostic("holo-page message listener attached");

    if (opener) {
      const ready: HologramToMainMessage = { origin: hologramMessageOrigin, kind: "ready" };
      opener.postMessage(ready, window.location.origin);
      logDiagnostic("holo-page sent ready to opener");
    }

    return () => {
      window.removeEventListener("message", onMessage);
      if (modelObjectUrlRef.current) URL.revokeObjectURL(modelObjectUrlRef.current);
      livePlaying = false;
      if (liveAnimationFrame !== null) cancelAnimationFrame(liveAnimationFrame);
      liveAnimationFrame = null;
      liveLoopStarted = false;
      nextLiveTime = 0;
    };
  }, []);

  return (
    <div className="hologram-stage">
      <AvatarScene modelUrl={modelUrl} />
    </div>
  );
}
