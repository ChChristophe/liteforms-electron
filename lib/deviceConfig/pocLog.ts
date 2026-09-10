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

/** Safe summary of a validated payload: field names and IDs only, no values. */
export function describeConfigSummary(config: {
  character: { name: string; pronouns: string };
  avatar: { mood?: string; modelRef?: { id: string; fileName: string } | null; pose?: Record<string, number> | null };
  providers: { llm: { provider: string }; tts: { provider: string }; stt: { provider: string } };
}): string {
  const slots = ["llm", "tts", "stt"] as const;
  return `character.name set=${config.character.name.length > 0} pronouns=${config.character.pronouns} ` +
    `mood=${config.avatar.mood !== undefined ? "present" : "absent"} ` +
    `modelRef=${config.avatar.modelRef ? config.avatar.modelRef.fileName : "none"} ` +
    `pose.keys=${config.avatar.pose ? Object.keys(config.avatar.pose).join("+") || "0" : "none"} ` +
    `providers=${slots.map((slot) => `${slot}:${config.providers[slot].provider}`).join(" ")}`;
}
