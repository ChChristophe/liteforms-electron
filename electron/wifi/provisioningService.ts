// Provisioning state machine (contract v1 + PLAN_DIRECTEUR.md §4.4/§8).
// Boot: if target WiFi credentials are already provisioned → normal boot;
// otherwise enter provisioning mode: hotspot (or LAN-direct fallback on
// Windows when the adapter cannot tether), serve /api/provisioning/*, and on
// accepted WiFi → persist credentials FIRST, then tear the hotspot down and
// join the target (the hotspot must not fall before the config is stored).
import { createProvisioningPlatform, type ProvisioningPlatform } from "./provisioningPlatform";
import type { WifiCredentials } from "./wifiConfig";
import type { WifiCredentialsStore } from "./wifiCredentialsStore";

export type ProvisioningState =
  | "idle"          // normal operation (provisioned, or LAN-direct mode)
  | "starting"      // booting the provisioning service
  | "provisioning"  // hotspot up (or LAN-direct), routes served
  | "switching";    // credentials accepted: persist → stop hotspot → join

/** Outcome of the last network transition, served by
 * GET /api/provisioning/status (protocol 13/09/2026). "joining" while the
 * transition runs, then joined/failed; null before any acceptance. */
export type LastJoinResult = "joining" | "joined" | "failed" | null;

export type ProvisioningEvents = {
  onStateChange?: (state: ProvisioningState) => void;
  onLog?: (line: string) => void;
};

export type ProvisioningServiceOptions = {
  store: WifiCredentialsStore;
  platform?: ProvisioningPlatform;
  hotspotSsid?: string;
  hotspotPassphrase?: string;
  events?: ProvisioningEvents;
};

export type ProvisioningService = {
  /** Boot decision: provisioned credentials exist → null (normal boot). */
  begin(): Promise<null | { hotspotSsid: string | null; gatewayIp: string | null }>;
  /** POST /api/provisioning/wifi accepted path. Idempotent: a second call
   * while switching/switched returns the same acceptance without re-running
   * the transition. Persists BEFORE stopping the hotspot (invariant).
   * Resolves as soon as credentials are persisted (fast 202); the network
   * transition continues in `transition`. */
  acceptWifi(credentials: WifiCredentials): Promise<boolean>;
  /** Full accept transition (stop hotspot + join target), null before any
   * acceptance. The bootstrap must await it before relaunching. */
  transition: Promise<boolean> | null;
  getState(): ProvisioningState;
  /** Last transition outcome for GET /api/provisioning/status. */
  getLastJoinResult(): LastJoinResult;
  isProvisioning(): boolean;
  stop(): Promise<void>;
};

// Random Liteforms-Setup-XXXX suffix (contract: no display on the appliance —
// the mobile discovers the SSID by scanning for the prefix).
function randomSuffix(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

export function createProvisioningService(options: ProvisioningServiceOptions): ProvisioningService {
  const store = options.store;
  const platform = options.platform ?? createProvisioningPlatform();
  const hotspotSsid = options.hotspotSsid ?? `Liteforms-Setup-${randomSuffix()}`;
  const hotspotPassphrase = options.hotspotPassphrase ?? "liteforms";
  const events = options.events ?? {};

  let state: ProvisioningState = "idle";
  let activeHotspot: { ssid: string; gatewayIp: string } | null = null;
  let switchPromise: Promise<boolean> | null = null;
  let lastJoinResult: LastJoinResult = null;
  function setState(next: ProvisioningState) {
    state = next;
    events.onStateChange?.(state);
  }

  return {
    getState() {
      return state;
    },

    getLastJoinResult() {
      return lastJoinResult;
    },

    transition: null,

    isProvisioning() {
      return state === "provisioning" || state === "starting" || state === "switching";
    },

    async begin() {
      const credentials = store.load();
      if (credentials) {
        // Boot v2 self-healing (PLAN_DIRECTEUR.md §5ter.3): credentials
        // present does NOT mean the join ever succeeded (previous behavior
        // booted normal even when the last join failed, leaving the appliance
        // stuck on Ethernet). Retry the join with the stored credentials —
        // the platform includes its 0/3/6 s retry (worst case ~10 s of added
        // boot latency on FAILURE only; on success the join takes ~1-2 s, an
        // acceptable delay for an appliance with no boot-time urgency).
        events.onLog?.("provisioning boot :: credentials present, attempting join (boot v2)");
        const joined = await platform.joinWifi(credentials);
        events.onLog?.(`provisioning boot :: boot-v2 join result=${joined ? "ok → normal boot" : "failed → provisioning mode"}`);
        if (joined) {
          return null; // normal boot, same as the legacy provisioned path
        }
        // Join failed → provisioning mode (hotspot back up). The Mobile
        // redoes the flow; acceptWifi will overwrite the stored credentials.
        events.onLog?.("provisioning boot :: join failed — falling through to provisioning mode");
      } else {
        events.onLog?.(`provisioning boot :: no credentials, starting hotspot ssid=${hotspotSsid}`);
      }
      setState("starting");
      activeHotspot = await platform.startHotspot(hotspotSsid, hotspotPassphrase);
      if (activeHotspot) {
        events.onLog?.(`provisioning boot :: hotspot up gateway=${activeHotspot.gatewayIp}`);
      } else {
        // Windows fallback: adapter cannot tether → LAN-direct mode. The PC is
        // already on the home WiFi; the mobile sends device-config directly
        // (flow validated in the POC). Provisioning routes still answer on the
        // LAN interface so the mobile can re-send WiFi later if needed.
        events.onLog?.("provisioning boot :: hotspot unavailable, LAN-direct fallback");
      }
      setState("provisioning");
      return activeHotspot
        ? { hotspotSsid: activeHotspot.ssid, gatewayIp: activeHotspot.gatewayIp }
        : { hotspotSsid: null, gatewayIp: null };
    },

    acceptWifi(credentials) {
      // Idempotent: one transition per boot; repeated POSTs reuse it.
      // Fast-202 contract: resolve as soon as the credentials are persisted.
      // The hotspot teardown + join continue in the background (switchPromise,
      // awaited by stop()) — the caller may answer 202 without waiting for
      // the join (retry with backoff can take up to ~30 s).
      if (switchPromise) {
        return Promise.resolve(true);
      }
      // 1. Persist FIRST — the hotspot must not fall before the config is stored.
      const saved = store.save(credentials);
      if (!saved) {
        events.onLog?.("provisioning accept :: persist FAILED, staying in provisioning mode");
        return Promise.resolve(false);
      }
      setState("switching");
      lastJoinResult = "joining";
      events.onLog?.("provisioning accept :: credentials persisted (safeStorage)");
      switchPromise = (async () => {
        // 2. Tear the hotspot down.
        try {
          await platform.stopHotspot();
          events.onLog?.("provisioning accept :: hotspot stopped");
        } catch {
          events.onLog?.("provisioning accept :: hotspot stop failed (continuing)");
        }
        // 3. Join the target. Best effort: a failed join leaves the appliance
        // on Ethernet/LAN-direct; credentials stay stored for the next boot.
        const joined = await platform.joinWifi(credentials);
        events.onLog?.(`provisioning accept :: join result=${joined ? "ok" : "failed"} (credentials kept)`);
        // Boot v2 self-healing (PLAN_DIRECTEUR.md §5ter.3): a FAILED join at
        // this point means the appliance would reboot stuck on Ethernet with
        // credentials that never work — back to provisioning mode so the
        // Mobile can redo the flow. A successful join keeps the normal path
        // (relaunch → normal boot, no re-provisioning loop: this branch is
        // the only trigger that re-enters provisioning after a join).
        if (!joined) {
          events.onLog?.("provisioning accept :: join failed — returning to provisioning mode (hotspot back up)");
          lastJoinResult = "failed";
          setState("provisioning");
          try {
            activeHotspot = await platform.startHotspot(hotspotSsid, hotspotPassphrase);
          } catch {
            activeHotspot = null;
          }
          if (activeHotspot) {
            events.onLog?.(`provisioning accept :: hotspot up gateway=${activeHotspot.gatewayIp}`);
          } else {
            events.onLog?.("provisioning accept :: hotspot unavailable, LAN-direct fallback");
          }
          // Re-arm: the Mobile may redo the flow now that the hotspot is back
          // — the next acceptWifi must start a NEW transition (the old
          // switchPromise would otherwise make the retry idempotent-noop).
          switchPromise = null;
          return false;
        }
        lastJoinResult = "joined";
        setState("idle");
        return true;
      })();
      // Expose the transition so the bootstrap can wait for its completion
      // before relaunching (relaunching earlier kills the join mid-flight —
      // validated on the ground 13/09/2026). On a failed join it resolves
      // false, no relaunch happens, and the appliance stays in provisioning
      // mode (hotspot re-raised inside the transition, switchPromise re-armed
      // so the Mobile can redo the flow).
      this.transition = switchPromise;
      return Promise.resolve(true);
    },

    async stop() {
      if (switchPromise) {
        await switchPromise;
      }
      if (activeHotspot) {
        try {
          await platform.stopHotspot();
        } catch {
          // Best effort on shutdown.
        }
        activeHotspot = null;
      }
      if (state !== "idle") {
        setState("idle");
      }
    }
  };
}
