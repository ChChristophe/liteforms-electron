// Module-memory POC state (non durable by design, see POC.md §3.2). The
// standalone Next server is a single process in the packaged app, so this is
// reliably shared between route handlers; userData persistence comes later.
// Kept in lib/ (not in a route file): Next.js route files may only export
// HTTP handlers, and app/api/poc/pending-config imports these helpers.
import type { PocDeviceConfig } from "./pocConfig";

let pendingConfig: (PocDeviceConfig & { receivedAt: string }) | null = null;

export function readPendingConfig() {
  return pendingConfig;
}

export function clearPendingConfig() {
  pendingConfig = null;
}

export function setPendingConfig(config: PocDeviceConfig, receivedAt: string) {
  pendingConfig = { ...config, receivedAt };
}
