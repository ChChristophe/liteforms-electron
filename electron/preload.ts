import { contextBridge, ipcRenderer } from "electron";

const nativeBridgeGetStateChannel = "liteforms:nativeBridge:getState";
const nativeBridgeGetDriverStatusChannel = "liteforms:nativeBridge:getDriverStatus";
const diagnosticLogChannel = "liteforms:diagnostic:log";
const preloadLoadedChannel = "liteforms:preload:loaded";

// Report back to the main process that the preload actually ran in this window,
// so we can diagnose cases where the preload silently fails to load (sandbox,
// asar path, etc). This fires as soon as the script loads.
try {
  void ipcRenderer
    .invoke(preloadLoadedChannel, {
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "no-navigator",
      origin: typeof location !== "undefined" ? location.origin : "no-location",
      preload: "preload.ts ran"
    })
    .catch(() => {
      /* main may not have registered the handler at first-load; ignore */
    });
} catch {
  /* ignore */
}

const liteformsElectron = Object.freeze({
  isElectron: true,
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node
  },
  lookingGlassBridge: {
    getDriverStatus: () => ipcRenderer.invoke(nativeBridgeGetDriverStatusChannel),
    getState: () => ipcRenderer.invoke(nativeBridgeGetStateChannel)
  },
  diagnostic: {
    log: (line: string) => ipcRenderer.invoke(diagnosticLogChannel, line)
  }
});

contextBridge.exposeInMainWorld("liteformsElectron", liteformsElectron);
