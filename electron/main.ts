import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerSaveBlocker, screen, shell, Tray } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, appendFileSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerNativeBridgeIpc } from "./nativeBridge";
import { redactDiagnosticLine } from "./diagnosticRedact";
import { createNextServerEnv, isHttpServerUp, LITEFORMS_SERVER_PORT, resolveServerHost, resolveStandaloneDir, waitForHttpServer } from "./nextServer";
import { hologramWindowBrowserOptions, isExternalUrl, isHologramWindowOpenRequest, resolveWindowOpenRequest } from "./windowOpenPolicy";

const diagnosticLogChannel = "liteforms:diagnostic:log";
const preloadLoadedChannel = "liteforms:preload:loaded";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let nextServerProcess: ChildProcess | null = null;
let appUrl: string | null = null;
let lastWindowBounds: Electron.Rectangle | null = null;
let windowHiddenForBackground = false;
let powerSaveBlockerId: number | null = null;
const wiredDiagnosticsWindows = new WeakSet<BrowserWindow>();
const maxDiagnosticLogBytes = 5 * 1024 * 1024;
const nativeBridgeService = registerNativeBridgeIpc(ipcMain, writeDiagnostic);

function diagnosticLogPath(): string {
  try {
    return join(app.getPath("userData"), "liteforms-diagnostic.log");
  } catch {
    return "liteforms-diagnostic.log";
  }
}

// POC Phase C (POC.md §5.2/§6.2): local VRM library where the user drops .vrm
// files by hand. Forwarded to the Next server via LITEFORMS_VRM_LIBRARY_DIR.
function vrmLibraryPath(): string {
  try {
    return join(app.getPath("userData"), "vrm-library");
  } catch {
    return "vrm-library";
  }
}

// Durable device-config folder (POC.md §13.4): <userData>/config/ holds the
// device-config.json written by the Next server. Forwarded the same way as
// the VRM library, via LITEFORMS_DEVICE_CONFIG_DIR.
function deviceConfigDirPath(): string {
  try {
    return join(app.getPath("userData"), "config");
  } catch {
    return "config";
  }
}

function writeDiagnostic(line: string): void {
  try {
    const path = diagnosticLogPath();
    // Bound the log: rotate to <path>.old instead of growing without limit on
    // long-lived appliance installs.
    try {
      if (statSync(path).size > maxDiagnosticLogBytes) {
        rmSync(`${path}.old`, { force: true });
        renameSync(path, `${path}.old`);
      }
    } catch {
      // First write or stat unavailable: just append.
    }
    const stamp = new Date().toISOString();
    appendFileSync(path, `[${stamp}] ${redactDiagnosticLine(line)}\n`, "utf8");
  } catch (err) {
    // never let a diagnostic write break the app; surface the failure path once
    try {
      const stamp = new Date().toISOString();
      appendFileSync("liteforms-diagnostic.log", `[${stamp}] DIAG-WRITE-FAIL ${String(err)} :: target=${diagnosticLogPath()}\n`, "utf8");
    } catch {
      /* ignore */
    }
  }
}

ipcMain.handle(diagnosticLogChannel, (_event, line: unknown) => {
  writeDiagnostic(`[renderer] ${String(line)}`);
});

ipcMain.handle(preloadLoadedChannel, (_event, info: unknown) => {
  writeDiagnostic(`[preload] loaded :: ${String(info)}`);
});

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

  const port = LITEFORMS_SERVER_PORT;
  const host = resolveServerHost();
  const url = `http://127.0.0.1:${port}`;

  if (await isHttpServerUp(url)) {
    // Already answering (orphan server from a crashed previous run, or a second
    // app instance): reuse it. ponytail: trusts whatever answers on our fixed
    // loopback port; add a response marker check if that becomes a concern.
    return url;
  }

  if (host === "127.0.0.1") {
    writeDiagnostic("[next] LAN bind: off (loopback only)");
  } else {
    writeDiagnostic(`[next] LAN bind: ${host}:${port} (mobile POC)`);
  }

  const child = spawn(process.execPath, [serverPath], {
    cwd: standaloneDir,
    env: {
      ...createNextServerEnv({ port, host }),
      // Channel for the Next routes' [poc] tracing into the diagnostic log.
      LITEFORMS_DIAGNOSTIC_LOG: diagnosticLogPath(),
      // Local VRM library folder (POC Phase C), created below at startup.
      LITEFORMS_VRM_LIBRARY_DIR: vrmLibraryPath(),
      // Durable device-config folder (POC.md §13.4), created below at startup.
      LITEFORMS_DEVICE_CONFIG_DIR: deviceConfigDirPath()
    },
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
    writeDiagnostic(`[next] server exit code=${code ?? "null"} signal=${signal ?? "null"}`);
    if (code !== 0 && signal !== "SIGTERM") {
      console.error(`Packaged Next server exited with code ${code ?? "null"} and signal ${signal ?? "null"}.`);
    }
  });

  await waitForHttpServer(url);
  writeDiagnostic(`[next] server ready on ${url} (bind host=${host} port=${port})`);
  return url;
}

// A real Windows minimize makes the page "hidden" (document.hidden === true),
// which makes Chromium/\u0192 drop the renderer to ~1fps and suspend the
// AudioContext — stuttering the hologram even though the GPU is idle. We can't
// override that with switches. Instead, when the user minimizes we convert it
// into an off-screen "visible" window so the WebContents keeps rendering and
// audio keeps flowing, and expose a tray icon to bring it back.
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

// Pick the Looking Glass display: a non-primary monitor in portrait orientation
// (1440×2560). Falls back to the largest non-primary display, or undefined when
// no secondary display is present.
function findLookingGlassDisplay(): Electron.Display | undefined {
  const primaryId = screen.getPrimaryDisplay().id;
  const secondary = screen.getAllDisplays().filter((display) => display.id !== primaryId);
  if (secondary.length === 0) return undefined;

  return (
    secondary.find((display) => display.size.height > display.size.width)
    ?? secondary.slice().sort((a, b) => b.size.width * b.size.height - a.size.width * a.size.height)[0]
  );
}

function findDisplayForPopupFeatures(features: string | undefined): Electron.Display | undefined {
  if (!features) return undefined;

  const values = new Map(
    features.split(",").map((feature) => {
      const [name, value] = feature.split("=", 2);
      return [name?.trim().toLowerCase(), Number(value)] as const;
    }),
  );
  const left = values.get("left");
  const top = values.get("top");
  const width = values.get("width");
  const height = values.get("height");
  if (
    left === undefined || top === undefined || width === undefined || height === undefined
    || ![left, top, width, height].every((value) => Number.isFinite(value))
  ) return undefined;

  // Exact match only: a stale/wrong popup position must not silently pick the
  // nearest display (that could fill the primary laptop screen with the quilt).
  return screen.getAllDisplays().find((display) => (
    display.bounds.x === left
    && display.bounds.y === top
    && display.bounds.width === width
    && display.bounds.height === height
  ));
}

function findNearestDisplayForPopupFeatures(features: string | undefined): Electron.Display | undefined {
  if (!features) return undefined;

  const values = new Map(
    features.split(",").map((feature) => {
      const [name, value] = feature.split("=", 2);
      return [name?.trim().toLowerCase(), Number(value)] as const;
    }),
  );
  const left = values.get("left");
  const top = values.get("top");
  const width = values.get("width");
  const height = values.get("height");
  if (
    left === undefined || top === undefined || width === undefined || height === undefined
    || ![left, top, width, height].every((value) => Number.isFinite(value))
  ) return undefined;

  return screen.getDisplayMatching({ x: left, y: top, width, height });
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
    writeDiagnostic(
      `[windowOpen] url=${details.url} frameName=${details.frameName} features=${String(details.features)}`
    );
    const decision = resolveWindowOpenRequest(details, allowedOrigin);
    if (decision.externalUrl) {
      void shell.openExternal(decision.externalUrl);
    }
    // The /hologram window must open fullscreen ON the Looking Glass display, not
    // the primary monitor. The windowOpenPolicy only sets fullscreen:true (no
    // x/y), so Electron would otherwise fill the primary screen with the portrait
    // quilt canvas stuck at the left edge. Place it explicitly on the LKG display.
    if (decision.response.action === "allow" && isHologramWindowOpenRequest(details)) {
      // Exact feature match first (authoritative native display position), then
      // the portrait/largest secondary display, then a last-resort nearest match.
      // Native display x/y can be missing or stale on Linux, where an
      // unchecked nearest-match would otherwise fill the primary screen.
      const display = findDisplayForPopupFeatures(details.features)
        ?? findLookingGlassDisplay()
        ?? findNearestDisplayForPopupFeatures(details.features);
      if (display) {
        decision.response.overrideBrowserWindowOptions = {
          ...hologramWindowBrowserOptions,
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height,
        };
      }
    }
    writeDiagnostic(
      `[windowOpen →] frameName=${details.frameName} action=${decision.response.action} ` +
      `override=${decision.response.overrideBrowserWindowOptions ? "yes" : "no"}`
    );
    return decision.response;
  });

  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isExternalUrl(targetUrl, allowedOrigin)) {
      return;
    }
    event.preventDefault();
    void shell.openExternal(targetUrl);
  });

  wireWebContentsDiagnostics(mainWindow, "main");

  void mainWindow.loadURL(url);
}

function wireWebContentsDiagnostics(win: BrowserWindow, label: string) {
  // The main window is wired directly in createWindow AND surfaces here through
  // browser-window-created; without this guard every listener/log would be
  // installed twice.
  if (wiredDiagnosticsWindows.has(win)) return;
  wiredDiagnosticsWindows.add(win);
  // For the /hologram child window, sample the DOM geometry every ~1.5s so a
  // misplaced quilt canvas / collapsed container is visible in the diagnostic
  // log (this is how the "black background + white left border" was diagnosed).
  // Screenshots (userData/debug/) are taken only when LITEFORMS_DEBUG_HOLO=1.
  let hologramMonitorTimer: NodeJS.Timeout | undefined;
  let hologramMonitorTicks = 0;
  const startHologramMonitor = () => {
    if (hologramMonitorTimer) return;
    writeDiagnostic(`[webContents:${label}] holo-monitor start`);
    hologramMonitorTimer = setInterval(() => {
      hologramMonitorTicks += 1;
      if (hologramMonitorTicks > 10) {
        if (hologramMonitorTimer) clearInterval(hologramMonitorTimer);
        hologramMonitorTimer = undefined;
        // Self-test harness: stop the app once the sampling run is complete.
        if (process.env.LITEFORMS_DEBUG_HOLO) {
          writeDiagnostic(`[webContents:${label}] holo-monitor done`);
          setTimeout(() => app.quit(), 250);
        }
        return;
      }
      // Probe: when LITEFORMS_DEBUG_HOLO_PROBE=1, the first N ticks hide one
      // canvas each (so isolation captures reveal which canvas paints the white
      // left strip), then leave everything visible.
      const probeEnabled = process.env.LITEFORMS_DEBUG_HOLO_PROBE === "1";
      const probeIndex = probeEnabled ? hologramMonitorTicks : 0;
      const sampler = [
        "(() => {",
        "  const d = document;",
        "  const g = (el) => { if (!el) return null; const r = el.getBoundingClientRect();",
        "    const cs = getComputedStyle(el); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),",
        "      bufW: el.width || 0, bufH: el.height || 0, z: cs.zIndex, fit: cs.objectFit, objPos: cs.objectPosition,",
        "      pos: cs.position, bg: cs.backgroundColor, disp: cs.display, vis: cs.visibility, op: cs.opacity }; };",
        "  const sel = (s) => g(d.querySelector(s));",
        "  const canvases = [...d.querySelectorAll('canvas')];",
        `  const probeIdx = ${probeIndex};`,
        "  if (probeIdx > 0) canvases.forEach((c, i) => { c.style.visibility = i === probeIdx - 1 ? 'hidden' : ''; });",
        "  return JSON.stringify({ t: Date.now(), inner: [innerWidth, innerHeight], dpr: devicePixelRatio,",
        "    bodyBg: getComputedStyle(d.body).backgroundColor,",
        "    stage: sel('.hologram-stage'), scene: sel('.avatar-scene'),",
        "    controls: sel('#LookingGlassWebXRControls'),",
        "    canvases: canvases.map(g),",
        "    vrf: (() => { const b = d.querySelector('#VRButton'); if (!b) return null; const r = b.getBoundingClientRect();",
        "      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), txt: (b.textContent || '').slice(0, 40) }; })()",
        "  });",
        "})()",
      ].join("\n");
      const t = Date.now();
      void win.webContents
        .executeJavaScript(sampler)
        .then((result) => writeDiagnostic(`[webContents:${label}] holo-dom :: ${String(result)} (${Date.now() - t}ms)`))
        .catch(() => {});
      if (process.env.LITEFORMS_DEBUG_HOLO) {
        writeDiagnostic(`[webContents:${label}] holo-capture start`);
        win.webContents
          .capturePage()
          .then((image) => {
            const dir = join(app.getPath("userData"), "debug");
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            const file = join(
              dir,
              probeIndex > 0 ? `holo-probe${probeIndex}-${Date.now()}.png` : `hologram-${Date.now()}.png`
            );
            writeDiagnostic(`[webContents:${label}] holo-capture save=${file} size=${image.getSize().width}x${image.getSize().height}`);
            writeFileSync(file, image.toPNG());
          })
          .catch((err) => writeDiagnostic(`[webContents:${label}] holo-capture error ${String(err)}`));
      }
    }, 1500);
    win.on("closed", () => {
      if (hologramMonitorTimer) clearInterval(hologramMonitorTimer);
      hologramMonitorTimer = undefined;
    });
  };

  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    writeDiagnostic(`[webContents:${label}] preload-error :: ${preloadPath} :: ${String(error)}`);
  });
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    writeDiagnostic(`[webContents:${label}] did-fail-load :: ${errorCode} ${errorDescription} :: ${validatedURL}`);
  });
  win.webContents.on("did-finish-load", () => {
    writeDiagnostic(`[webContents:${label}] did-finish-load`);
  });
  // Track every top-level navigation (incl. the /hologram window's load/reloads)
  // together with the window's position/size and which display it now fills, so a
  // misplaced hologram window is visible directly in the diagnostic log.
  win.webContents.on("did-navigate", (_event, url) => {
    if (url.includes("/hologram")) startHologramMonitor();
    try {
      const bounds = win.getBounds();
      const display = screen.getDisplayMatching(bounds);
      const displayLabel = (display as unknown as { label?: string }).label ?? "";
      writeDiagnostic(
        `[webContents:${label}] did-navigate :: ${url} ` +
        `bounds=${bounds.x},${bounds.y} ${bounds.width}x${bounds.height} ` +
        `fs=${win.isFullScreen()} display="${displayLabel}" dsize=${display.size.width}x${display.size.height} ` +
        `primary=${display.id === screen.getPrimaryDisplay().id}`
      );
    } catch {
      writeDiagnostic(`[webContents:${label}] did-navigate :: ${url}`);
    }
  });
  // Capture console logs/errors from the renderer — this is the surest way to see
  // whether React hydration succeeds or throws during bootstrap.
  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    writeDiagnostic(`[console:${label}] ${level} :: ${String(message)} (${sourceId}:${line})`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    writeDiagnostic(`[webContents:${label}] render-process-gone :: ${String(details?.reason)}`);
  });
  win.webContents.on("did-start-loading", () => {
    writeDiagnostic(`[webContents:${label}] did-start-loading :: ${win.webContents.getURL()}`);
  });
  win.webContents.on("dom-ready", () => {
    void win.webContents
      .executeJavaScript(
        [
          "(() => {",
          "  const l = window.liteformsElectron;",
          "  const r = {",
          "    t: typeof l,",
          "    diag: typeof (l && l.diagnostic && l.diagnostic.log),",
          "    keys: l ? Object.keys(l) : [],",
          "    pathname: window.location ? window.location.pathname : '?',",
          "    hasHologramStage: !!document.querySelector('.hologram-stage'),",
          "    hasAvatarScene: !!document.querySelector('.avatar-scene, canvas, .hologram-stage canvas'),",
          "    canvases: document.querySelectorAll('canvas').length,",
          "    bodyChildren: document.body ? document.body.children.length : -1",
          "  };",
          "  if (l && l.diagnostic && l.diagnostic.log) {",
          "    try { l.diagnostic.log('RENDERER-TEST dom-ready ok'); } catch (e) { r.testErr = String(e); }",
          "  }",
          "  return JSON.stringify(r);",
          "})()"
        ].join("\n")
      )
      .then((result) => {
        writeDiagnostic(`[webContents:${label}] dom-ready :: ${String(result)}`);
      })
      .catch((err) => {
        writeDiagnostic(`[webContents:${label}] dom-ready-eval-error :: ${String(err)}`);
      });
  });
}

function stopNextServer() {
  if (nextServerProcess && !nextServerProcess.killed) {
    nextServerProcess.kill();
  }
  nextServerProcess = null;
}

app.whenReady().then(async () => {
  writeDiagnostic(
    `=== app.whenReady === exe=${process.execPath} isPackaged=${app.isPackaged} ` +
      `userData=${app.getPath("userData")} appPath=${app.getAppPath()} resources=${process.resourcesPath}`
  );

  // POC Phase C: the local VRM library folder exists from the first launch so
  // the user can drop .vrm files into it before any mobile call comes in.
  try {
    mkdirSync(vrmLibraryPath(), { recursive: true });
    writeDiagnostic(`[vrm-library] ready (single source of truth: main process)`);
  } catch (err) {
    writeDiagnostic(`[vrm-library] creation failed ${String(err)}`);
  }

  // Durable device-config folder (POC.md §13.4): exists from the first launch
  // so the Next server can always write device-config.json into it.
  try {
    mkdirSync(deviceConfigDirPath(), { recursive: true });
    writeDiagnostic(`[device-config] dir ready (durable store: <userData>/config)`);
  } catch (err) {
    writeDiagnostic(`[device-config] dir creation failed ${String(err)}`);
  }

  if (process.platform === "win32") {
    app.setAppUserModelId("org.liteforms.web");
  }

  // Prevent the OS from suspending the app while the hologram is animating, so
  // the animation keeps refreshing even if the window is in the background.
  powerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");

  Menu.setApplicationMenu(null);

  // One-line display inventory: proves whether Electron itself sees the Looking
  // Glass display (vs. only xrandr), and with which bounds/label it is exposed.
  const logDisplayInventory = () => {
    writeDiagnostic(
      `[displays] ` + screen.getAllDisplays().map((display) => {
        const label = (display as unknown as { label?: string }).label ?? "?";
        return `${label} bounds=${display.bounds.x},${display.bounds.y} ` +
          `${display.bounds.width}x${display.bounds.height} primary=${display.id === screen.getPrimaryDisplay().id}`;
      }).join(" | ")
    );
  };
  logDisplayInventory();
  screen.on("display-added", () => logDisplayInventory());
  screen.on("display-removed", () => logDisplayInventory());
  screen.on("display-metrics-changed", () => logDisplayInventory());

  // Hook diagnostics onto child windows too (e.g. the /hologram popup created via
  // window.open). The main window is already wired by createWindow.
  app.on("browser-window-created", (_e, win) => {
    wireWebContentsDiagnostics(win, "child");
  });

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
  if (powerSaveBlockerId !== null) {
    powerSaveBlocker.stop(powerSaveBlockerId);
    powerSaveBlockerId = null;
  }
  stopNextServer();
  nativeBridgeService.dispose();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
