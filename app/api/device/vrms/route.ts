import { statSync } from "node:fs";
import { NextResponse } from "next/server";
import { pocLog } from "@/lib/deviceConfig/pocLog";
import {
  BUILTIN_VRM_FILE_NAME,
  listLibraryVrms,
  resolveBuiltinVrmPath,
  type VrmLibraryEntry
} from "@/lib/deviceConfig/vrmLibrary";

// Device route (stable, requalified from the POC namespace): metadata of the
// local VRM library (<userData>/vrm-library/) plus the built-in bundled VRM.
// Never a binary in the list, never a secret; logs only counters
// (POC.md §5.2, §12 Phase C, §13.5 point 2).
export async function GET() {
  const dir = process.env.LITEFORMS_VRM_LIBRARY_DIR;
  const fromLibrary = dir ? listLibraryVrms(dir) : [];

  const vrms: VrmLibraryEntry[] = [...fromLibrary];
  if (!fromLibrary.some((entry) => entry.fileName === BUILTIN_VRM_FILE_NAME)) {
    try {
      // The built-in VRM lives beside the server (public/models); if it is
      // absent (mispackaged build) the entry is just not advertised.
      const builtinPath = resolveBuiltinVrmPath();
      if (!builtinPath) throw new Error("missing builtin");
      vrms.push({
        id: BUILTIN_VRM_FILE_NAME.replace(/\.vrm$/i, ""),
        fileName: BUILTIN_VRM_FILE_NAME,
        sizeBytes: statSync(builtinPath).size,
        builtin: true
      });
    } catch {
      // Built-in missing: skip the entry instead of failing the route.
    }
  }

  pocLog(`vrms GET :: count=${vrms.length} local=${fromLibrary.length} builtin=${vrms.length > fromLibrary.length ? 1 : 0}`);
  return NextResponse.json({ ok: true, vrms });
}
