import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// POC Phase C (POC.md §5.2, §6.2): local VRM library `<userData>/vrm-library/`
// where the user drops .vrm files by hand (no upload, no network catalog).
// The Next server learns the folder through LITEFORMS_VRM_LIBRARY_DIR, set by
// the Electron main process when it spawns the Next server.
// Metadata only here: a .vrm binary NEVER goes into a JSON list �?" serving is
// done by GET /api/poc/vrms/file with a strict name allowlist.

export const BUILTIN_VRM_FILE_NAME = "lobsterEdit.vrm";

// Anti path-traversal allowlist (trust boundary: the mobile may send any
// `name`). Rejects slashes, backslashes, `..`, extensionless or non-vrm names.
const VRM_FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.vrm$/;

export function isValidVrmFileName(name: string): boolean {
  return VRM_FILE_NAME_PATTERN.test(name);
}

export type VrmLibraryEntry = {
  id: string;
  fileName: string;
  sizeBytes: number | null;
  builtin: boolean;
};

/** Lists the `*.vrm` files of the library folder (metadata only). A missing
 * or unreadable folder yields an empty list (never a crashed route). */
export function listLibraryVrms(dir: string): VrmLibraryEntry[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const result: VrmLibraryEntry[] = [];
  for (const fileName of entries) {
    if (!isValidVrmFileName(fileName)) continue;
    let sizeBytes: number | null = null;
    try {
      const stats = statSync(join(dir, fileName));
      if (!stats.isFile()) continue;
      sizeBytes = stats.size;
    } catch {
      continue;
    }
    result.push({ id: fileName.replace(/\.vrm$/i, ""), fileName, sizeBytes, builtin: false });
  }
  return result;
}

/** Path of the built-in bundled VRM (`public/models`); null if absent. */
export function resolveBuiltinVrmPath(): string | null {
  return join(process.cwd(), "public", "models", BUILTIN_VRM_FILE_NAME);
}
