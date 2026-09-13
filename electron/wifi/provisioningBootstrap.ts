// Boot-time wiring of the provisioning flow (called from electron/main.ts).
// State machine: provisioned (wifi-credentials.json exists) -> normal boot;
// otherwise provisioning mode: hotspot (or Windows LAN-direct fallback) +
// provisioning HTTP server on the configured port. The mode ends after an
// accepted WiFi: credentials persisted FIRST, then hotspot down, join target.
import { app, safeStorage } from "electron";
import { mkdirSync } from "node:fs";
import { resolveProvisioningPort } from "./wifiConfig";
import { createProvisioningPlatform, ensureLinuxFirewallPorts, ensureWindowsFirewallPorts } from "./provisioningPlatform";
import { createProvisioningService, type ProvisioningService } from "./provisioningService";
import { createProvisioningServer, DEFAULT_PROVISIONING_PORT } from "./provisioningServer";
import { createWifiCredentialsStore, resolveWifiCredentialsPath } from "./wifiCredentialsStore";

export type ProvisioningBootstrap = {
  service: ProvisioningService;
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
  const server = createProvisioningServer(service, { deviceId: "desktop", log: writeDiagnostic });

  // Contract answer `restartRequired: true`: after an accepted WiFi the
  // appliance closes the provisioning routes (contract invariant: they exist
  // ONLY in provisioning mode), relaunches — next boot sees the stored
  // credentials and boots normally (hotspot gone, Next networkMode=wifi).
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
        await service.transition;
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
    async dispose() {
      await server.close();
      await service.stop();
    }
  };
}

export { DEFAULT_PROVISIONING_PORT };
