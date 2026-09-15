// POST /api/provisioning/reset (protocol §15/09/2026): manual re-pairing.
// Purges wifi-credentials.json ONLY (device-config is kept — re-pushed after
// pairing), then the main-process shutdown watcher relaunches the app into
// provisioning mode (hotspot). The plaintext/ciphertext content is NEVER
// logged or returned — we only unlink the file. Normal-mode route only: the
// provisioning-mode server has no /api/* proxy and this path never receives
// the env during provisioning.
import { unlinkSync } from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { pocLog } from "@/lib/deviceConfig/pocLog";

export async function GET() {
  return NextResponse.json({ ok: false, code: "METHOD_NOT_ALLOWED", message: "Use POST" }, { status: 405 });
}

export async function POST(request: NextRequest) {
  void request; // Contract: empty body, idempotent — nothing to parse.
  const path = process.env.LITEFORMS_WIFI_CREDENTIALS_PATH;
  if (!path) {
    // Dev-only degradation (no Electron, no env): answer contractually but
    // purge nothing — without a known path we never delete blindly.
    pocLog("provisioning-reset POST :: unavailable (no LITEFORMS_WIFI_CREDENTIALS_PATH)");
    return NextResponse.json(
      { ok: false, code: "RESET_UNAVAILABLE", message: "Credentials path unavailable" },
      { status: 409 }
    );
  }

  try {
    unlinkSync(path);
  } catch (error) {
    // ENOENT = already purged: idempotent success. Anything else (missing
    // perms, locked file) surfaces as accepted-but-refused so the Mobile
    // redoes discovery; no payload details (no path content, no secrets).
    const code = (error as NodeJS.ErrnoException | null)?.code ?? "";
    if (code !== "ENOENT") {
      pocLog(`provisioning-reset POST :: unlink failed code=${code}`);
      return NextResponse.json(
        { ok: false, code: "RESET_FAILED", message: "Credentials purge failed" },
        { status: 500 }
      );
    }
  }

  pocLog("provisioning-reset POST :: accepted — credentials purged, relaunch into provisioning mode requested");
  return NextResponse.json(
    { ok: true, restartRequired: true, message: "Provisioning reset accepted" },
    { status: 202 }
  );
}
