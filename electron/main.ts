import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerSaveBlocker, shell, Tray } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { registerNativeBridgeIpc } from "./nativeBridge";
import { createNextServerEnv, getAvailablePort, resolveStandaloneDir, waitForHttpServer } from "./nextServer";
import { isExternalUrl, resolveWindowOpenRequest } from "./windowOpenPolicy";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let nextServerProcess: ChildProcess | null = null;
let appUrl: string | null = null;
let lastWindowBounds: Electron.Rectangle | null = null;
let windowHiddenForBackground = false;
const nativeBridgeService = registerNativeBridgeIpc(ipcMain);

// Prevent Chromium from throttling requestAnimationFrame / rendering in the
// renderer when the window is minimized or occluded. `backgroundThrottling:false`
// alone is NOT enough: a minimized window still gets heavily throttled
// (rAF drops to ~1fps), which stutters the hologram/eye-blink animation on the
// Looking Glass even though the GPU is idle. These Chromium switches disable that
// background throttling at the compositor/renderer level.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
// Keep timers and, crucially, the AudioContext running when the page is hidden
// (minimized). Without this, Chromium suspends the AudioContext for hidden pages,
// which cuts/stutters the avatar voice and mic capture, and throttles setInterval
// based timing drifts for lip-sync.
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-background-media-suspend");

async function resolveAppUrl() {
  const devServerUrl = process.env.LITEFORMS_ELECTRON_DEV_SERVER_URL;
  if (devServerUrl) {
    return devServerUrl;
  }

  return await startPackagedNextServer();
}

async function startPackagedNextServer() {
  const standaloneDir = resolveStandaloneDir({
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath
  });
  const serverPath = join(standaloneDir, "server.js");

  if (!existsSync(serverPath)) {
    throw new Error(
      `Missing packaged Next standalone server at ${serverPath}. Run npm run build:electron before launching Electron.`
    );
  }

  const port = await getAvailablePort();
  const url = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [serverPath], {
    cwd: standaloneDir,
    env: createNextServerEnv({ port }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  nextServerProcess = child;

  child.stdout?.on("data", (chunk) => {
    console.log(`[next] ${chunk.toString().trim()}`);
  });
  child.stderr?.on("data", (chunk) => {
    console.error(`[next] ${chunk.toString().trim()}`);
  });
  child.on("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM") {
      console.error(`Packaged Next server exited with code ${code ?? "null"} and signal ${signal ?? "null"}.`);
    }
  });

  await waitForHttpServer(url);
  return url;
}

// A real Windows minimize makes the page "hidden" (document.hidden === true),
// which makes Chromium drop the renderer to ~1fps and suspend the AudioContext —
// stuttering the hologram even though the GPU is idle. We can't override that
// with switches. Instead, when the user minimizes we convert it into an
// off-screen "visible" window so the WebContents keeps rendering and audio keeps
// flowing, and expose a tray icon to bring it back.
function wireTrayRestoreBehavior(win: BrowserWindow) {
  win.on("minimize", () => {
    if (windowHiddenForBackground) return;
    // Cancel the real minimize, then park the window off-screen (still
    // non-minimized/visible to Chromium). Also hide its taskbar button so the
    // window lives only in the system tray until the logo is clicked.
    win.restore();
    windowHiddenForBackground = true;
    lastWindowBounds = win.getNormalBounds();
    win.setBounds({ x: -32000, y: -32000, width: 1, height: 1 });
    win.setOpacity(0);
    win.setSkipTaskbar(true);
  });

  win.on("close", () => {
    // Re-raise the background flag so a recreated window starts fresh.
    windowHiddenForBackground = false;
  });
}

function ensureTray() {
  if (tray) return;
  tray = new Tray(resolveTrayIcon());
  tray.setToolTip("Liteforms");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Afficher Liteforms",
        click: () => showMainWindow()
      },
      {
        label: "Quitter",
        click: () => {
          app.quit();
        }
      }
    ])
  );
  tray.on("click", () => showMainWindow());
}

function resolveTrayIcon() {
  // Load the app logo so the tray entry is visible. Look for the generated
  // multi-size .ico first (crisp at every scale), then the 32px PNG, then fall
  // back to a tiny green dot if the assets are missing (e.g. a raw checkout).
  const candidates = [
    join(app.getAppPath(), "resources", "icon.ico"),
    join(app.getAppPath(), "resources", "icon-32.png")
  ];
  for (const candidate of candidates) {
    try {
      const image = nativeImage.createFromPath(candidate);
      if (!image.isEmpty()) return image;
    } catch {
      // try next candidate
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="3" fill="#22c55e"/></svg>`;
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  return icon;
}

function showMainWindow() {
  const win = mainWindow;
  if (!win) return;
  if (win.isDestroyed()) return;
  if (windowHiddenForBackground) {
    if (lastWindowBounds) {
      win.setBounds(lastWindowBounds);
    } else {
      win.restore();
    }
    win.setOpacity(1);
    win.setSkipTaskbar(false);
    windowHiddenForBackground = false;
  }
  win.show();
  win.focus();
}

function createWindow(url: string) {
  const allowedOrigin = new URL(url).origin;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: true,
    title: "Liteforms",
    autoHideMenuBar: true,
    backgroundColor: "#080808",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.js"),
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      // Keep the WebGL/hologram animation running even when the window is in the
      // background, minimized or on another desktop. Chromium otherwise pauses
      // requestAnimationFrame (via `renderer.setAnimationLoop`) for hidden pages,
      // which freezes the avatar/hologram.
      backgroundThrottling: false
    }
  });

  // See hideWindowForBackgroundRendering below.
  wireTrayRestoreBehavior(mainWindow);

  mainWindow.webContents.setWindowOpenHandler((details) => {
    const decision = resolveWindowOpenRequest(details, allowedOrigin);
    if (decision.externalUrl) {
      void shell.openExternal(decision.externalUrl);
    }
    return decision.response;
  });

  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isExternalUrl(targetUrl, allowedOrigin)) {
      return;
    }
    event.preventDefault();
    void shell.openExternal(targetUrl);
  });

  void mainWindow.loadURL(url);
}

function stopNextServer() {
  if (nextServerProcess && !nextServerProcess.killed) {
    nextServerProcess.kill();
  }
  nextServerProcess = null;
}

app.whenReady().then(async () => {
  if (process.platform === "win32") {
    app.setAppUserModelId("org.liteforms.web");
  }

  // Prevent the OS from suspending the app while the hologram is animating, so
  // the animation keeps refreshing even if the window is in the background.
  powerSaveBlocker.start("prevent-app-suspension");

  Menu.setApplicationMenu(null);

  appUrl = await resolveAppUrl();
  createWindow(appUrl);
  ensureTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && appUrl) {
      createWindow(appUrl);
      ensureTray();
    }
  });
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("before-quit", () => {
  stopNextServer();
  nativeBridgeService.dispose();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});