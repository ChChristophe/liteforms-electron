import { describe, expect, it } from "vitest";
import { redactDiagnosticLine } from "./diagnosticRedact";

describe("redactDiagnosticLine", () => {
  it("masks OpenAI-style keys", () => {
    expect(redactDiagnosticLine("request failed sk-proj-abc123DEF_gh")).toBe("request failed sk-***");
  });

  it("masks bearer tokens including the value after a key prefix", () => {
    expect(redactDiagnosticLine("Authorization=Bearer abc.def.ghi")).toBe("Authorization=*** ***");
  });

  it("masks credential key/value pairs", () => {
    expect(redactDiagnosticLine("apiKey: supersecret123")).toBe("apiKey: ***");
    expect(redactDiagnosticLine('{"token":"abc123"}')).toBe('{"token":"***"}');
  });

  it("masks the config.credential field (LLM proxy body)", () => {
    expect(redactDiagnosticLine('{"provider":"openai","credential":"sk-proj-abcdef123456"}')).toBe(
      '{"provider":"openai","credential":"***"}'
    );
    expect(redactDiagnosticLine("credential=Bearer abc.def")).toBe("credential=*** ***");
  });

  it("leaves normal diagnostic lines untouched", () => {
    const line = "[webContents:child] did-navigate :: http://127.0.0.1:54337/hologram bounds=0,0 1536x864 fs=true";
    expect(redactDiagnosticLine(line)).toBe(line);
  });
});
