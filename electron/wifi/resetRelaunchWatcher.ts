// Shutdown watcher for POST /api/provisioning/reset (protocol §15/09/2026):
// in normal mode, when wifi-credentials.json disappears from <userData>, the
// appliance relaunches — next boot has no credentials → provisioning mode
// (hotspot). Same relaunch pattern as provisioningBootstrap's accepted
// transition. Windows: unlink events arrive as "rename" with the file name —
// filtering by name + existence check covers both.
import { existsSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

export type CredentialsRemovalWatcher = {
  stop(): void;
};

type WatchFn = (
  dir: string,
  listener: (eventType: string, filename: string | null) => void
) => { close(): void };

const defaultWatch: WatchFn = (dir, listener) =>
  watch(dir, { encoding: "utf8" }, listener) as unknown as FSWatcher;

/** Watches `dir` once for the removal of `fileName`; `onRemoved` fires at most
 * once, only when the file is actually gone (creation events are ignored via
 * the existence check). Returns null when fs.watch is unavailable.
 * ponytail: fs.watch is unreliable on some platforms — if the watcher can't
 * start, a reset lands at the next manual restart instead. Upgrade path: a
 * polling existsSync timer if real units ever miss the relaunch. */
export function watchCredentialsRemoval(
  dir: string,
  fileName: string,
  onRemoved: () => void,
  {
    startWatching = defaultWatch,
    log
  }: { startWatching?: WatchFn; log?: (line: string) => void } = {}
): CredentialsRemovalWatcher | null {
  let fired = false;
  let handle: { close(): void } | null = null;
  try {
    handle = startWatching(dir, (_eventType, filename) => {
      if (fired) return;
      if (filename !== fileName) return; // Other files / .tmp churn ignored.
      if (existsSync(join(dir, fileName))) return; // Create or rewrite, not removal.
      fired = true;
      try {
        handle?.close();
      } catch {
        // Already closed by the runtime.
      }
      onRemoved();
    });
  } catch (error) {
    log?.(`wifi :: credentials-removal watcher unavailable (${String(error)}) — reset applies at next manual restart`);
    return null;
  }
  return {
    stop() {
      fired = true;
      try {
        handle?.close();
      } catch {
        // Already closed.
      }
    }
  };
}
