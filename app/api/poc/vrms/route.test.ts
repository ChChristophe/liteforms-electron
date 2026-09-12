import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";
import { GET as getFile } from "./file/route";

const originalLibraryDir = process.env.LITEFORMS_VRM_LIBRARY_DIR;

let libraryDir: string;

beforeEach(() => {
  libraryDir = mkdtempSync(join(tmpdir(), "liteforms-vrm-library-"));
  process.env.LITEFORMS_VRM_LIBRARY_DIR = libraryDir;
});

afterEach(() => {
  rmSync(libraryDir, { recursive: true, force: true });
  if (originalLibraryDir === undefined) {
    delete process.env.LITEFORMS_VRM_LIBRARY_DIR;
  } else {
    process.env.LITEFORMS_VRM_LIBRARY_DIR = originalLibraryDir;
  }
});

function writeVrm(fileName: string, bytes: number[]) {
  writeFileSync(join(libraryDir, fileName), new Uint8Array(bytes));
}

describe("GET /api/poc/vrms (Phase C list)", () => {
  it("lists the library *.vrm files with metadata only, plus the built-in VRM", async () => {
    writeVrm("myAvatar.vrm", [1, 2, 3, 4]);
    writeVrm("other.vrm", [5, 6]);
    writeFileSync(join(libraryDir, "readme.txt"), "not a vrm");
    writeFileSync(join(libraryDir, "sub.txt.vrm"), "nested ext");

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    // *.vrm only, no binary, no extra extensions
    expect(json.vrms.map((entry: { fileName: string }) => entry.fileName)).toEqual(
      expect.arrayContaining(["myAvatar.vrm", "other.vrm", "lobsterEdit.vrm"])
    );
    expect(json.vrms).not.toContainEqual(expect.objectContaining({ fileName: "readme.txt" }));
    expect(json.vrms).toEqual(
      expect.arrayContaining([
        { id: "myAvatar", fileName: "myAvatar.vrm", sizeBytes: 4, builtin: false }
      ])
    );
    expect(json.vrms.filter((entry: { builtin: string }) => entry.builtin)).toEqual([
      { id: "lobsterEdit", fileName: "lobsterEdit.vrm", sizeBytes: expect.any(Number), builtin: true }
    ]);
    const serialized = JSON.stringify(json);
    expect(serialized.length).toBeLessThan(4096); // never a binary payload
  });

  it("tolerates a missing library folder (empty list, built-in only)", async () => {
    process.env.LITEFORMS_VRM_LIBRARY_DIR = join(libraryDir, "does-not-exist");

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.vrms).toEqual([{ id: "lobsterEdit", fileName: "lobsterEdit.vrm", sizeBytes: expect.any(Number), builtin: true }]);
  });
});

describe("GET /api/poc/vrms/file (Phase C serving)", () => {
  it("serves a library .vrm as octet-stream", async () => {
    writeVrm("myAvatar.vrm", [9, 8, 7]);

    const response = await getFile(new Request("http://localhost/api/poc/vrms/file?name=myAvatar.vrm"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes]).toEqual([9, 8, 7]);
  });

  it("serves the built-in lobsterEdit.vrm from public/models", async () => {
    const response = await getFile(new Request("http://localhost/api/poc/vrms/file?name=lobsterEdit.vrm"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it.each(["../package.json", "with\\slash.vrm", "no/extension.vrm", "not-a-vrm", ".vrm"])(
    "refuses a traversal/invalid name: %s",
    async (name) => {
      const response = await getFile(new Request(`http://localhost/api/poc/vrms/file?name=${encodeURIComponent(name)}`));

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ ok: false });
    }
  );

  it("returns 404 for a valid name that is not in the library", async () => {
    const response = await getFile(new Request("http://localhost/api/poc/vrms/file?name=absent.vrm"));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, code: "MR_FILE_NOT_FOUND" });
  });
});
