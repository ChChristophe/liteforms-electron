import { NextResponse, type NextRequest } from "next/server";
import { buildDeviceConfigError, parseDeviceConfig, type PocDeviceConfig } from "@/lib/deviceConfig/pocConfig";
import { describeConfigSummary, pocLog } from "@/lib/deviceConfig/pocLog";

// Module-memory POC state (non durable by design, see POC.md §3.2). The
// standalone Next server is a single process in the packaged app, so this is
// reliably shared between route handlers; userData persistence comes later.
let pendingConfig: (PocDeviceConfig & { receivedAt: string }) | null = null;

export function readPendingConfig() {
  return pendingConfig;
}

export function clearPendingConfig() {
  pendingConfig = null;
}

export async function POST(request: NextRequest) {
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    pocLog("device-config POST :: rejected body-not-JSON");
    return buildDeviceConfigError("INVALID_FIELD", "The request body must be valid JSON");
  }

  const parsed = parseDeviceConfig(raw);
  if ("error" in parsed) {
    pocLog(`device-config POST :: rejected code=${parsed.error} ua=${userAgent.slice(0, 60)}`);
    return buildDeviceConfigError(parsed.error, parsed.message);
  }

  // Idempotent: re-sending the same configuration is accepted again and
  // replaces the pending payload (the renderer skips already-applied configs
  // based on receivedAt).
  const receivedAt = new Date().toISOString();
  pendingConfig = { ...parsed.config, receivedAt };

  pocLog(
    `device-config POST :: accepted receivedAt=${receivedAt} warnings=${parsed.warnings.length} ` +
    `ua=${userAgent.slice(0, 60)} ` +
    describeConfigSummary(parsed.config)
  );

  return NextResponse.json({
    ok: true,
    configVersion: parsed.config.configVersion,
    appliedAt: receivedAt,
    warnings: parsed.warnings
  });
}
