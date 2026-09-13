// Platform abstraction for the provisioning WiFi flow (PLAN_DIRECTEUR.md §6.2,
// decision 13/09/2026: Linux = production target, Windows = functional now).
// One interface, two implementations — no platform `if`s in the provisioning
// service or routes.
//
// Secrets rule: `joinWifi` receives the plaintext password only in-memory to
// hand to the OS; implementations must never log it and never include it in
// an error message (errors carry exit codes / command names only).
import { spawn } from "node:child_process";

export type HotspotInfo = {
  /** SSID broadcast by the hotspot (Liteforms-Setup-XXXX on Linux, ICS name on Windows). */
  ssid: string;
  /** Gateway IP the provisioning server must bind on (192.168.4.1 Linux, 192.168.137.1 Windows ICS). */
  gatewayIp: string;
};

export type ProvisioningPlatform = {
  /** Start the hotspot. Returns false when the adapter/OS cannot (caller falls back to LAN-direct mode). */
  startHotspot(ssid: string, passphrase: string): Promise<HotspotInfo | null>;
  stopHotspot(): Promise<void>;
  /** Join the target WiFi. Best effort — the appliance may end up on Ethernet. */
  joinWifi(credentials: { ssid: string; password: string; security: string }): Promise<boolean>;
};

export function isWindows(): boolean {
  return process.platform === "win32";
}

export function createProvisioningPlatform(platform: NodeJS.Platform = process.platform): ProvisioningPlatform {
  if (platform === "win32") {
    return createWindowsProvisioning();
  }
  return createLinuxProvisioning();
}

function run(command: string, args: string[], timeoutMs = 15000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (code: number) => {
      if (!settled) {
        settled = true;
        resolve({ code, stdout, stderr });
      }
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(124);
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", () => {
      clearTimeout(timer);
      finish(127);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code ?? 1);
    });
  });
}

// ---------------------------------------------------------------------------
// Linux (production target): NetworkManager via nmcli. Requires a privileged
// helper in production (polkit rule or systemd service — PLAN §6.2); the
// direct nmcli calls below are the correct command surface for that helper.
// ---------------------------------------------------------------------------
function createLinuxProvisioning(): ProvisioningPlatform {
  return {
    async startHotspot(ssid, passphrase) {
      // `nmcli device wifi hotspot ssid <ssid> password <pw>` assigns
      // 192.168.4.1/24 to the hotspot interface by default.
      const result = await run("nmcli", ["device", "wifi", "hotspot", "ssid", ssid, "password", passphrase]);
      if (result.code !== 0) {
        return null;
      }
      return { ssid, gatewayIp: "192.168.4.1" };
    },

    async stopHotspot() {
      // Turning the hotspot connection down releases the AP interface.
      await run("nmcli", ["connection", "down", "Hotspot"]);
    },

    async joinWifi({ ssid, password, security }) {
      const keyMgmt = security === "OPEN" ? "none" : "sae";
      const add = await run("nmcli", [
        "connection", "add", "type", "wifi", "con-name", ssid, "ssid", ssid,
        "wifi-sec.key-mgmt", keyMgmt,
        ...(keyMgmt === "none" ? [] : ["wifi-sec.psk", password])
      ]);
      if (add.code !== 0) {
        return false;
      }
      const up = await run("nmcli", ["connection", "up", ssid], 30000);
      return up.code === 0;
    }
  };
}

// ---------------------------------------------------------------------------
// Windows (functional now): Mobile Hotspot via the WinRT
// NetworkOperatorTetheringManager projected from PowerShell (PLAN §6.2 —
// `netsh wlan hostednetwork` is dead on modern drivers). Subnet ICS
// 192.168.137.1/24. Joining the target WiFi uses a generated WLAN profile +
// `netsh wlan connect` (most reliable documented path).
//
// WinRT async pattern (validated on the ground 13/09/2026): IAsyncOperation
// objects are __ComObject in PS 5.1 — `.GetAwaiter()` does NOT exist. The
// working pattern is the System.Runtime.WindowsRuntime AsTask projection,
// matched by parameter type name 'IAsyncOperation`1' (backtick needs single
// quotes in PS).
// ---------------------------------------------------------------------------
const winrtAwaitHelper = [
  "Add-Type -AssemblyName System.Runtime.WindowsRuntime;",
  "$asTaskOp = ([System.WindowsRuntimeSystemExtensions].GetMethods() |",
  "  Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0];",
  "function Await($op, $resultType) {",
  "  $netTask = $asTaskOp.MakeGenericMethod($resultType).Invoke($null, @($op));",
  "  $netTask.Wait(-1) | Out-Null;",
  "  return $netTask.Result;",
  "}"
].join("\n");

const winrtStartScript = `
${winrtAwaitHelper}
$connectionProfile = [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]::GetInternetConnectionProfile()
if (-not $connectionProfile) { Write-Output "NO_PROFILE"; exit 0 }
$tethering = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::CreateFromConnectionProfile($connectionProfile)
$config = $tethering.GetCurrentAccessPointConfiguration()
$config.Ssid = "__SSID__"
$config.Passphrase = "__PASSPHRASE__"
# Force 2.4 GHz: Band=Auto on some adapters (e.g. Intel AX200) picks 5 GHz /
# DFS channels that many phones never display. 2.4 GHz is the compatible
# choice for a provisioning SSID. Enum value set numerically: the WinRT enum
# type name is not projectable in PS 5.1 (validated 13/09/2026).
$config.Band = 1
try {
  Await ($tethering.ConfigureAccessPointAsync($config)) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringAccessPointConfiguration]) | Out-Null
} catch {
  # ConfigureAccessPointAsync projection can fail on some builds even when the
  # configuration is applied; StartTetheringAsync below is the real gate.
  Write-Output "CONFIG_WARN";
}
$operation = $tethering.StartTetheringAsync()
$result = Await $operation ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
Write-Output ("STATUS=" + $result.Status)
`;

const winrtStopScript = `
${winrtAwaitHelper}
$connectionProfile = [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]::GetInternetConnectionProfile()
if (-not $connectionProfile) { Write-Output "NO_PROFILE"; exit 0 }
$tethering = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::CreateFromConnectionProfile($connectionProfile)
$operation = $tethering.StopTetheringAsync()
$result = Await $operation ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
Write-Output ("STATUS=" + $result.Status)
`;

// Field-validated 13/09/2026: `netsh wlan connect` fires ~0.5 s after the
// hotspot stops and the WLAN stack hasn't released the adapter yet
// (CONNECT_FAILED while the profile is correct). Retry the whole script:
// the `add` is idempotent (overwrites the profile) so replaying add+connect
// is simpler than persisting add-success across attempts.
const JOIN_RETRY_DELAYS_MS = [0, 3000, 6000] as const;

// Exported for tests only (retry-delay injection).
export function createWindowsProvisioning(retryDelaysMs: readonly number[] = JOIN_RETRY_DELAYS_MS): ProvisioningPlatform {
  return {
    async startHotspot(ssid, passphrase) {
      const script = winrtStartScript
        .replace("__SSID__", ssid)
        .replace("__PASSPHRASE__", passphrase);
      const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 45000);
      // If tethering is unavailable (adapter without Wi-Fi Direct support, no
      // internet profile) we return null and the caller falls back to
      // LAN-direct provisioning.
      if (result.code !== 0 || !result.stdout.includes("STATUS=Success")) {
        return null;
      }
      // Default ICS subnet of Windows Mobile Hotspot.
      return { ssid, gatewayIp: "192.168.137.1" };
    },

    async stopHotspot() {
      await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", winrtStopScript], 45000);
    },

    async joinWifi({ ssid, password, security }) {
      // Generate a WLAN profile XML and register it, then connect. The
      // password goes into the profile file only (never logged, never in an
      // error message), and the file is deleted right after registration.
      // Schema note (validated on the ground 13/09/2026): the element order is
      // enforced by Windows — name, SSIDConfig, connectionType (REQUIRED,
      // otherwise "profile format error 0x80001"), connectionMode, MSM.
      const auth = security === "OPEN" ? "open" : (security === "WPA3-SAE" ? "SAE" : "WPA2PSK");
      const encryption = security === "OPEN" ? "none" : "AES";
      const hexSsid = Buffer.from(ssid, "utf8").toString("hex").toUpperCase();
      const profileXml = [
        `<?xml version="1.0"?>`,
        `<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">`,
        `<name>${escapeXml(ssid)}</name>`,
        `<SSIDConfig><SSID><hex>${hexSsid}</hex><name>${escapeXml(ssid)}</name></SSID></SSIDConfig>`,
        `<connectionType>ESS</connectionType>`,
        `<connectionMode>auto</connectionMode>`,
        `<MSM><security>`,
        `<authEncryption><authentication>${auth}</authentication><encryption>${encryption}</encryption><useOneX>false</useOneX></authEncryption>`,
        security === "OPEN"
          ? ""
          : `<sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>${escapeXml(password)}</keyMaterial></sharedKey>`,
        `</security></MSM>`,
        `</WLANProfile>`
      ].join("");
      // Up to 3 attempts (0s/3s/6s): a real adapter needs a few seconds after
      // stopHotspot() before it accepts a connect. First OK wins; the script
      // replays whole (the `add` is idempotent — see JOIN_RETRY_DELAYS_MS note).
      for (const delayMs of retryDelaysMs) {
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        const result = await run("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        `$p = Join-Path $env:TEMP ("wlan-" + [guid]::NewGuid().ToString() + ".xml"); ` +
        `Set-Content -Path $p -Value @'\n${profileXml}\n'@ -Encoding UTF8; ` +
        `$add = netsh wlan add profile filename="$p" user=all 2>&1 | Out-String; ` +
        `$addExit = $LASTEXITCODE; ` +
        `Remove-Item -Force $p -ErrorAction SilentlyContinue; ` +
        `if ($addExit -ne 0) { Write-Output "ADD_FAILED"; exit 0 } ` +
        // Location permission (Windows 11): netsh wlan connect needs WLAN read
        // access — without it the OS returns error 5; we surface that as a
        // plain failure marker (never the reason string, it may embed the SSID).
        `$conn = netsh wlan connect name="${escapeXml(ssid)}" 2>&1 | Out-String; ` +
        `if ($LASTEXITCODE -ne 0) { Write-Output "CONNECT_FAILED"; exit 0 } ` +
        `Write-Output "OK"`
        ], 45000);
        if (result.stdout.includes("OK")) {
          return true;
        }
      }
      return false;
    }
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
