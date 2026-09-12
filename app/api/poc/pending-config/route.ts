import { NextResponse } from "next/server";
import { clearPendingConfig, readPendingConfig } from "@/lib/deviceConfig/pendingConfigStore";
import { pocLog } from "@/lib/deviceConfig/pocLog";

// POC-only channel (NOT part of the mobile contract v1): the Electron renderer
// polls this to fetch the last POSTed device-config, writes it to its
// localStorage (liteforms.poc.deviceConfig) and applies the existing setters.
// `consume=1` clears the pending payload; otherwise repeated polls return the
// same entry so the renderer can deduplicate by receivedAt.
export async function GET(request: Request) {
  const consume = new URL(request.url).searchParams.get("consume") === "1";
  const pending = readPendingConfig();
  if (consume) clearPendingConfig();

  pocLog(
    `pending-config GET :: consume=${consume ? "1" : "0"} ` +
    (pending
      ? `found receivedAt=${pending.receivedAt} (${consume ? "cleared now" : "kept in place"})`
      : "empty")
  );

  return NextResponse.json({
    ok: true,
    pending,
    cleared: consume
  });
}
