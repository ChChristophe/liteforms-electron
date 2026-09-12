import { NextResponse, type NextRequest } from "next/server";
import { parseDeviceConfig, describeConfigSummary, type PocDeviceConfig } from "@/lib/deviceConfig/pocConfig";
import { loadDeviceConfigFile, resolveDeviceConfigPath, saveDeviceConfigFile } from "@/lib/deviceConfig/deviceConfigFile";
import { pocLog } from "@/lib/deviceConfig/pocLog";

// ponytail: dev-only fallback (no LITEFORMS_DEVICE_CONFIG_DIR), replaces the
// deleted pendingConfigStore — per-module state is enough for `npm run dev`.
let devFallbackConfig: (PocDeviceConfig & { receivedAt: string }) | null = null;

function buildDeviceConfigError(code: string, message: string, status = 400) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

/** Last accepted config for the GET route: the durable file when the main
 * process handed over LITEFORMS_DEVICE_CONFIG_DIR, otherwise the dev fallback
 * (dev without Electron — POC.md §13.6: the file is the source of truth). */
function readLastConfig() {
  const configDir = process.env.LITEFORMS_DEVICE_CONFIG_DIR;
  if (configDir) {
    const fromFile = loadDeviceConfigFile(resolveDeviceConfigPath(configDir));
    if (fromFile) {
      return { ...fromFile.config, receivedAt: fromFile.receivedAt };
    }
    return null;
  }
  return devFallbackConfig;
}

export async function GET() {
  const config = readLastConfig();
  pocLog(
    "device-config GET :: " +
    (config ? `found receivedAt=${config.receivedAt}` : "empty")
  );
  return NextResponse.json({ ok: true, config });
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
  // replaces the stored payload (the renderer skips already-applied configs
  // based on receivedAt).
  const receivedAt = new Date().toISOString();

  // Durable source of truth: <userData>/config/device-config.json when the
  // main process handed over LITEFORMS_DEVICE_CONFIG_DIR (POC.md §13.4). A
  // failed file save never breaks the HTTP contract; the next POST rewrites
  // the file. Without the env (dev without Electron) the module-memory
  // fallback keeps `npm run dev` working.
  const configDir = process.env.LITEFORMS_DEVICE_CONFIG_DIR;
  if (configDir) {
    saveDeviceConfigFile(resolveDeviceConfigPath(configDir), parsed.config, receivedAt);
  } else {
    devFallbackConfig = { ...parsed.config, receivedAt };
  }

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
