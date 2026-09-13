import { NextResponse } from "next/server";
import { pocLog } from "@/lib/deviceConfig/pocLog";
import { parseNetworkMode } from "@/lib/provisioning/wifiConfig";

// Contract Mobile<->Electron v1 (see Liteforms-Mobile-Application/docs/contract
// and PLAN_DIRECTEUR.md §4.4). The mobile checks ok/mode/protocolVersion and
// ignores unknown fields. networkMode comes from the main process via
// LITEFORMS_NETWORK_MODE (wifi | ethernet | provisioning — the provisioning
// server lives in the main process, this route just reports the mode).
// deviceId (additive, protocol 13/09/2026 §Identité de l'appliance): the
// persistent identity generated in the main process, forwarded via
// LITEFORMS_DEVICE_ID — the Mobile uses it to re-match the appliance after
// the WiFi transition. No secrets here.
export function GET() {
  const networkMode = parseNetworkMode(process.env.LITEFORMS_NETWORK_MODE);
  const deviceId = process.env.LITEFORMS_DEVICE_ID;
  pocLog(`health GET :: served networkMode=${networkMode} deviceId=${deviceId ? "set" : "unset"} (contract v1 payload, no secrets)`);
  return NextResponse.json({
    ok: true,
    name: "Liteforms Desktop",
    protocolVersion: "1.0",
    configVersions: ["1.0"],
    networkMode,
    // Additive: only present when the main process handed an identity over
    // (an absent field is valid v1 — the Mobile treats it as non-identifiable).
    ...(deviceId ? { deviceId } : {})
  });
}
