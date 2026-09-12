import { NextResponse, type NextRequest } from "next/server";
import { parseDeviceConfig, describeConfigSummary } from "@/lib/deviceConfig/pocConfig";
import { setPendingConfig } from "@/lib/deviceConfig/pendingConfigStore";
import { pocLog } from "@/lib/deviceConfig/pocLog";

function buildDeviceConfigError(code: string, message: string, status = 400) {
  return NextResponse.json({ ok: false, code, message }, { status });
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
  setPendingConfig(parsed.config, receivedAt);

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
