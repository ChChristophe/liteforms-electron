import { Vector3 } from "three";
import type { Camera, Object3D } from "three";

// Presentation pose (protocol/DEVICE_API.md §Bloc `avatar.pose`). The Mobile
// preview (previewRuntime.ts) is the reference semantics: yaws are RELATIVE to
// the model's natural yaw, zoom divides the framing camera distance and depth
// is a world-Z offset along the camera axis. The bounds are shared with the
// Mobile (types/config.ts) and enforced again here, appliance-side.

/** Zoom camera minimal : dezoom maximal (distance multipliee par 1/min). */
export const POSE_ZOOM_MIN = 0.5;
/** Zoom camera maximal : rapprochement maximal de la camera. */
export const POSE_ZOOM_MAX = 2.5;
/** Profondeur minimale de l'avatar : recul maximal dans l'alcove (unites monde). */
export const POSE_DEPTH_MIN = -0.25;
/** Profondeur maximale de l'avatar : avancement maximal vers la camera. */
export const POSE_DEPTH_MAX = 0.25;

export type AvatarPoseConfig = {
  /** Rotation horizontale cumulee de l'avatar, en radians relatifs. */
  avatarYaw: number;
  /** Rotation horizontale cumulee de l'alcove, en radians relatifs. */
  alcoveYaw: number;
  /** Multiplicateur de distance camera, sans unite. */
  zoom: number;
  /** Decalage de profondeur de l'avatar, en unites monde. */
  depth: number;
};

/** Pose neutre du contrat : face camera, cadrage par defaut. */
export const DEFAULT_AVATAR_POSE: AvatarPoseConfig = { avatarYaw: 0, alcoveYaw: 0, zoom: 1, depth: 0 };

export function clampZoom(zoom: number): number {
  return Math.min(POSE_ZOOM_MAX, Math.max(POSE_ZOOM_MIN, zoom));
}

export function clampDepth(depth: number): number {
  return Math.min(POSE_DEPTH_MAX, Math.max(POSE_DEPTH_MIN, depth));
}

export type AvatarPoseTargets = {
  /** VRM root (vrm.scene). */
  model?: Object3D;
  /** Alcove root. */
  alcove?: Object3D;
  /** Preview camera (ignored by the Looking Glass quilt, handled separately). */
  camera?: Camera;
  /** Framing center the camera looks at / orbits. */
  cameraCenter: Vector3;
  /** Unit direction from the framing center towards the base camera. */
  cameraDirection: Vector3;
  /** Base camera distance at zoom = 1. */
  cameraDistance: number;
  /** Model yaw before applying the pose (natural orientation after VRM rotate). */
  baseAvatarYaw: number;
  /** Alcove yaw before applying the pose (natural orientation from the GLB). */
  baseAlcoveYaw?: number;
  /** Framed model position before applying the depth offset. */
  modelBasePosition?: Vector3;
};

/** Applies a validated pose to scene objects. Pure (no WebGL, no store): the
 * caller owns finding the targets and the base framing values. */
export function applyAvatarPose(targets: AvatarPoseTargets, pose: AvatarPoseConfig): void {
  const zoom = clampZoom(pose.zoom);
  const depth = clampDepth(pose.depth);

  if (targets.model) {
    targets.model.rotation.y = targets.baseAvatarYaw + pose.avatarYaw;
    if (targets.modelBasePosition) {
      targets.model.position.z = targets.modelBasePosition.z + depth;
    }
  }

  if (targets.alcove) {
    targets.alcove.rotation.y = (targets.baseAlcoveYaw ?? 0) + pose.alcoveYaw;
  }

  if (targets.camera) {
    targets.camera.position
      .copy(targets.cameraCenter)
      .addScaledVector(targets.cameraDirection, targets.cameraDistance / zoom);
    targets.camera.lookAt(targets.cameraCenter);
  }
}
