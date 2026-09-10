import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/health (contract v1)", () => {
  it("returns the health payload without secrets", async () => {
    const response = await GET();

    expect(await response.json()).toEqual({
      ok: true,
      name: "Liteforms Desktop",
      protocolVersion: "1.0",
      configVersions: ["1.0"],
      networkMode: "wifi"
    });
  });
});
