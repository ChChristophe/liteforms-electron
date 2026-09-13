// Boot-time wiring of the provisioning flow (called from electron/main.ts).
// State machine: no credentials → provisioning mode; credentials present →
// boot-v2 join attempt (succeeded → normal boot, failed → provisioning mode:
// hotspot or Windows LAN-direct fallback) + provisioning HTTP server on the
// configured port. The mode ends after an accepted WiFi whose join succeeds:
// credentials persisted FIRST, then hotspot down, join target. A failed join
// keeps the appliance in provisioning mode (no relaunch, no re-provision loop).
import { app, safeStorage } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveProvisioningPort } from "./wifiConfig";
import { createProvisioningPlatform, ensureLinuxFirewallPorts, ensureWindowsFirewallPorts } from "./provisioningPlatform";
import { createProvisioningService, type ProvisioningService } from "./provisioningService";
import { createProvisioningServer, DEFAULT_PROVISIONING_PORT } from "./provisioningServer";
import { readOrCreateDeviceId, resolveDeviceIdPath } from "./deviceId";
import { createWifiCredentialsStore, resolveWifiCredentialsPath } from "./wifiCredentialsStore";

export type ProvisioningBootstrap = {
  service: ProvisioningService;
  /** Persistent appliance identity (desktop-<4 hex>), null when the disk
   * refused it — health routes then stay valid without the additive field. */
  deviceId: string | null;
  dispose(): Promise<void>;
};

type DiagnosticWriter = (line: string) => void;

function configDirPath(): string {
  try {
    return app.getPath("userData");
  } catch {
    return ".";
  }
}

export async function bootstrapProvisioning(writeDiagnostic: DiagnosticWriter): Promise<ProvisioningBootstrap> {
  const configDir = configDirPath();
  try {
    mkdirSync(configDir, { recursive: true });
  } catch {
    // Already existing or unwritable: the store will surface it.
  }
  // <userData>/config/ — the dir holding device-config.json and device-id.json
  // (protocol §Identité). The wifi-credentials store predates it and lives one
  // level up; left in place (moving it would orphan field installations).
  const durableConfigDir = join(configDir, "config");
  try {
    mkdirSync(durableConfigDir, { recursive: true });
  } catch {
    // main.ts also creates it; the deviceId read below tolerates absence.
  }

  const store = createWifiCredentialsStore(resolveWifiCredentialsPath(configDir), safeStorage);
  // The platform gets the diagnostic writer so nmcli/netsh privilege failures
  // surface in the appliance diagnostic log (no secrets, exit code + stderr).
  const platform = createProvisioningPlatform(process.platform, writeDiagnostic);
  const service = createProvisioningService({
    store,
    platform,
    events: { onLog: writeDiagnostic }
  });
  // Firewall ports (chantier A, no-installer case): best effort, never
  // elevates. On Windows production the NSIS installer creates the rules
  // (build/installer.nsh); win-unpacked runs hit the admin-required path and
  // the diagnostic carries the exact instruction instead of a UAC prompt.
  void (process.platform === "win32" ? ensureWindowsFirewallPorts(writeDiagnostic) : ensureLinuxFirewallPorts(writeDiagnostic));
  // Persistent identity (protocol §Identité de l'appliance): generated once
  // in <userData>/config/ (same dir as device-config.json), corrupt file =
  // regenerated, never a crash. Non-secret: announced in health/status so the
  // Mobile re-matches the appliance after the network transition.
  const deviceId = readOrCreateDeviceId(resolveDeviceIdPath(durableConfigDir));
  writeDiagnostic(`provisioning :: deviceId=${deviceId ?? "unavailable (storage failure)"}`);
  const server = createProvisioningServer(service, { deviceId: deviceId ?? "desktop", log: writeDiagnostic });

  // Contract answer `restartRequired: true`: after an accepted WiFi with a
  // SUCCESSFUL join, the appliance closes the provisioning routes (contract
  // invariant: they exist ONLY in provisioning mode) and relaunches — next
  // boot re-runs the boot-v2 join with the stored credentials and boots
  // normally (hotspot gone, Next networkMode=wifi). On a FAILED join the
  // transition resolves false and NO relaunch happens: the appliance stays in
  // provisioning mode (hotspot re-raised by the service) so the Mobile can
  // redo the flow — a relaunch here would boot a stuck-on-Ethernet appliance
  // into a loop.
  // The relaunch MUST wait for the full accept transition (stop hotspot +
  // join target): the 202 resolves at persistence time (fast contract
  // answer) but killing the app earlier aborts the join mid-flight —
  // validated on the ground 13/09/2026 (join never ran, appliance stayed
  // off the target WiFi).
  const originalAccept = service.acceptWifi.bind(service);
  service.acceptWifi = async (credentials) => {
    const accepted = await originalAccept(credentials);
    if (accepted) {
      writeDiagnostic("provisioning :: accepted — waiting for network transition before relaunch");
      void (async () => {
        const joined = await service.transition;
        if (!joined) {
          writeDiagnostic("provisioning :: transition join failed — staying in provisioning mode (no relaunch)");
          return;
        }
        await server.close();
        writeDiagnostic("provisioning :: transition complete — relaunching into normal mode");
        app.relaunch();
        app.exit(0);
      })();
    }
    return accepted;
  };

  const boot = await service.begin();
  if (boot) {
    // Provisioning mode: bind the provisioning server. On the hotspot gateway
    // IP when the hotspot is up; on all interfaces in LAN-direct fallback
    // (the appliance is already on the home WiFi — same trusted-LAN rules as
    // the POC-validated flow).
    const bindIp = boot.gatewayIp ?? "0.0.0.0";
    const port = resolveProvisioningPort();
    try {
      await server.start(bindIp, port);
    } catch (error) {
      // Fallback port hop: the configured port is taken (rare on an
      // appliance); serve on an ephemeral port so provisioning still works.
      writeDiagnostic(`provisioning :: bind ${bindIp}:${port} failed (${String(error)}), trying ephemeral port`);
      try {
        await server.start(bindIp, 0);
      } catch (startError) {
        writeDiagnostic(`provisioning :: server start failed (${String(startError)}), giving up provisioning mode`);
        await service.stop();
      }
    }
  }

  return {
    service,
    deviceId,
    async dispose() {
      await server.close();
      await service.stop();
    }
  };
}

export { DEFAULT_PROVISIONING_PORT };
