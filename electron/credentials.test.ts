import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerCredentialIpc } from "./credentials";

type IpcHandler = (...args: unknown[]) => unknown;

function captureHandlers() {
  const handlers = new Map<string, IpcHandler>();
  const fakeIpcMain = {
    handle: (channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler);
    }
  };
  return { fakeIpcMain, handlers };
}

describe("credential IPC (decision D1)", () => {
  it("get/set round-trip through the durable file and never log the key", () => {
    const dir = join(tmpdir(), `liteforms-cred-ipc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    try {
      const { fakeIpcMain, handlers } = captureHandlers();
      const logs: string[] = [];
      registerCredentialIpc(fakeIpcMain as never, dir, (line) => logs.push(line));

      const set = handlers.get("liteforms:credential:set")!;
      const get = handlers.get("liteforms:credential:get")!;

      expect(set(null, "openai", "sk-test-key-123")).toBe(true);
      expect(get(null, "openai")).toBe("sk-test-key-123");
      expect(get(null, "unconfigured")).toBeUndefined();

      // Boundary validation: empty/invalid args are rejected without writing.
      expect(set(null, "", "key")).toBe(false);
      expect(set(null, "openai", "")).toBe(false);
      expect(get(null, "")).toBeUndefined();

      // The raw key never appears in logs — only the provider id and a boolean.
      expect(logs.join("\n")).toContain("provider=openai");
      expect(logs.join("\n")).not.toContain("sk-test-key-123");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
