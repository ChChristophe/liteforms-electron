import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { resolveProviderCredentialsPath, saveCredential } from "@/lib/deviceConfig/providerCredentials";

const STORED_TOKEN = "stored-gateway-token-abcdef";
const BODY_TOKEN = "body-gateway-token-123456";
const ENV_TOKEN = "env-gateway-token-7890";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/functions/openclaw_web_search", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" }
    }) as never
  );
}

function okGateway(answer = "Paris: 18C.") {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: answer } }] })
  } as unknown as Response;
}

describe("POST /api/functions/openclaw_web_search", () => {
  let dir: string;
  let prevCredPath: string | undefined;
  let prevEnvToken: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dir = join(tmpdir(), `liteforms-openclaw-search-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    prevCredPath = process.env.LITEFORMS_CREDENTIALS_PATH;
    prevEnvToken = process.env.OPENCLAW_GATEWAY_TOKEN;
    delete process.env.LITEFORMS_CREDENTIALS_PATH;
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (prevCredPath === undefined) delete process.env.LITEFORMS_CREDENTIALS_PATH;
    else process.env.LITEFORMS_CREDENTIALS_PATH = prevCredPath;
    if (prevEnvToken === undefined) delete process.env.OPENCLAW_GATEWAY_TOKEN;
    else process.env.OPENCLAW_GATEWAY_TOKEN = prevEnvToken;
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns 400 without a query and never calls the gateway", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ query: "   " })).status).toBe(400);
    expect((await post("not-json")).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns { answer } on gateway success", async () => {
    fetchMock.mockResolvedValue(okGateway("Il fait 18 degres a Paris."));
    const response = await post({ query: "meteo Paris" });
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json).toEqual({ answer: "Il fait 18 degres a Paris." });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:18789/v1/chat/completions");
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe("openclaw/default");
    expect(sent.user).toBe("liteforms-realtime-voice");
    expect(sent.messages[0].content).toContain("Search the web for: meteo Paris");
  });

  it("returns 502 with the gateway detail on failure", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => "gateway overloaded" } as unknown as Response);
    const response = await post({ query: "news" });
    const json = await response.json();
    expect(response.status).toBe(502);
    expect(json).toEqual({ error: "gateway overloaded" });
  });

  it("returns 502 when the gateway is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const response = await post({ query: "news" });
    const json = await response.json();
    expect(response.status).toBe(502);
    expect(json).toEqual({ error: "connect ECONNREFUSED" });
  });

  it("prefers the durable store token and never echoes or logs it", async () => {
    process.env.LITEFORMS_CREDENTIALS_PATH = resolveProviderCredentialsPath(dir);
    saveCredential(resolveProviderCredentialsPath(dir), "openclaw", STORED_TOKEN);
    fetchMock.mockResolvedValue(okGateway());

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const response = await post({ query: "news", token: BODY_TOKEN });
    const json = await response.json();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${STORED_TOKEN}`);
    expect(JSON.stringify(json)).not.toContain(STORED_TOKEN);
    expect(logSpy.mock.calls.map((call) => call.join(" ")).join("\n")).not.toContain(STORED_TOKEN);
  });

  it("falls back to body.token then env when the store is empty", async () => {
    fetchMock.mockResolvedValue(okGateway());
    await post({ query: "news", token: BODY_TOKEN });
    let [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${BODY_TOKEN}`);

    fetchMock.mockClear();
    process.env.OPENCLAW_GATEWAY_TOKEN = ENV_TOKEN;
    await post({ query: "news" });
    [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${ENV_TOKEN}`);
  });

  it("sends no Authorization header when no token is available", async () => {
    fetchMock.mockResolvedValue(okGateway());
    await post({ query: "news" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
