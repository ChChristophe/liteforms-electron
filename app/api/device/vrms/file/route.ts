import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { pocLog } from "@/lib/deviceConfig/pocLog";
import {
  BUILTIN_VRM_FILE_NAME,
  isValidVrmFileName
} from "@/lib/deviceConfig/vrmLibrary";

// Device route (stable, requalified from the POC namespace): serves a .vrm
// binary from the local library (<userData>/vrm-library/) or the built-in
// public/models copy. SECURITY (trust boundary: the mobile may send any
// `name`): the name is validated against a strict allowlist that forbids
// separators and traversal (`/`, `\`, `..`); anything else -> 404. No secret
// payload, logs carry only the file name and size (POC.md §5.2, §12 Phase C).
export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name") ?? "";
  if (!isValidVrmFileName(name)) {
    pocLog("vrms/file GET :: rejected invalid-name");
    return NextResponse.json(
      { ok: false, code: "MR_FILE_NOT_FOUND", message: "Unknown VRM file" },
      { status: 404 }
    );
  }

  const path = name === BUILTIN_VRM_FILE_NAME
    ? join(process.cwd(), "public", "models", name)
    : join(process.env.LITEFORMS_VRM_LIBRARY_DIR ?? "", name);

  let bytes: Buffer;
  try {
    bytes = readFileSync(path); // Also throws for directories (EISDIR).
  } catch {
    pocLog(`vrms/file GET :: missing fileName=${name}`);
    return NextResponse.json(
      { ok: false, code: "MR_FILE_NOT_FOUND", message: "Unknown VRM file" },
      { status: 404 }
    );
  }

  pocLog(`vrms/file GET :: served fileName=${name} size=${bytes.length}`);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(bytes.length)
    }
  });
}
