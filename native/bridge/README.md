# Native Looking Glass Bridge assets

Electron packages these folders into `resources/bridge/<platform-arch>` and probes them from an isolated helper process. These files are the Bridge SDK dynamic libraries used for in-process native detection; they do not need `LookingGlassBridge.exe` to be running.

Expected layouts:

- `win32-x64/bridge_inproc.dll` plus its adjacent dependency DLLs.
- `darwin-x64/libbridge_inproc.dylib` plus adjacent dependencies.
- `darwin-arm64/libbridge_inproc.dylib` plus adjacent dependencies.
- `linux-x64/libbridge_inproc.so` plus adjacent dependencies.

The Windows x64 folder is populated from `Bridge-Python-SDK/src/bridge_python_sdk/bin/win`. The linux-x64 folder is populated from `Bridge-Python-SDK/src/bridge_python_sdk/bin/ubuntu` (same SDK, MIT licensed). The Bridge SDK copy currently present in this workspace does not include macOS dylibs, so those folders need to be populated before producing macOS installers.

## Linux runtime requirements (appliance)

`libbridge_inproc.so` links the private libraries in its own folder (resolved via
`$ORIGIN` and `LD_LIBRARY_PATH`) plus system libraries. On a fresh Ubuntu 24.04
install, verify the full dependency chain with:

```bash
ldd resources/bridge/linux-x64/libbridge_inproc.so | grep "not found"
```

Libraries that are NOT bundled and must come from the system include:
`libgtk-3.so.0`, `libgdk-3.so.0`, `libdbusmenu-glib.so.4`, `libpangocairo-1.0.so.0`,
`libatk-1.0.so.0`, `libasound.so.2`, `libX11.so.6`, `libXrandr.so.2`, `libXi.so.6`,
`libGL.so.1`, `libGLESv2.so.2`, `libEGL.so.1`, `libusb-1.0.so.0` (pulled in by the
bundled `libhidapi-libusb.so.0`). Install the matching desktop packages if `ldd`
reports them missing.

One runtime dependency does not show up in `ldd`: `libayatana-appindicator3-1`
(provides `libayatana-appindicator3.so.1` on Ubuntu 22.04/24.04). It cannot be
bundled (upstream license), so it must come from the system. `libbridge_inproc.so`
imports the `app_indicator_*` symbols but does not declare a `DT_NEEDED` entry for
appindicator; loading it with `RTLD_NOW` therefore fails with `undefined symbol:
app_indicator_set_icon_theme_path`. The probe helper must preload the library with
`RTLD_GLOBAL` before loading `libbridge_inproc.so` (same workaround as the upstream
Bridge Python SDK), which is why `electron/nativeBridgeProbe.ts` keeps that preload
step.

Behaviour notes:

- The library talks to the display over **USB HID**; an HDMI-only connection shows
  the screen but cannot expose calibration. The USB cable must be connected.
- If the Bridge runtime cannot initialize (device unreachable, permission denied,
  missing system library), it terminates its host process silently. The probe
  helper reports this as "Native Bridge probe returned no data" in
  `liteforms-diagnostic.log`; run the probe manually to see the reason:

  ```bash
  ELECTRON_RUN_AS_NODE=1 \
  LITEFORMS_NATIVE_BRIDGE_LIBRARY=resources/bridge/linux-x64/libbridge_inproc.so \
  LITEFORMS_NATIVE_BRIDGE_RUNTIME_DIR=resources/bridge/linux-x64 \
  ./liteforms-web resources/app.asar/dist-electron/nativeBridgeProbe.js
  ```

- Grant the appliance user access to the device with a udev rule (discover the
  IDs with `lsusb` / `udevadm info`, then):

  ```bash
  # /etc/udev/rules.d/99-looking-glass.rules
  # SUBSYSTEM=="hidraw", ATTRS{idVendor}=="XXXX", ATTRS{idProduct}=="XXXX", MODE="0660", TAG+="uaccess"
  # SUBSYSTEM=="usb", ATTRS{idVendor}=="XXXX", ATTRS{idProduct}=="XXXX", MODE="0660", TAG+="uaccess"
  ```

  then `sudo udevadm control --reload-rules && sudo udevadm trigger`.
