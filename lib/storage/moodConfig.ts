export const MOOD_CONFIG_KEY = "liteforms.moodConfig";

export const VALID_MOOD_PRESETS = ["happy", "sad", "angry", "surprised", "relaxed"] as const;

export type MoodConfigStore = {
  version: 1;
  mood: string | null;
};

export function saveMoodConfig(config: Omit<MoodConfigStore, "version">): void {
  try {
    localStorage.setItem(MOOD_CONFIG_KEY, JSON.stringify({ version: 1, ...config }));
  } catch {
    // localStorage may be unavailable in private browsing or when quota is exceeded.
  }
}

export function loadMoodConfig(): MoodConfigStore | null {
  try {
    const raw = localStorage.getItem(MOOD_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isMoodConfigStore(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearMoodConfig(): void {
  try {
    localStorage.removeItem(MOOD_CONFIG_KEY);
  } catch {
    // ignore
  }
}

function isMoodConfigStore(value: unknown): value is MoodConfigStore {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    (v.mood === null ||
      (typeof v.mood === "string" && (VALID_MOOD_PRESETS as readonly string[]).includes(v.mood)))
  );
}
