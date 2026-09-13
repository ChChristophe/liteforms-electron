// Canonical source lives in electron/wifi/wifiConfig.ts (the main-process
// build compiles electron/ only — rootDir constraint). Next routes import
// from here. Pure isomorphic module: no Electron import anywhere.
export {
  isWifiSecurity,
  parseNetworkMode,
  parseWifiCredentials,
  resolveProvisioningPort,
  WIFI_SECURITY_VALUES
} from "../../electron/wifi/wifiConfig";
export type { NetworkMode, WifiCredentials, WifiSecurity } from "../../electron/wifi/wifiConfig";
