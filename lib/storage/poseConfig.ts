import { DEFAULT_AVATAR_POSE, type AvatarPoseConfig } from "@/lib/avatar/avatarPose";

export const POSE_CONFIG_KEY = "liteforms.poseConfig";

export type PoseConfigStore = {
  version: 1;
  pose: AvatarPoseConfig;
};

export function savePoseConfig(pose: AvatarPoseConfig): void {
  try {
    localStorage.setItem(POSE_CONFIG_KEY, JSON.stringify({ version: 1, pose }));
  } catch {
    // localStorage may be unavailable in private browsing or when quota is exceeded.
  }
}

export function loadPoseConfig(): PoseConfigStore | null {
  try {
    const raw = localStorage.getItem(POSE_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isPoseConfigStore(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPoseConfig(): void {
  try {
    localStorage.removeItem(POSE_CONFIG_KEY);
  } catch {
    // ignore
  }
}

function isPoseConfigStore(value: unknown): value is PoseConfigStore {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return false;
  const pose = v.pose;
  if (typeof pose !== "object" || pose === null) return false;
  const p = pose as Record<string, unknown>;
  return (["avatarYaw", "alcoveYaw", "zoom", "depth"] as const).every(
    (field) => typeof p[field] === "number" && Number.isFinite(p[field])
  );
}

/** Stored pose or the contract's neutral defaults (never null). */
export function loadPoseOrDefault(): AvatarPoseConfig {
  return loadPoseConfig()?.pose ?? DEFAULT_AVATAR_POSE;
}
