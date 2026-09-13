import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

afterEach(() => {
  delete process.env.LITEFORMS_NETWORK_MODE;
});

describe("GET /api/health (contract v1)", () => {
  it("returns the health payload without secrets (default networkMode wifi)", async () => {
    const response = await GET();

    expect(await response.json()).toEqual({
      ok: true,
      name: "Liteforms Desktop",
      protocolVersion: "1.0",
      configVersions: ["1.0"],
      networkMode: "wifi"
    });
  });

  it("reports the networkMode handed over by the main process", async () => {
    process.env.LITEFORMS_NETWORK_MODE = "provisioning";
    const response = await GET();

    expect((await response.json()).networkMode).toBe("provisioning");
  });
});
