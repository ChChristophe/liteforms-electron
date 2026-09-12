export const ENVIRONMENT_CONFIG_KEY = "liteforms.environmentConfig";

export type EnvironmentConfigStore = {
  version: 1;
  alcoveColor: string;
};

export function saveEnvironmentConfig(config: Omit<EnvironmentConfigStore, "version">): void {
  try {
    localStorage.setItem(ENVIRONMENT_CONFIG_KEY, JSON.stringify({ version: 1, ...config }));
  } catch {
    // localStorage may be unavailable in private browsing or when quota is exceeded.
  }
}

export function loadEnvironmentConfig(): EnvironmentConfigStore | null {
  try {
    const raw = localStorage.getItem(ENVIRONMENT_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isEnvironmentConfigStore(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isEnvironmentConfigStore(value: unknown): value is EnvironmentConfigStore {
  return typeof value === "object" && value !== null &&
    (value as Record<string, unknown>).version === 1 &&
    typeof (value as Record<string, unknown>).alcoveColor === "string";
}
