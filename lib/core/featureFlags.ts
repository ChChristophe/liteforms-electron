import featuresConfig from "../../features.json";

/**
 * Feature flags (ARCHITECTURE_BUNDLE.md §5).
 * Single source of truth for bundle activation, read from features.json.
 */
export function isBundleEnabled(bundleId: string): boolean {
  return (featuresConfig as Record<string, boolean>)[bundleId] === true;
}

export function getEnabledBundles(): string[] {
  return Object.entries(featuresConfig as Record<string, boolean>)
    .filter(([, enabled]) => enabled === true)
    .map(([id]) => id);
}
