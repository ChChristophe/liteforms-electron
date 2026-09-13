// Integration check: run the REAL compiled provisioningPlatform start/stop
// against the real Windows WinRT tethering stack (no Electron import needed).
const { createProvisioningPlatform } = require("../dist-electron/wifi/provisioningPlatform.js");

(async () => {
  const platform = createProvisioningPlatform("win32");
  console.log("[test] startHotspot Liteforms-Setup-9876 ...");
  const hotspot = await platform.startHotspot("Liteforms-Setup-9876", "liteforms-e2e-9876");
  console.log("[test] startHotspot result:", JSON.stringify(hotspot));
  if (hotspot) {
    await new Promise((r) => setTimeout(r, 2000));
    console.log("[test] stopHotspot ...");
    await platform.stopHotspot();
    console.log("[test] stopHotspot done");
  }
  // joinWifi against a non-existent network: must fail cleanly (false), no throw.
  const joined = await platform.joinWifi({ ssid: "No-Such-Network-ZZ", password: "x".repeat(8), security: "WPA2-PSK" });
  console.log("[test] joinWifi (nonexistent) result:", joined, "(expected false, clean failure)");
  process.exit(0);
})().catch((err) => {
  console.error("[test] FAILED:", err);
  process.exit(1);
});
