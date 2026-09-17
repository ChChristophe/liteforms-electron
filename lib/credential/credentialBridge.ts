"use client";

// Renderer-side access to the appliance's provider-credential store (decision
// D1). The raw key lives in <userData>/config/provider-credentials.json and is
// reached through the preload IPC channel (window.liteformsElectron.credentials)
// — never over HTTP, so the key never crosses the network. Falls back to
// `undefined` outside Electron (web dev), where the legacy session-config
// credential keeps working unchanged.

export type CredentialBridge = {
  get(provider: string): Promise<string | undefined>;
  set(provider: string, apiKey: string): Promise<boolean>;
};

type LiteformsElectronWindow = {
  liteformsElectron?: { credentials?: CredentialBridge };
};

export function getCredentialBridge(): CredentialBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as LiteformsElectronWindow).liteformsElectron?.credentials;
}

/** Resolves a provider's raw key from the durable store, or undefined when
 * absent (no Electron bridge / provider unconfigured). Never throws. */
export async function resolveProviderCredential(provider: string): Promise<string | undefined> {
  const bridge = getCredentialBridge();
  if (!bridge) return undefined;
  try {
    return await bridge.get(provider);
  } catch {
    return undefined;
  }
}

/** Fills `config.credential` from the durable store when it is not already
 * set locally (the store is the source of truth after a Mobile credential
 * push). Returns the config unchanged when no bridge/credential is available. */
export async function ensureCredential<T extends { provider: string; credential?: string }>(config: T): Promise<T> {
  if (config.credential) return config;
  const credential = await resolveProviderCredential(config.provider);
  return credential ? ({ ...config, credential } as T) : config;
}
