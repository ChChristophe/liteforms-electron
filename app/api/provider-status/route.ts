// GET /api/provider-status (protocol contract v1): reports, per slot
// (llm/tts/stt), the current provider id from the durable device-config and
// the credential status (configured + maskedKey) from the credential store.
// `maskedKey` NEVER contains a real key — only the masked form.
import { NextResponse } from "next/server";
import { loadDeviceConfigFile, resolveDeviceConfigPath } from "@/lib/deviceConfig/deviceConfigFile";
import { loadCredentials, maskProviderKey } from "@/lib/deviceConfig/providerCredentials";
import { pocLog } from "@/lib/deviceConfig/pocLog";

type SlotStatus = {
  provider: string | null;
  configured: boolean;
  maskedKey: string | null;
};

function slotStatus(provider: string | null, credentials: Record<string, string>): SlotStatus {
  if (!provider) {
    return { provider: null, configured: false, maskedKey: null };
  }
  const apiKey = credentials[provider];
  if (!apiKey) {
    return { provider, configured: false, maskedKey: null };
  }
  return { provider, configured: true, maskedKey: maskProviderKey(apiKey) };
}

export function GET() {
  // Current provider per slot comes from the durable device-config (same file
  // written by POST /api/device-config). Absent config -> provider: null.
  const configDir = process.env.LITEFORMS_DEVICE_CONFIG_DIR;
  const config = configDir ? loadDeviceConfigFile(resolveDeviceConfigPath(configDir)) : null;

  const llmProvider = config?.config.providers.llm.provider ?? null;
  const ttsProvider = config?.config.providers.tts.provider ?? null;
  const sttProvider = config?.config.providers.stt.provider ?? null;

  const credentialsPath = process.env.LITEFORMS_CREDENTIALS_PATH;
  const credentials = credentialsPath ? loadCredentials(credentialsPath) : {};

  const providers = {
    llm: slotStatus(llmProvider, credentials),
    tts: slotStatus(ttsProvider, credentials),
    stt: slotStatus(sttProvider, credentials)
  };

  // Only masked forms and provider ids — never a real key.
  pocLog(
    `provider-status GET :: llm=${providers.llm.provider ?? "none"}/${providers.llm.configured ? "set" : "unset"} ` +
    `tts=${providers.tts.provider ?? "none"}/${providers.tts.configured ? "set" : "unset"} ` +
    `stt=${providers.stt.provider ?? "none"}/${providers.stt.configured ? "set" : "unset"}`
  );

  return NextResponse.json({ ok: true, providers });
}
