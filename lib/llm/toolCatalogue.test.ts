import { describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS, TOOL_INSTRUCTIONS } from "./toolCatalogue";

const EXPECTED_TOOL_NAMES = [
  "get_current_time",
  "get_current_date",
  "start_timer",
  "get_timer_status",
  "cancel_timer",
  "list_timers",
  "calculate"
];

describe("shared tool catalogue", () => {
  it("exposes exactly the seven tools of this step, in a stable order", () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual(EXPECTED_TOOL_NAMES);
  });

  it("does not advertise the not-yet-implemented openclaw_web_search tool", () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).not.toContain("openclaw_web_search");
    expect(TOOL_INSTRUCTIONS).not.toContain("openclaw_web_search");
  });

  it("gives every tool a description and a JSON-schema parameters object", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters.type).toBe("object");
      expect(tool.parameters.properties).toBeTypeOf("object");
    }
  });

  it("documents the normative postfix percentage semantics of calculate", () => {
    const calculate = TOOL_DEFINITIONS.find((tool) => tool.name === "calculate");
    expect(calculate?.description).toContain("`%` is a postfix percentage");
    expect(calculate?.description).toContain("`200 * 10%` = 20");
    expect(calculate?.description).toContain("`200 + 10%` = 220");
    expect(calculate?.description).toContain("`200 - 10%` = 180");
    expect(calculate?.parameters.properties?.expression?.description).toContain("200 + 10%");
  });

  it("keeps the USE IT rule and the timer guidance from the reference", () => {
    expect(TOOL_INSTRUCTIONS).toContain("If you are unsure whether to use a tool, USE IT");
    expect(TOOL_INSTRUCTIONS).toContain("TIMERS:");
  });
});
