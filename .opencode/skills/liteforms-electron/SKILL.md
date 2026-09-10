---
name: liteforms-electron
description: Project-specific guidance for Liteforms Electron, the Next.js renderer wrapped by an Electron desktop and appliance shell with Looking Glass output.
---

# Liteforms Electron

## Role

Liteforms Electron is the desktop/appliance target. Liteforms Web remains the
functional reference, but this repository already diverges with a native
Looking Glass bridge, a dedicated `/hologram` window, tray behavior, and
Electron packaging.

Preserve those working differences. Do not replace this repository with a
fresh copy of the Web repository.

## Current stack and targets

- Next.js 15, React 19, TypeScript, Three.js, and VRM
- Electron 41 and Electron Builder 26
- Vitest, Testing Library, and ESLint
- `electron/main.ts`, `electron/preload.ts`, and renderer code in `app/`
- native Looking Glass Bridge assets under `native/bridge/`
- Windows packaging is currently validated
- Linux appliance work targets Ubuntu 24.04 LTS with X11 according to
  `PLAN_DIRECTEUR.md`; do not silently change that to Wayland or another OS

The installed `package.json`, `PLAN_DIRECTEUR.md`, and build configuration are
authoritative. The package name and some README wording still say Web; do not
use that stale wording to infer runtime architecture.

## Process boundaries

Keep these responsibilities separate:

### Main process

Own Electron lifecycle, windows, tray, display detection, filesystem, child
processes, native Bridge probing, and privileged OS integration.

### Preload

Expose the smallest typed API through `contextBridge`. Keep
`contextIsolation: true`, `nodeIntegration: false`, sandboxing, and web
security enabled unless a concrete requirement proves otherwise.

### Renderer

Own React UI, browser-compatible application state, Three.js, chat, speech, and
avatar presentation. It must not access Node or native modules directly.

### Packaged Next server

The packaged app starts the standalone Next server on loopback. The server,
main process, and renderer do not share renderer `localStorage` or IndexedDB.
Do not pretend a server route can read browser credentials without an explicit
bridge.

## IPC and security

For new renderer/main communication:

1. define a narrow channel and a typed payload;
2. validate untrusted arguments at the boundary;
3. expose only the required method from preload;
4. keep normal UI state out of IPC;
5. add a focused test for the contract.

Never expose unrestricted `ipcRenderer`, Node, filesystem, shell, or arbitrary
IPC channels to the renderer. Never log provider credentials, pairing secrets,
or raw configuration payloads.

## Looking Glass and hologram

The `/hologram` route is a dedicated child window for the Looking Glass display.
The main window must remain usable and must not accidentally fill the primary
display with the hologram canvas.

Before modifying display behavior, inspect:

- `electron/main.ts` display selection and window-open policy;
- `components/avatar/AvatarScene.tsx` hologram mode;
- `app/hologram/page.tsx` and the postMessage protocol;
- native Bridge state/calibration probing;
- tray and background-rendering behavior.

Preserve the current invariants:

- secondary-display selection with a safe no-device fallback;
- dedicated hologram window and explicit bounds/fullscreen handling;
- TTS/realtime audio relay and RMS lip-sync;
- rendering while the main window is parked in the tray;
- graceful operation without a Looking Glass display.

The official Linux path still needs hardware validation. Bridge.js over the
local websocket is the preferred OS-independent candidate; the official
Python SDK and HLD are fallbacks. Native Bridge assets currently do not prove
Linux appliance support. X11 is required by the plan; Wayland is not supported.

## Mobile configuration boundary

The mobile app is **built and done** against contract v1, frozen in
`C:\dev\Liteforms-Mobile-Application\docs\contract\` (README + JSON examples).
The remaining work is Electron-side. Contract highlights:

- hotspot `Liteforms-Setup-XXXX` on `192.168.4.1:8080` (port is an Electron
  config parameter, default 8080, announced in the provisioning health
  response);
- credential rules: the **mobile is the emitter** of all data (config on
  `device-config`, WiFi creds on `provisioning/wifi` only over the isolated
  hotspot); `device-config` carries **no secrets ever** (no provider key, no
  pairing token, no WiFi password); the secure-storage mechanism for WiFi
  creds is an Electron implementation detail — the contract requirement is
  that they never appear in logs, other routes' responses, or errors;
  provider API keys **live on the Electron** (a future mobile-side entry is a
  dedicated one-shot `POST /api/credentials`, "decision D1", never
  `device-config`);
- on the normal LAN: `GET /api/health` (`networkMode`), `POST /api/device-config`
  (idempotent, unknown fields ignored, error codes `INVALID_FIELD`,
  `UNSUPPORTED_CONFIG_VERSION`, `MODEL_REF_UNKNOWN`) and
  `GET /api/provider-status` (masked stats only);
- **v1 has no auth token** (LAN treated as trusted; pairing/token slips to the
  security-hardening phase); **no provider credentials in the payload** —
  the mobile never sends or holds API keys;
- the appliance displays nothing: no QR code, no pairing screen.

See `PLAN_DIRECTEUR.md` §4.4 for the full contract, mapping table and deltas.
Do not invent token-auth or credential-transfer behavior for v1 — that is
deliberately deferred, and the credential question is resolved in favor of
"secrets stay on the desktop".

When implementing that POC, keep the path explicit:

```text
mobile -> Next route -> durable device config -> main/renderer -> existing setters
```

Bind a network endpoint only deliberately, keep it LAN-scoped, version the
payload, ignore unknown fields, and never return provider or WiFi credentials
over the network. Start with polling if that is the smallest safe
implementation; add push/IPC only when required.

## Storage and live configuration

Existing renderer persistence uses browser `localStorage` and IndexedDB and is
stored by Chromium under Electron user data. Main-process code must not reach
into it directly. Use an explicit route, preload API, or renderer event path.

When applying configuration live, reuse existing setters and remount behavior
where the current app already relies on it. Do not create a parallel state
store for color, character, mood, VRM, or provider configuration without a
demonstrated need.

## Linux and packaging

- Build Linux AppImage/deb artifacts on Linux, not by assuming Windows can
  reproduce them.
- Keep native assets platform-specific and respect electron-builder excludes.
- Do not put personal Wi-Fi, pairing tokens, API keys, or image-specific
  secrets in a golden appliance image.
- Treat NetworkManager, autostart, privileged helpers, mDNS, and updates as
  deployment work, not generic React code.
- Prefer reversible diagnostics and avoid destructive system commands.

## Porting from Web

Compare the current file in both repositories before porting. The Electron
tree is intentionally divergent, especially in `ChatPanel`, `AvatarScene`,
storage, speech, and hologram code. Port domain logic and tests selectively;
adapt integration points instead of overwriting files.

## Verification

Use focused tests first, then the relevant build checks:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build:electron
```

For packaging or native/display changes, also use `npm run dist:electron` on
the appropriate build OS. Test with and without the Looking Glass display,
with the main window visible and tray-parked, and on the target Linux X11
hardware before calling appliance behavior complete.
