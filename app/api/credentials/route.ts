// POST /api/credentials (protocol 17/09/2026, decision D1): transfers ONE
// provider API key from the Mobile to the appliance. The key is stored
// durably (<userData>/config/provider-credentials.json via
// LITEFORMS_CREDENTIALS_PATH, the same store the desktop UI writes to) and is
// NEVER echoed, logged or returned in full — only the masked form.
import { NextResponse, type NextRequest } from "next/server";
import {
  maskProviderKey,
  parseCredentialsBody,
  saveCredential
} from "@/lib/deviceConfig/providerCredentials";
import { pocLog } from "@/lib/deviceConfig/pocLog";

// ponytail: dev-only fallback (no LITEFORMS_CREDENTIALS_PATH) so `npm run dev`
// keeps working without Electron — per-module state, same pattern as the
// device-config dev fallback.
const devFallbackCredentials = new Map<string, string>();

export async function GET() {
  return NextResponse.json({ ok: false, code: "METHOD_NOT_ALLOWED", message: "Use POST" }, { status: 405 });
}

export async function POST(request: NextRequest) {
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    pocLog("credentials POST :: rejected body-not-JSON");
    return NextResponse.json(
      { ok: false, code: "INVALID_FIELD", message: "The request body must be valid JSON" },
      { status: 400 }
    );
  }

  const parsed = parseCredentialsBody(raw);
  if (!parsed.ok) {
    // Never echo the key: the error reports only the code and a generic
    // message (the provider id is safe to surface, the key never is).
    pocLog(`credentials POST :: rejected code=${parsed.code} ua=${userAgent.slice(0, 60)}`);
    return NextResponse.json({ ok: false, code: parsed.code, message: parsed.message }, { status: 400 });
  }

  // Idempotent: re-POST of the same provider replaces the stored key
  // (last value wins). A failed file save never breaks the HTTP contract;
  // the next POST rewrites the file.
  const path = process.env.LITEFORMS_CREDENTIALS_PATH;
  if (path) {
    saveCredential(path, parsed.provider, parsed.apiKey);
  } else {
    devFallbackCredentials.set(parsed.provider, parsed.apiKey);
  }

  const maskedKey = maskProviderKey(parsed.apiKey);
  // The raw key is deliberately absent from this line and from every other.
  pocLog(`credentials POST :: accepted provider=${parsed.provider} configured=true masked=${maskedKey} ua=${userAgent.slice(0, 60)}`);

  return NextResponse.json({
    ok: true,
    provider: parsed.provider,
    configured: true,
    maskedKey
  });
}
