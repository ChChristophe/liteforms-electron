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

export type DiagnosticLog = (line: string) => void;

export function createProvisioningPlatform(
  platform: NodeJS.Platform = process.platform,
  log?: DiagnosticLog
): ProvisioningPlatform {
  if (platform === "win32") {
    return createWindowsProvisioning(JOIN_RETRY_DELAYS_MS, log);
  }
  return createLinuxProvisioning(JOIN_RETRY_DELAYS_MS, log);
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
// helper in production (polkit rule — see resources/linux/, installed by the
// golden image per PLAN §6.11, the AppImage cannot install system files).
// Privilege failures are detected via exit code + stderr (no secrets) and
// logged clearly so the appliance diagnostic points at the missing rule.
//
// Lessons transposed from the Windows field cycle (13/09/2026):
// 1. Force 2.4 GHz band — `nmcli device wifi hotspot` with Band=Auto can pick
//    5 GHz / DFS channels invisible to many phones → `band bg`.
// 2. Gateway IP: the hotspot connection defaults to ipv4.method=shared
//    (10.42.0.1/24) which breaks the contract announcing 192.168.4.1 → set
//    the explicit address 192.168.4.1/24, then DETECT the actually assigned
//    IP and return that, never an assumption.
// 3. Post-hotspot verification: connection must be active AND have an IP
//    before returning HotspotInfo, else null (LAN-direct fallback).
// 4. Join uses the same retry pattern as Windows (3 attempts, 0/3/6 s):
//    `connection up` right after `connection down Hotspot` can fail while
//    the interface is still in transition.
// ---------------------------------------------------------------------------
const HOTSPOT_CON = "Hotspot";
const HOTSPOT_GATEWAY_CIDR = "192.168.4.1/24";

// Exported for tests only (retry-delay injection), same as Windows.
export function createLinuxProvisioning(retryDelaysMs: readonly number[], log: DiagnosticLog = () => {}): ProvisioningPlatform {
  function logPrivilegeIssue(stderr: string) {
    if (/not authorized|access denied|not allowed|insufficient/i.test(stderr)) {
      log(`nmcli privilege failure — install the polkit rule from resources/linux/10-liteforms-network.rules on the appliance (PLAN §6.11); stderr: ${stderr.trim().slice(0, 200)}`);
    } else if (stderr.trim()) {
      log(`nmcli failure (stderr: ${stderr.trim().slice(0, 200)})`);
    }
  }

  // Reactivate the hotspot connection so modified properties apply
  // (ipv4/band changes on an active connection do not take effect until re-up).
  async function reapplyHotspot(): Promise<boolean> {
    await run("nmcli", ["connection", "down", HOTSPOT_CON]);
    const up = await run("nmcli", ["connection", "up", HOTSPOT_CON]);
    if (up.code !== 0) {
      logPrivilegeIssue(up.stderr);
      return false;
    }
    return true;
  }

  // Post-hotspot verification: active AND an IPv4 assigned. Returns the real
  // gateway address (prefix stripped), or null.
  async function detectHotspotState(): Promise<{ active: boolean; ip: string | null }> {
    const detail = await run("nmcli", [
      "-t", "-f", "GENERAL.STATE,IP4.ADDRESS1", "connection", "show", HOTSPOT_CON
    ]);
    if (detail.code !== 0) {
      return { active: false, ip: null };
    }
    let active = false;
    let ip: string | null = null;
    for (const line of detail.stdout.split("\n")) {
      const [field, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      if (/^GENERAL\.STATE$/i.test(field.trim())) {
        active = /^activated( |$)/i.test(value);
      } else if (/^IP4\.ADDRESS1$/i.test(field.trim()) && value) {
        ip = value.replace(/\/\d+$/, "");
      }
    }
    return { active, ip };
  }

  return {
    async startHotspot(ssid, passphrase) {
      // `band bg` forces 2.4 GHz (validated Windows lesson: Band=Auto → 5 GHz
      // invisible from phones). nmcli hotspot creates+activates connection
      // "Hotspot" with ipv4.method=shared (10.42.0.1/24).
      const result = await run("nmcli", [
        "device", "wifi", "hotspot",
        "ssid", ssid, "band", "bg", "password", passphrase
      ]);
      if (result.code !== 0) {
        logPrivilegeIssue(result.stderr);
        return null;
      }
      // Honor the contract: pin the hotspot gateway to 192.168.4.1/24 with a
      // manual (non-shared) ipv4 config, then reactivate to apply.
      const modify = await run("nmcli", [
        "connection", "modify", HOTSPOT_CON,
        "ipv4.method", "manual", "ipv4.addresses", HOTSPOT_GATEWAY_CIDR
      ]);
      if (modify.code === 0) {
        await reapplyHotspot();
      }
      // Return what is REALLY assigned, never an assumption: if the explicit
      // config failed the connection keeps 10.42.0.1 (or whatever nmcli chose)
      // and the user must enter that IP on the mobile side.
      const state = await detectHotspotState();
      if (!state.active || !state.ip) {
        log("hotspot verification failed (connection not active or no IPv4) — falling back to LAN-direct");
        return null;
      }
      return { ssid, gatewayIp: state.ip };
    },

    async stopHotspot() {
      // Turning the hotspot connection down releases the AP interface.
      await run("nmcli", ["connection", "down", HOTSPOT_CON]);
    },

    async joinWifi({ ssid, password, security }) {
      const keyMgmt = security === "OPEN" ? "none" : "sae";
      const addArgs = [
        "connection", "add", "type", "wifi", "con-name", ssid, "ssid", ssid,
        "wifi-sec.key-mgmt", keyMgmt,
        ...(keyMgmt === "none" ? [] : ["wifi-sec.psk", password])
      ];
      // Up to 3 attempts (0s/3s/6s): the interface may still be transitioning
      // right after `connection down Hotspot` (same anti-pattern as the
      // Windows WLAN stack, validated 13/09/2026). Replays whole: a failed
      // `add` may mean the connection already exists — keep going to `up`.
      for (const delayMs of retryDelaysMs) {
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        await run("nmcli", addArgs);
        const up = await run("nmcli", ["connection", "up", ssid], 30000);
        if (up.code === 0) {
          return true;
        }
        logPrivilegeIssue(up.stderr);
      }
      return false;
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
const JOIN_RETRY_DELAYS_MS = [0, 5000, 10000, 15000] as const;

// Exported for tests only (retry-delay injection).
export function createWindowsProvisioning(
  retryDelaysMs: readonly number[] = JOIN_RETRY_DELAYS_MS,
  log: DiagnosticLog = () => {}
): ProvisioningPlatform {
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
      // Up to 4 attempts (0s/5s/10s/15s): after StopTetheringAsync the WLAN
      // stack needs time to release the adapter — ground data 13/09: a join
      // that succeeds manually minutes later still failed through all three
      // 0/3/6 s retries right after the hotspot stop. The script also WAITS
      // for the association to actually complete (`netsh wlan connect` only
      // queues the request; exit 0 never meant "connected").
      for (const delayMs of retryDelaysMs) {
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        const result = await run("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        `$p = Join-Path $env:TEMP ("wlan-" + [guid]::NewGuid().ToString() + ".xml"); ` +
        `Set-Content -Path $p -Value @'\n${profileXml}\n'@ -Encoding UTF8; ` +
        // user=current: the packaged app runs unelevated; "user=all" needs
        // admin and would fail on a stock Windows 11 install. A per-user
        // profile is enough — the provisioning session runs as that user.
        `$add = netsh wlan add profile filename="$p" user=current 2>&1 | Out-String; ` +
        `$addExit = $LASTEXITCODE; ` +
        `Remove-Item -Force $p -ErrorAction SilentlyContinue; ` +
        `if ($addExit -ne 0) { Write-Output "ADD_FAILED"; exit 0 } ` +
        // Location permission (Windows 11): netsh wlan connect needs WLAN read
        // access — without it the OS returns error 5; we surface that as a
        // plain failure marker (never the reason string, it may embed the SSID).
        `$conn = netsh wlan connect name="${escapeXml(ssid)}" 2>&1 | Out-String; ` +
        `if ($LASTEXITCODE -ne 0) { Write-Output "CONNECT_FAILED"; exit 0 } ` +
        // Wait for the association to complete (connect is asynchronous):
        // poll the interface state for up to 12 s; success = our SSID shows
        // as connected. Anything else (still searching, wrong network,
        // auth failure) is reported as NOT_CONNECTED for the retry loop.
        `$joined = $false; ` +
        `for ($i = 0; $i -lt 12; $i++) { ` +
        `Start-Sleep -Seconds 1; ` +
        `$state = netsh wlan show interfaces 2>&1 | Out-String; ` +
        `if ($state -match '(?m)^\\s*SSID\\s+:\\s+\\S+') { $joined = $true; break } ` +
        `}; ` +
        `if (-not $joined) { Write-Output "NOT_CONNECTED"; exit 0 } ` +
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

// ---------------------------------------------------------------------------
// Firewall automation (chantier A) — ports 8080 (provisioning) + 43178
// (device API). Windows production path: the NSIS installer creates the
// rules (build/installer.nsh). These app-side helpers only cover the
// no-installer case (win-unpacked) on Windows and ufw on Linux; they never
// silently elevate (no UAC prompt at appliance boot — unacceptable) and on
// failure they log the exact instruction the appliance owner/runbook runs.
// ---------------------------------------------------------------------------
export const PROVISIONING_FIREWALL_PORTS = [8080, 43178] as const;
const FIREWALL_RULE_NAMES: Record<number, string> = {
  8080: "Liteforms Provisioning Server",
  43178: "Liteforms Device API"
};

export async function ensureWindowsFirewallPorts(log: DiagnosticLog = () => {}): Promise<boolean> {
  let allOk = true;
  for (const port of PROVISIONING_FIREWALL_PORTS) {
    const result = await run("netsh", [
      "advfirewall", "firewall", "add", "rule",
      `name=${FIREWALL_RULE_NAMES[port]}`, "dir=in", "action=allow",
      "protocol=TCP", `localport=${port}`
    ]);
    if (result.code === 0) {
      log(`firewall :: inbound rule added for tcp ${port}`);
    } else {
      // Usually admin-required (win-unpacked launched non-elevated).
      log(`firewall :: could not add rule for tcp ${port} (code ${result.code}). Run as admin: netsh advfirewall firewall add rule name="${FIREWALL_RULE_NAMES[port]}" dir=in action=allow protocol=TCP localport=${port}`);
      allOk = false;
    }
  }
  return allOk;
}

export async function ensureLinuxFirewallPorts(log: DiagnosticLog = () => {}): Promise<boolean> {
  const status = await run("ufw", ["status"]);
  if (status.code !== 0 || !/status:\s*active/i.test(status.stdout)) {
    // ufw absent or inactive: nothing to open.
    return true;
  }
  let allOk = true;
  for (const port of PROVISIONING_FIREWALL_PORTS) {
    const allow = await run("ufw", ["allow", `${port}/tcp`]);
    if (allow.code === 0) {
      log(`firewall :: ufw port tcp ${port} opened`);
    } else {
      // ufw requires root; the appliance golden image should bake these rules
      // in (PLAN §6.11) — squelch stderr (no secrets, but keep it out of logs).
      log(`firewall :: ufw refused tcp ${port} (needs root). Run on the appliance: sudo ufw allow ${port}/tcp`);
      allOk = false;
    }
  }
  return allOk;
}
