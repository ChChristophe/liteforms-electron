"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AvatarScene } from "@/components/avatar/AvatarScene";
import { ChatPanel, initialLocalModelLoadState } from "@/components/chat/ChatPanel";
import type { CharacterConfig, LocalModelLoadState } from "@/components/chat/ChatPanel";
import { useHologramBridge } from "@/components/hologram/useHologramBridge";
import { displayKey, resolveHologramAutoOpen } from "@/components/hologram/hologramAutoOpen";
import { BridgeRequiredBanner } from "@/components/looking-glass/BridgeRequiredBanner";
import { OnboardingModal } from "@/components/onboarding/OnboardingModal";
import {
  getLookingGlassBridgeConnection,
  type LookingGlassDisplayBounds,
} from "@/lib/avatar/bridgeConnection";
import { logDiagnostic } from "@/lib/avatar/diagnosticLog";
import type { BaseProviderConfig } from "@/lib/llm";
import type { AsrConfig, RealtimeVoiceConfig, TtsConfig } from "@/lib/speech";
import { saveSessionConfig, loadSessionConfig } from "@/lib/storage/sessionConfig";
import { saveCharacterConfig, loadCharacterConfig } from "@/lib/storage/characterConfig";
import { createIndexedDbVrmRepository } from "@/lib/storage/indexedDbVrmRepository";
import type { VrmRepository } from "@/lib/storage/vrmRepository";
import { startPocDeviceConfigPolling, type PocApplyHooks } from "@/lib/deviceConfig/pocClient";

const onboardingStorageKey = "liteforms.onboardingMode";
const bridgeConnectionPollMs = 1500;

const defaultCharacter: CharacterConfig = {
  name: "Clawdia",
  pronouns: "SHE",
  personality: "You are Clawdia, diva of the deep. You're a cranky crustacean. Do you even have a heart? Wait, lobsters have hearts, right? And... just one? Who knows? I bet you do! You have a visual form of a cartoon lobster in a holographic display. Don't include markdown styling, bullet points, numbered lists, URLs, or emojis in your responses - just plain ole text. Be concise.",
  greeting: ""
};

export default function HomePage() {
  const [modelUrl, setModelUrl] = useState<string | undefined>(undefined);
  const [restoredVrmFileName, setRestoredVrmFileName] = useState<string | undefined>(undefined);
  const vrmRepoRef = useRef<VrmRepository | null>(null);
  const [character, setCharacter] = useState<CharacterConfig>(() => {
    const saved = loadCharacterConfig();
    if (!saved) return defaultCharacter;
    return { name: saved.name, pronouns: saved.pronouns, personality: saved.personality, greeting: saved.greeting };
  });
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showConfigureModal, setShowConfigureModal] = useState(false);
  const [shouldPreloadLocalModels, setShouldPreloadLocalModels] = useState(false);
  const [initialLlmConfig, setInitialLlmConfig] = useState<BaseProviderConfig | undefined>(undefined);
  const [initialTtsConfig, setInitialTtsConfig] = useState<TtsConfig | undefined>(undefined);
  const [initialAsrConfig, setInitialAsrConfig] = useState<AsrConfig | undefined>(undefined);
  const [initialRealtimeVoiceConfig, setInitialRealtimeVoiceConfig] = useState<RealtimeVoiceConfig | undefined>(undefined);
  const [chatPanelKey, setChatPanelKey] = useState(0);
  const [modalLoadState, setModalLoadState] = useState<LocalModelLoadState[]>(initialLocalModelLoadState);
  const [bridgeConnected, setBridgeConnected] = useState<boolean | undefined>(undefined);
  const [bridgeDisplay, setBridgeDisplay] = useState<LookingGlassDisplayBounds | undefined>(undefined);
  const [isBridgeBannerDismissed, setIsBridgeBannerDismissed] = useState(false);
  const showBridgeBanner = bridgeConnected === false && !isBridgeBannerDismissed;
  const {
    hologramActive,
    open: openHologram,
    reopen: reopenHologram,
    close: closeHologram,
    handleTtsResult,
    forwardRealtimeAudio,
    updateModel,
  } = useHologramBridge();

  const pageLogReff = useRef(false);
  if (!pageLogReff.current) {
    pageLogReff.current = true;
    try {
      logDiagnostic(
        `HomePage render | pathname=${window.location.pathname} bridge=${Boolean(
          (window as { liteformsElectron?: unknown }).liteformsElectron
        )}`
      );
    } catch (err) {
      try {
        logDiagnostic(`HomePage render ERROR ${String(err)}`);
      } catch {
        /* ignore */
      }
    }
  }

  useEffect(() => {
    const savedMode = localStorage.getItem(onboardingStorageKey);
    if (!savedMode) {
      setShowOnboarding(true);
    } else if (savedMode === "builtin") {
      setShouldPreloadLocalModels(true);
    } else if (savedMode === "custom") {
      const saved = loadSessionConfig();
      if (saved) {
        setInitialLlmConfig(saved.llm);
        setInitialTtsConfig(saved.tts);
        setInitialAsrConfig(saved.asr);
        setInitialRealtimeVoiceConfig(saved.realtimeVoice);
        // React 18 batches these updates, so ChatPanel re-mounts in a single
        // re-render with the correct initialConfig — avoiding the two-render
        // cycle where ChatPanel's own useState would ignore an updated prop.
        setChatPanelKey((k) => k + 1);
      }
      setShouldPreloadLocalModels(true);
    }

    // POC renderer apply hooks (POC.md §12.2): project incoming blocks onto the
    // existing setters, mirroring handleUseCustom / handleCharacterChange.
    const buildPocApplyHooks = (): PocApplyHooks => ({
      setCharacter: (next) => setCharacter(next),
      onSessionConfig: (session) => {
        setInitialLlmConfig(session.llm);
        setInitialTtsConfig(session.tts);
        setInitialAsrConfig(session.asr);
        if (session.realtimeVoice) {
          setInitialRealtimeVoiceConfig(session.realtimeVoice);
        }
        // React batches these updates: ChatPanel re-mounts once with the new
        // initial configs (same path as handleUseCustom).
        setChatPanelKey((k) => k + 1);
      },
      getVrmRepository: () => vrmRepoRef.current,
      onVrmModel: (stored) => {
        setModelUrl(URL.createObjectURL(new Blob([stored.arrayBuffer])));
        setRestoredVrmFileName(stored.fileName);
      }
    });

    let stopPocDeviceConfigPolling: (() => void) | undefined;
    createIndexedDbVrmRepository().then((repo) => {
      vrmRepoRef.current = repo;
      // POC Phase B apply loop starts once the VRM repo is ready so a stored or
      // incoming modelRef can be matched live.
      stopPocDeviceConfigPolling = startPocDeviceConfigPolling(buildPocApplyHooks());
      return repo.load();
    }).then((stored) => {
      if (!stored) return;
      const blob = new Blob([stored.arrayBuffer]);
      setModelUrl(URL.createObjectURL(blob));
      setRestoredVrmFileName(stored.fileName);
    }).catch(() => {
      // IndexedDB may be unavailable (private browsing, storage quota, etc.)
      // The POC apply loop must still run without it.
      stopPocDeviceConfigPolling = startPocDeviceConfigPolling(buildPocApplyHooks());
    });
    return () => {
      stopPocDeviceConfigPolling?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let checking = false;

    const checkBridge = async () => {
      if (checking) return;
      checking = true;
      try {
        const connection = await getLookingGlassBridgeConnection();
        if (disposed) return;
        setBridgeConnected(connection.connected);
        setBridgeDisplay(connection.display);
        // The native probe failure is otherwise silent: log it so one diagnostic
        // run is enough to see why the Looking Glass stays unreachable.
        const stateKey = connection.connected
          ? `connected source=${connection.source} display=${connection.display
            ? `${connection.display.left},${connection.display.top} ${connection.display.width}x${connection.display.height}`
            : "-"}`
          : `disconnected source=${connection.source} error="${connection.error ?? "-"}"`;
        if (stateKey !== previousConnectionKeyRef.current) {
          previousConnectionKeyRef.current = stateKey;
          logDiagnostic(`bridge poll ${stateKey}`);
        }
      } finally {
        checking = false;
      }
    };

    void checkBridge();
    const pollId = window.setInterval(() => {
      void checkBridge();
    }, bridgeConnectionPollMs);
    return () => {
      disposed = true;
      window.clearInterval(pollId);
    };
  }, []);

  const previousBridgeStateRef = useRef<boolean | undefined>(undefined);
  const previousBridgeDisplayKeyRef = useRef("");
  const previousConnectionKeyRef = useRef("");

  useEffect(() => {
    const decision = resolveHologramAutoOpen(
      {
        hasElectronApi: Boolean(window.liteformsElectron),
        connected: bridgeConnected,
        display: bridgeDisplay,
        hologramActive,
      },
      {
        connected: previousBridgeStateRef.current,
        displayKey: previousBridgeDisplayKeyRef.current,
      },
    );
    previousBridgeStateRef.current = bridgeConnected;
    previousBridgeDisplayKeyRef.current = displayKey(bridgeDisplay);

    if (decision === "open") void openHologram(modelUrl, bridgeDisplay);
    if (decision === "reopen") void reopenHologram(modelUrl, bridgeDisplay);
  }, [bridgeConnected, bridgeDisplay, hologramActive, modelUrl, openHologram, reopenHologram]);

  const previousHologramModelRef = useRef<string | undefined>(modelUrl);
  useEffect(() => {
    const previousModelUrl = previousHologramModelRef.current;
    previousHologramModelRef.current = modelUrl;
    if (!hologramActive || previousModelUrl === modelUrl) return;
    void updateModel(modelUrl);
  }, [hologramActive, modelUrl, updateModel]);

  const handleLocalModelLoadStateChange = useCallback((state: LocalModelLoadState[]) => {
    setModalLoadState(state);
  }, []);

  const handleConfigChange = useCallback((llm: BaseProviderConfig, tts: TtsConfig, asr: AsrConfig, realtimeVoice?: RealtimeVoiceConfig) => {
    // Persist mid-session settings changes so they survive a page refresh.
    const savedMode = localStorage.getItem(onboardingStorageKey);
    if (savedMode === "custom") {
      saveSessionConfig({ llm, tts, asr, realtimeVoice });
    }
  }, []);

  const handleCharacterChange = useCallback((next: CharacterConfig) => {
    setCharacter(next);
    saveCharacterConfig(next);
  }, []);

  const handleVrmFileLoad = useCallback((file: File) => {
    file.arrayBuffer().then((buf) => {
      vrmRepoRef.current?.save(buf, file.name).catch(() => {
        // Storage failure is non-fatal; the VRM is still loaded for this session.
      });
    }).catch(() => {});
  }, []);

  const handleVrmReset = useCallback(() => {
    setModelUrl(undefined);
    setRestoredVrmFileName(undefined);
    vrmRepoRef.current?.clear().catch(() => {});
  }, []);

  function handleUseBuiltIn() {
    localStorage.setItem(onboardingStorageKey, "builtin");
    setShouldPreloadLocalModels(true);
    // Modal stays open to show the loading step — closed by handleModalClose
  }

  function handleUseCustom(config: BaseProviderConfig, ttsConfig: TtsConfig, asrConfig: AsrConfig, realtimeVoiceConfig?: RealtimeVoiceConfig) {
    localStorage.setItem(onboardingStorageKey, "custom");
    saveSessionConfig({ llm: config, tts: ttsConfig, asr: asrConfig, realtimeVoice: realtimeVoiceConfig });
    setInitialLlmConfig(config);
    setInitialTtsConfig(ttsConfig);
    setInitialAsrConfig(asrConfig);
    setInitialRealtimeVoiceConfig(realtimeVoiceConfig);
    // Trigger preloading; ChatPanel's runPreload decides per-model whether to actually download.
    setShouldPreloadLocalModels(true);
    // The modal stays open and transitions itself to the "loading" step (handleCustomStart inside
    // OnboardingModal). The user closes it via the "Continue" button when models are ready, which
    // calls handleModalClose. This matches the built-in flow.
    setChatPanelKey((k) => k + 1);
  }

  function handleModalClose() {
    setShowOnboarding(false);
  }

  function handleConfigureOpen() {
    setShowConfigureModal(true);
  }

  function handleConfigureClose() {
    setShowConfigureModal(false);
  }

  return (
    <main className={showBridgeBanner ? "stage stage--with-top-banner" : "stage"}>
      {showBridgeBanner && <BridgeRequiredBanner onDismiss={() => setIsBridgeBannerDismissed(true)} />}
      <section className="avatar-viewport" aria-label="Avatar preview">
        {hologramActive ? (
          <button
            className="hologram-toggle"
            type="button"
            onClick={() => closeHologram()}
          >
            Normal
          </button>
        ) : (
          <button
            className="hologram-toggle"
            type="button"
            onClick={() => void openHologram(modelUrl)}
            disabled={showBridgeBanner}
          >
            Voir en holo
          </button>
        )}
        {!hologramActive && <AvatarScene modelUrl={modelUrl} hideVrButton />}
      </section>
      <ChatPanel
        key={chatPanelKey}
        character={character}
        onCharacterChange={handleCharacterChange}
        onModelUrlChange={setModelUrl}
        initialVrmFileName={restoredVrmFileName}
        onVrmFileLoad={handleVrmFileLoad}
        onVrmReset={handleVrmReset}
        shouldPreloadLocalModels={shouldPreloadLocalModels}
        preloadSessionId={chatPanelKey}
        initialLlmConfig={initialLlmConfig}
        initialTtsConfig={initialTtsConfig}
        initialAsrConfig={initialAsrConfig}
        initialRealtimeVoiceConfig={initialRealtimeVoiceConfig}
        onLocalModelLoadStateChange={handleLocalModelLoadStateChange}
        onConfigChange={handleConfigChange}
        onOpenConfigure={handleConfigureOpen}
        handleTtsForHologram={handleTtsResult}
        handleRealtimeAudioForHologram={forwardRealtimeAudio}
      />
      {showOnboarding && (
        <OnboardingModal
          onUseBuiltIn={handleUseBuiltIn}
          onUseCustom={handleUseCustom}
          onClose={handleModalClose}
          localModelLoadState={modalLoadState}
        />
      )}
      {showConfigureModal && (
        <OnboardingModal
          mode="configure"
          initialLlmConfig={initialLlmConfig}
          initialTtsConfig={initialTtsConfig}
          initialAsrConfig={initialAsrConfig}
          initialRealtimeVoiceConfig={initialRealtimeVoiceConfig}
          onUseBuiltIn={handleUseBuiltIn}
          onUseCustom={handleUseCustom}
          onClose={handleConfigureClose}
          localModelLoadState={modalLoadState}
        />
      )}
    </main>
  );
}
