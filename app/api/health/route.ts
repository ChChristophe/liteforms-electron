import { NextResponse } from "next/server";
import { pocLog } from "@/lib/deviceConfig/pocLog";

// Contract Mobile<->Electron v1 (see Liteforms-Mobile-Application/docs/contract
// and PLAN_DIRECTEUR.md §4.4). The mobile checks ok/mode/protocolVersion and
// ignores unknown fields. POC: networkMode is reported "wifi"; no secrets here.
export function GET() {
  pocLog("health GET :: served (contract v1 payload, no secrets)");
  return NextResponse.json({
    ok: true,
    name: "Liteforms Desktop",
    protocolVersion: "1.0",
    configVersions: ["1.0"],
    networkMode: "wifi"
  });
}
