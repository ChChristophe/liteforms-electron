import { describe, expect, it } from "vitest";
import { Object3D, PerspectiveCamera, Vector3 } from "three";
import {
  DEFAULT_AVATAR_POSE,
  POSE_DEPTH_MAX,
  POSE_DEPTH_MIN,
  POSE_ZOOM_MAX,
  POSE_ZOOM_MIN,
  applyAvatarPose,
  clampDepth,
  clampZoom,
  type AvatarPoseTargets,
} from "./avatarPose";

function dummyTargets(overrides: Partial<AvatarPoseTargets> = {}): AvatarPoseTargets {
  return {
    cameraCenter: new Vector3(0, 0, 0),
    cameraDirection: new Vector3(0, 0, 1),
    cameraDistance: 10,
    baseAvatarYaw: 0,
    ...overrides,
  };
}

describe("clampZoom / clampDepth", () => {
  it("clamps to the contract bounds", () => {
    expect(clampZoom(99)).toBe(POSE_ZOOM_MAX);
    expect(clampZoom(0.01)).toBe(POSE_ZOOM_MIN);
    expect(clampZoom(1.3)).toBe(1.3);
    expect(clampDepth(5)).toBe(POSE_DEPTH_MAX);
    expect(clampDepth(-5)).toBe(POSE_DEPTH_MIN);
    expect(clampDepth(0.1)).toBe(0.1);
  });
});

describe("applyAvatarPose", () => {
  it("sets the model yaw RELATIVE to the natural yaw and the alcove yaw", () => {
    const model = new Object3D();
    model.rotation.y = Math.PI; // VRM 0.x natural orientation after rotateVRM0
    const alcove = new Object3D();

    applyAvatarPose(
      dummyTargets({ model, alcove, baseAvatarYaw: Math.PI }),
      { avatarYaw: 0.5, alcoveYaw: -0.25, zoom: 1, depth: 0 }
    );

    expect(model.rotation.y).toBeCloseTo(Math.PI + 0.5);
    expect(alcove.rotation.y).toBeCloseTo(-0.25);
  });

  it("moves the camera along the framing direction by distance / zoom", () => {
    const camera = new PerspectiveCamera();

    applyAvatarPose(
      dummyTargets({ camera, cameraCenter: new Vector3(0, 1, 0), cameraDistance: 10 }),
      { ...DEFAULT_AVATAR_POSE, zoom: 2 }
    );

    expect(camera.position.x).toBeCloseTo(0);
    expect(camera.position.y).toBeCloseTo(1);
    expect(camera.position.z).toBeCloseTo(5);
  });

  it("applies depth as a world-Z offset around the framed position", () => {
    const model = new Object3D();
    model.position.set(0.1, 0.5, 1.2);
    const modelBasePosition = model.position.clone();

    applyAvatarPose(
      dummyTargets({ model, modelBasePosition }),
      { ...DEFAULT_AVATAR_POSE, depth: 0.2 }
    );

    expect(model.position.z).toBeCloseTo(1.4);
    expect(model.position.x).toBeCloseTo(0.1);
    expect(model.position.y).toBeCloseTo(0.5);
  });

  it("clamps an out-of-bounds zoom/depth before applying it", () => {
    const model = new Object3D();
    model.position.set(0, 0, 0);
    const camera = new PerspectiveCamera();

    applyAvatarPose(
      dummyTargets({ model, modelBasePosition: new Vector3(0, 0, 0), camera }),
      { ...DEFAULT_AVATAR_POSE, zoom: 99, depth: -99 }
    );

    expect(camera.position.z).toBeCloseTo(10 / POSE_ZOOM_MAX);
    expect(model.position.z).toBeCloseTo(POSE_DEPTH_MIN);
  });
});

describe("DEFAULT_AVATAR_POSE contract", () => {
  // Written with literals on purpose: if the neutral pose changes, this test
  // fails and forces a protocol/contract discussion instead of a silent drift.
  it("is exactly the neutral reset sent by the Mobile", () => {
    expect(DEFAULT_AVATAR_POSE).toEqual({ avatarYaw: 0, alcoveYaw: 0, zoom: 1, depth: 0 });
  });
});

describe("applyAvatarPose reset invariant", () => {
  const BASE_AVATAR_YAW = 0.4;
  const BASE_ALCOVE_YAW = 0.7;
  const MODEL_BASE_Z = -1.2;

  function resetTargets() {
    const model = new Object3D();
    model.position.set(0, 0, MODEL_BASE_Z);
    const alcove = new Object3D();
    alcove.rotation.y = BASE_ALCOVE_YAW;
    const camera = new PerspectiveCamera();
    return {
      model,
      alcove,
      camera,
      targets: dummyTargets({
        model,
        alcove,
        camera,
        cameraCenter: new Vector3(0, 0, 0),
        cameraDirection: new Vector3(0, 0, 1),
        cameraDistance: 10,
        baseAvatarYaw: BASE_AVATAR_YAW,
        baseAlcoveYaw: BASE_ALCOVE_YAW,
        modelBasePosition: new Vector3(0, 0, MODEL_BASE_Z),
      }),
    };
  }

  it("restores the appliance default rendering for all four fields", () => {
    const { model, alcove, camera, targets } = resetTargets();

    applyAvatarPose(targets, DEFAULT_AVATAR_POSE);

    expect(model.rotation.y).toBeCloseTo(BASE_AVATAR_YAW);
    expect(alcove.rotation.y).toBeCloseTo(BASE_ALCOVE_YAW);
    expect(model.position.z).toBeCloseTo(MODEL_BASE_Z);
    expect(camera.position.distanceTo(targets.cameraCenter)).toBeCloseTo(10);
  });

  it("adds the offsets on top of the natural bases for a non-neutral pose", () => {
    const { model, alcove, camera, targets } = resetTargets();

    applyAvatarPose(targets, { avatarYaw: 0.5, alcoveYaw: -0.25, zoom: 2, depth: 0.2 });

    expect(model.rotation.y).toBeCloseTo(BASE_AVATAR_YAW + 0.5);
    expect(alcove.rotation.y).toBeCloseTo(BASE_ALCOVE_YAW - 0.25);
    expect(model.position.z).toBeCloseTo(MODEL_BASE_Z + 0.2);
    expect(camera.position.distanceTo(targets.cameraCenter)).toBeCloseTo(10 / 2);
  });
});
