import { NextResponse } from "next/server";
import { clearPendingConfig, readPendingConfig } from "@/lib/deviceConfig/pendingConfigStore";
import { loadDeviceConfigFile, resolveDeviceConfigPath } from "@/lib/deviceConfig/deviceConfigFile";
import { pocLog } from "@/lib/deviceConfig/pocLog";

// POC-only channel (NOT part of the mobile contract v1): the Electron renderer
// polls this to fetch the last POSTed device-config, writes it to its
// localStorage (liteforms.poc.deviceConfig) and applies the existing setters.
// `consume=1` clears the pending payload; otherwise repeated polls return the
// same entry so the renderer can deduplicate by receivedAt.
//
// Source of truth (POC.md §13.4): with LITEFORMS_DEVICE_CONFIG_DIR set, the
// durable file is read on every call (including the first call after boot, so
// a config received before a restart is re-delivered). consume=1 never deletes
// the file — the renderer deduplicates by receivedAt instead. Without the env
// (dev without Electron) the memory park stays the store. `durable` tells the
// renderer whether the one-shot localStorage->file migration should run.
export async function GET(request: Request) {
  const consume = new URL(request.url).searchParams.get("consume") === "1";
  const configDir = process.env.LITEFORMS_DEVICE_CONFIG_DIR;

  let pending = readPendingConfig();
  if (configDir) {
    const fromFile = loadDeviceConfigFile(resolveDeviceConfigPath(configDir));
    if (fromFile) {
      pending = { ...fromFile.config, receivedAt: fromFile.receivedAt };
    }
  }
  if (consume) clearPendingConfig();

  pocLog(
    `pending-config GET :: consume=${consume ? "1" : "0"} durable=${configDir ? "1" : "0"} ` +
    (pending
      ? `found receivedAt=${pending.receivedAt} (${consume ? "cleared now" : "kept in place"})`
      : "empty")
  );

  return NextResponse.json({
    ok: true,
    pending,
    cleared: consume,
    durable: Boolean(configDir)
  });
}
