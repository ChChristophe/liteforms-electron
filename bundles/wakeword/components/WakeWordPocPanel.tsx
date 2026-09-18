"use client";

/**
 * Liteforms wake word bundle — POC panel.
 *
 * Deliberately self-contained (inline styles, no globals.css edits). Lets you
 * pick ANY registered wake word model and proves the pipeline end to end:
 * live status, threshold slider, last detections (kept across model switches
 * so scores can be compared side by side).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PRETRAINED_MODELS,
  WAKE_WORD_PHRASES,
  type WakewordModelName,
} from "../engine/modelsRegistry";
import { useWakeWord } from "../hooks/useWakeWord";
import type { WakeWordDetectedEvent } from "../types";

const STATUS_COLORS: Record<string, string> = {
  disabled: "#6b7280",
  initializing: "#d97706",
  ready: "#2563eb",
  listening: "#059669",
  detected: "#dc2626",
  error: "#dc2626",
};

const MODEL_OPTIONS = Object.keys(PRETRAINED_MODELS) as WakewordModelName[];

export function WakeWordPocPanel() {
  const [model, setModel] = useState<WakewordModelName>("hey_jarvis");
  // Lifted so threshold + detection history survive model switches.
  const [threshold, setThreshold] = useState(0.5);
  const [history, setHistory] = useState<WakeWordDetectedEvent[]>([]);
  const wasRunningRef = useRef(false);

  const handleDetection = useCallback((detection: WakeWordDetectedEvent) => {
    setHistory((prev) => [detection, ...prev].slice(0, 10));
  }, []);

  const handleRunningChange = useCallback((running: boolean) => {
    wasRunningRef.current = running;
  }, []);

  return (
    <section
      style={{
        maxWidth: 420,
        margin: "48px auto",
        padding: 24,
        borderRadius: 12,
        border: "1px solid #27272a",
        background: "#18181b",
        color: "#fafafa",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 18, margin: 0 }}>Wake word — POC</h1>
      <p style={{ fontSize: 13, color: "#a1a1aa", marginTop: 4 }}>
        Dites «&nbsp;{WAKE_WORD_PHRASES[model]}&nbsp;» après avoir démarré
        l&apos;écoute.
      </p>

      <label
        style={{
          display: "block",
          fontSize: 12,
          color: "#a1a1aa",
          marginBottom: 16,
        }}
      >
        Modèle testé&nbsp;:
        <select
          value={model}
          onChange={(e) => setModel(e.target.value as WakewordModelName)}
          aria-label="Modèle wake word"
          style={{
            display: "block",
            width: "100%",
            marginTop: 6,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #27272a",
            background: "#09090b",
            color: "#fafafa",
            fontSize: 14,
          }}
        >
          {MODEL_OPTIONS.map((name) => (
            <option key={name} value={name}>
              {WAKE_WORD_PHRASES[name]}
            </option>
          ))}
        </select>
      </label>

      <PocRunner
        key={model}
        model={model}
        autoStart={wasRunningRef.current}
        threshold={threshold}
        onThresholdChange={setThreshold}
        history={history}
        onDetection={handleDetection}
        onRunningChange={handleRunningChange}
      />
    </section>
  );
}

interface PocRunnerProps {
  model: WakewordModelName;
  /** Restart listening automatically when switching models mid-test. */
  autoStart: boolean;
  threshold: number;
  onThresholdChange: (value: number) => void;
  history: WakeWordDetectedEvent[];
  onDetection: (detection: WakeWordDetectedEvent) => void;
  onRunningChange: (running: boolean) => void;
}

function PocRunner({
  model,
  autoStart,
  threshold,
  onThresholdChange,
  history,
  onDetection,
  onRunningChange,
}: PocRunnerProps) {
  const { status, score, lastDetection, error, start, stop, setThreshold } =
    useWakeWord({ wakewordModels: [model], autoStart });

  const running = status === "listening" || status === "detected";

  // Apply the shared threshold to each freshly created controller.
  useEffect(() => {
    setThreshold(threshold);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onRunningChange(running);
  }, [running, onRunningChange]);

  useEffect(() => {
    if (!lastDetection) return;
    onDetection(lastDetection);
  }, [lastDetection, onDetection]);

  const onSliderChange = (value: number): void => {
    onThresholdChange(value);
    setThreshold(value);
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          margin: "16px 0",
          fontSize: 14,
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: STATUS_COLORS[status] ?? "#6b7280",
            boxShadow:
              status === "listening" || status === "detected"
                ? `0 0 8px ${STATUS_COLORS[status]}`
                : undefined,
          }}
        />
        <strong>{status}</strong>
        <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>
          score: {score.toFixed(3)}
        </span>
      </div>

      <label
        style={{
          display: "block",
          fontSize: 12,
          color: "#a1a1aa",
          marginBottom: 16,
        }}
      >
        Seuil de détection : {threshold.toFixed(2)}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={threshold}
          onChange={(e) => onSliderChange(Number(e.target.value))}
          style={{ width: "100%", accentColor: "#059669" }}
        />
      </label>

      <div style={{ display: "flex", gap: 8 }}>
        {!running ? (
          <button
            type="button"
            onClick={start}
            disabled={status === "initializing"}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 8,
              border: "none",
              background: "#059669",
              color: "white",
              fontWeight: 600,
              cursor: status === "initializing" ? "wait" : "pointer",
            }}
          >
            {status === "initializing" ? "Chargement…" : "Démarrer l'écoute"}
          </button>
        ) : (
          <button
            type="button"
            onClick={stop}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 8,
              border: "none",
              background: "#dc2626",
              color: "white",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Arrêter
          </button>
        )}
      </div>

      {error && (
        <p style={{ color: "#f87171", fontSize: 13, marginTop: 12 }}>
          {error.code} — {error.message}
        </p>
      )}

      {history.length > 0 && (
        <>
          <h2 style={{ fontSize: 13, color: "#a1a1aa", marginTop: 20 }}>
            Détections récentes
          </h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {history.map((d, i) => (
              <li
                key={`${d.timestamp}-${i}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  padding: "6px 0",
                  borderBottom: "1px solid #27272a",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <span>{new Date(d.timestamp).toLocaleTimeString()}</span>
                <span>{WAKE_WORD_PHRASES[d.label as WakewordModelName] ?? d.label}</span>
                <span>{d.score.toFixed(3)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
