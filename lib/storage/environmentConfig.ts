export const ENVIRONMENT_CONFIG_KEY = "liteforms.environmentConfig";

export type EnvironmentConfigStore = {
  version: 1;
  alcoveColor: string | null;
};

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

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

export function clearEnvironmentConfig(): void {
  try {
    localStorage.removeItem(ENVIRONMENT_CONFIG_KEY);
  } catch {
    // ignore
  }
}

function isEnvironmentConfigStore(value: unknown): value is EnvironmentConfigStore {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    (v.alcoveColor === null ||
      (typeof v.alcoveColor === "string" && HEX_COLOR_PATTERN.test(v.alcoveColor)))
  );
}
