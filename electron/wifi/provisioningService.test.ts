import { describe, expect, it, vi } from "vitest";
import { createProvisioningService, type ProvisioningService } from "./provisioningService";
import type { ProvisioningPlatform } from "./provisioningPlatform";
import type { WifiCredentials } from "./wifiConfig";
import type { WifiCredentialsStore } from "./wifiCredentialsStore";

function makeStore({ provisioned = false }: { provisioned?: boolean } = {}): WifiCredentialsStore & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    save(credentials) {
      saved.push(credentials);
      return true;
    },
    load() {
      return provisioned ? { ssid: "Old", password: "pw", security: "WPA2-PSK" } : null;
    },
    clear() {
      /* noop */
    }
  };
}

function makePlatform(overrides: Partial<ProvisioningPlatform> = {}): ProvisioningPlatform & {
  startCalls: number;
  stopCalls: number;
  joinCalls: unknown[];
} {
  const impl = {
    startCalls: 0,
    stopCalls: 0,
    joinCalls: [] as unknown[],
    async startHotspot(ssid: string) {
      impl.startCalls += 1;
      return { ssid, gatewayIp: "192.168.4.1" };
    },
    async stopHotspot() {
      impl.stopCalls += 1;
    },
    async joinWifi(credentials: unknown) {
      impl.joinCalls.push(credentials);
      return true;
    },
    ...overrides
  };
  return impl;
}

const credentials: WifiCredentials = { ssid: "MaisonWifi", password: "pw", security: "WPA2-PSK" };

// acceptWifi resolves right after persist (fast-202 contract); the hotspot
// teardown + join continue in the background. Flush one event-loop turn to
// let the background transition finish before asserting its side effects.
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("provisioningService (state machine)", () => {
  it("boots normally when credentials are provisioned and the boot-v2 join succeeds", async () => {
    const platform = makePlatform();
    const service = createProvisioningService({ store: makeStore({ provisioned: true }), platform });

    expect(await service.begin()).toBeNull();
    expect(service.getState()).toBe("idle");
    expect(service.isProvisioning()).toBe(false);
    // Boot v2: the join is retried with the stored credentials.
    expect(platform.joinCalls).toHaveLength(1);
  });

  it("boot v2: a failed boot-v2 join returns the appliance to provisioning mode", async () => {
    const platform = makePlatform({ async joinWifi() { return false; } });
    const service = createProvisioningService({ store: makeStore({ provisioned: true }), platform });

    const result = await service.begin();

    // The Mobile must find the appliance again: hotspot (or LAN-direct) up.
    expect(result).toEqual({ hotspotSsid: expect.stringMatching(/^Liteforms-Setup-\d{4}$/), gatewayIp: "192.168.4.1" });
    expect(service.isProvisioning()).toBe(true);
  });

  it("starts the hotspot when not provisioned and reports gateway info", async () => {
    const platform = makePlatform();
    const service = createProvisioningService({ store: makeStore(), platform });

    const result = await service.begin();

    expect(result).toEqual({ hotspotSsid: expect.stringMatching(/^Liteforms-Setup-\d{4}$/), gatewayIp: "192.168.4.1" });
    expect(service.isProvisioning()).toBe(true);
    expect(platform.startCalls).toBe(1);
  });

  it("falls back to LAN-direct when the hotspot cannot start, still provisioning", async () => {
    const platform = makePlatform({ async startHotspot() { return null; } });
    const service = createProvisioningService({ store: makeStore(), platform });

    const result = await service.begin();

    expect(result).toEqual({ hotspotSsid: null, gatewayIp: null });
    expect(service.isProvisioning()).toBe(true);
  });

  it("persists credentials BEFORE stopping the hotspot, then joins the target", async () => {
    const events: string[] = [];
    const platform = makePlatform();
    const store = makeStore();
    const service = createProvisioningService({ store, platform, events: { onLog: (l) => events.push(l) } });
    await service.begin();

    const accepted = await service.acceptWifi(credentials);
    await flush();

    expect(accepted).toBe(true);
    expect(service.getState()).toBe("idle");
    // Order invariant: persist happens before hotspot stop.
    const persistIndex = events.findIndex((l) => l.includes("persisted"));
    const stopIndex = events.findIndex((l) => l.includes("hotspot stopped"));
    expect(persistIndex).toBeGreaterThanOrEqual(0);
    expect(stopIndex).toBeGreaterThan(persistIndex);
    expect(platform.joinCalls).toEqual([credentials]);
    expect(store.saved).toEqual([credentials]);
  });

  it("is idempotent: a second acceptWifi returns the same result without a new transition", async () => {
    const platform = makePlatform();
    const store = makeStore();
    const service: ProvisioningService = createProvisioningService({ store, platform });
    await service.begin();

    const [first, second] = await Promise.all([service.acceptWifi(credentials), service.acceptWifi(credentials)]);
    await flush();

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(store.saved).toHaveLength(1);
    expect(platform.stopCalls).toBe(1);
    expect(platform.joinCalls).toHaveLength(1);
  });

  it("stays in provisioning mode when persistence fails (hotspot kept up)", async () => {
    const platform = makePlatform();
    const store = makeStore();
    store.save = () => false;
    const service = createProvisioningService({ store, platform });
    await service.begin();

    expect(await service.acceptWifi(credentials)).toBe(false);
    expect(service.getState()).toBe("provisioning");
    expect(platform.stopCalls).toBe(0);
    expect(platform.joinCalls).toHaveLength(0);
  });

  it("keeps the saved credentials when the join fails (best effort)", async () => {
    const platform = makePlatform({ async joinWifi() { return false; } });
    const store = makeStore();
    const service = createProvisioningService({ store, platform });
    await service.begin();

    expect(await service.acceptWifi(credentials)).toBe(true);
    await flush();
    expect(store.saved).toHaveLength(1);
    // Boot v2 self-healing: a failed join must NOT boot normal after a
    // relaunch — the appliance stays reachable in provisioning mode.
    expect(service.getState()).toBe("provisioning");
    expect(service.isProvisioning()).toBe(true);
  });

  it("tracks the last join result for GET /api/provisioning/status", async () => {
    const platform = makePlatform();
    const service = createProvisioningService({ store: makeStore(), platform });
    await service.begin();

    // Before any acceptance: null (the route answers "joining").
    expect(service.getLastJoinResult()).toBeNull();

    await service.acceptWifi(credentials);
    // Transition running → joining.
    expect(service.getLastJoinResult()).toBe("joining");
    await flush();
    // Join ok → joined.
    expect(service.getLastJoinResult()).toBe("joined");
  });

  it("reports a failed join and re-arms a new acceptance (no dead hotspot)", async () => {
    const joinResults = [false, true];
    const platform = makePlatform({
      async joinWifi(c: unknown) {
        platform.joinCalls.push(c);
        return joinResults.shift() ?? true;
      }
    });
    const store = makeStore();
    const service = createProvisioningService({ store, platform });
    await service.begin();
    platform.joinCalls.length = 0; // discard the boot-v2 join

    expect(await service.acceptWifi(credentials)).toBe(true);
    await flush();

    expect(service.getLastJoinResult()).toBe("failed");
    expect(service.getState()).toBe("provisioning");
    // The hotspot is back up and a NEW transition is possible: the Mobile
    // redoes the flow without a relaunch.
    expect(platform.startCalls).toBe(2);
    expect(await service.acceptWifi(credentials)).toBe(true);
    await flush();
    expect(store.saved).toHaveLength(2); // the redo persisted new credentials
    expect(platform.joinCalls).toHaveLength(2);
    expect(service.getLastJoinResult()).toBe("joined");
  });

  it("stop tears the hotspot down and resets state", async () => {
    const platform = makePlatform();
    const service = createProvisioningService({ store: makeStore(), platform });
    await service.begin();

    await service.stop();

    expect(platform.stopCalls).toBe(1);
    expect(service.getState()).toBe("idle");
    expect(service.isProvisioning()).toBe(false);
  });

  it("emits state changes in order", async () => {
    const onStateChange = vi.fn();
    const service = createProvisioningService({ store: makeStore(), platform: makePlatform(), events: { onStateChange } });
    await service.begin();
    await service.acceptWifi(credentials);
    await flush();

    const states = onStateChange.mock.calls.map((call) => call[0]);
    expect(states).toEqual(["starting", "provisioning", "switching", "idle"]);
  });

  it("emits a provisioning return after a failed join (state order)", async () => {
    const onStateChange = vi.fn();
    const platform = makePlatform({ async joinWifi() { return false; } });
    const service = createProvisioningService({ store: makeStore(), platform, events: { onStateChange } });
    await service.begin();
    await service.acceptWifi(credentials);
    await flush();

    const states = onStateChange.mock.calls.map((call) => call[0]);
    expect(states).toEqual(["starting", "provisioning", "switching", "provisioning"]);
  });
});
