// POST /api/functions/openclaw_web_search — realtime voice tool route
// (web commit 28cc967, ported 19/09/2026). Forwards one search query to the
// local OpenClaw gateway and returns `{ answer }`.
//
// Security: the gateway token is resolved server-side from the durable
// credential store (key `openclaw`, written by the main process at boot from
// the local OpenClaw install). It is NEVER logged and never echoed. The web
// route's `body.token` and `OPENCLAW_GATEWAY_TOKEN` remain as fallbacks so the
// route still works outside the packaged app.
import { NextResponse, type NextRequest } from "next/server";
import { getCredential } from "@/lib/deviceConfig/providerCredentials";

const DEFAULT_OPENCLAW_BASE_URL = "http://127.0.0.1:18789/v1";

/** Gateway base URL; `OPENCLAW_BASE_URL` overrides the local default. */
function openClawBaseUrl(): string {
  const configured = process.env.OPENCLAW_BASE_URL?.trim();
  return (configured || DEFAULT_OPENCLAW_BASE_URL).replace(/\/+$/, "");
}

/**
 * Token precedence: durable store (source of truth) -> request body (web
 * parity) -> environment. The raw value never leaves this function.
 */
function resolveGatewayToken(bodyToken: unknown): string {
  const path = process.env.LITEFORMS_CREDENTIALS_PATH;
  const stored = path ? getCredential(path, "openclaw") : undefined;
  if (stored) return stored;
  if (typeof bodyToken === "string" && bodyToken.trim()) return bodyToken.trim();
  return process.env.OPENCLAW_GATEWAY_TOKEN?.trim() ?? "";
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const raw: unknown = await request.json();
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return NextResponse.json({ error: "Missing query" }, { status: 400 });
    }
    body = raw as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }

  const token = resolveGatewayToken(body.token);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(`${openClawBaseUrl()}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "openclaw/default",
        messages: [
          {
            role: "user",
            content: `Search the web for: ${query}\n\nAnswer concisely based on what you find. Use web_search and web_fetch tools.`
          }
        ],
        stream: false,
        user: "liteforms-realtime-voice"
      })
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json({ error: detail.trim() || `OpenClaw responded with ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    const answer = data?.choices?.[0]?.message?.content ?? "No result from OpenClaw.";
    return NextResponse.json({ answer });
  } catch (err) {
    const message = err instanceof Error ? err.message : "OpenClaw unreachable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
