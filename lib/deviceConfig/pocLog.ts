import { appendFileSync } from "node:fs";

// POC tracing helper. One shared line format so the whole mobile->Electron flow
// is readable in the diagnostic log (liteforms-diagnostic.log in userData) and
// in the server console. Rules (POC.md §4): the raw payload is NEVER logged —
// only safe metadata (field names, provider IDs, counters, codes).

export const POC_LOG_PREFIX = "[poc]";

export function pocLog(message: string) {
  const line = `${POC_LOG_PREFIX} ${new Date().toISOString()} ${message}`;
  console.log(line);

  const path = process.env.LITEFORMS_DIAGNOSTIC_LOG;
  if (path) {
    try {
      appendFileSync(path, line + "\n");
    } catch {
      // Diagnostic file unavailable: console output is the fallback.
    }
  }
}
