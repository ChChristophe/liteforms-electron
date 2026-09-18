import { describe, expect, it, vi } from "vitest";
import { AnimationClip, Group, VectorKeyframeTrack } from "three";
import type { VRM } from "@pixiv/three-vrm";

vi.mock("@pixiv/three-vrm-animation", () => ({
  createVRMAnimationClip: vi.fn()
}));

import { createVRMAnimationClip } from "@pixiv/three-vrm-animation";
import { loadVrmAnimationClip, recenterHipsTranslation, VrmIdleAnimator } from "./vrmAnimationLoader";

const fakeVrm = { scene: new Group() } as unknown as VRM;

function makeLoader(vrmAnimations?: unknown[]) {
  return { loadAsync: vi.fn().mockResolvedValue({ userData: { vrmAnimations } }) };
}

describe("recenterHipsTranslation", () => {
  function makeHipsVrm(hipsName: string | null) {
    return {
      scene: new Group(),
      humanoid: {
        getNormalizedBoneNode: vi.fn((boneName: string) =>
          boneName === "hips" && hipsName !== null ? { name: hipsName } : null
        )
      }
    } as unknown as VRM;
  }

  it("subtracts the mean x/z offsets from the hips track while preserving y and sway", () => {
    const track = new VectorKeyframeTrack("J_Bip_C_Hips.position", [0, 0.5, 1], [
      -16.7, 90.35, 3.01,
      -14.0, 90.47, 3.34,
      -15.35, 90.41, 3.175
    ]);
    const clip = new AnimationClip("idle_loop", 1, [track]);

    recenterHipsTranslation(clip, makeHipsVrm("J_Bip_C_Hips"));

    expect(track.values[0]).toBeCloseTo(-1.35, 5);
    expect(track.values[1]).toBeCloseTo(90.35, 5);
    expect(track.values[2]).toBeCloseTo(-0.165, 5);
    expect(track.values[3]).toBeCloseTo(1.35, 5);
    expect(track.values[4]).toBeCloseTo(90.47, 5);
    expect(track.values[5]).toBeCloseTo(0.165, 5);
    expect(track.values[6]).toBeCloseTo(0, 5);
    expect(track.values[7]).toBeCloseTo(90.41, 5);
    expect(track.values[8]).toBeCloseTo(0, 5);
  });

  it("leaves other tracks untouched and only recenters the hips position", () => {
    const hipsTrack = new VectorKeyframeTrack("J_Bip_C_Hips.position", [0, 1], [-2, 0, -4, -4, 0, -6]);
    const spineTrack = new VectorKeyframeTrack("J_Bip_C_Spine.quaternion", [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
    const clip = new AnimationClip("fidget", 1, [hipsTrack, spineTrack]);

    recenterHipsTranslation(clip, makeHipsVrm("J_Bip_C_Hips"));

    expect(Array.from(hipsTrack.values)).toEqual([1, 0, 1, -1, 0, -1]);
    expect(Array.from(spineTrack.values)).toEqual([0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("returns the clip unchanged when the vrm has no hips node or no matching track", () => {
    const orphanTrack = new VectorKeyframeTrack("Unknown.position", [0, 1], [1, 2, 3, 1, 2, 3]);
    const clipWithoutHips = new AnimationClip("clip-a", 1, [orphanTrack]);

    expect(recenterHipsTranslation(clipWithoutHips, makeHipsVrm(null))).toBe(clipWithoutHips);
    expect(Array.from(orphanTrack.values)).toEqual([1, 2, 3, 1, 2, 3]);

    const untouchedTrack = new VectorKeyframeTrack("Other.position", [0, 1], [1, 2, 3, 1, 2, 3]);
    const clipWithOtherTrack = new AnimationClip("clip-b", 1, [untouchedTrack]);

    expect(recenterHipsTranslation(clipWithOtherTrack, makeHipsVrm("J_Bip_C_Hips"))).toBe(clipWithOtherTrack);
    expect(Array.from(untouchedTrack.values)).toEqual([1, 2, 3, 1, 2, 3]);
  });
});

describe("loadVrmAnimationClip", () => {
  it("resolves the first animation clip from the GLTF", async () => {
    const animation = { name: "idle_loop" };
    const clip = new AnimationClip("idle_loop", 1, []);
    vi.mocked(createVRMAnimationClip).mockReturnValue(clip);
    const loader = makeLoader([animation]);

    const result = await loadVrmAnimationClip("/animations/idle_loop.vrma", fakeVrm, loader as any);

    expect(loader.loadAsync).toHaveBeenCalledWith("/animations/idle_loop.vrma");
    expect(createVRMAnimationClip).toHaveBeenCalledWith(animation, fakeVrm);
    expect(result).toBe(clip);
  });

  it("returns null when the GLTF has no vrmAnimations array", async () => {
    const loader = makeLoader(undefined);
    vi.mocked(createVRMAnimationClip).mockClear();

    const result = await loadVrmAnimationClip("/animations/idle_loop.vrma", fakeVrm, loader as any);

    expect(result).toBeNull();
    expect(createVRMAnimationClip).not.toHaveBeenCalled();
  });

  it("returns null when vrmAnimations is empty", async () => {
    const loader = makeLoader([]);
    vi.mocked(createVRMAnimationClip).mockClear();

    const result = await loadVrmAnimationClip("/animations/idle_loop.vrma", fakeVrm, loader as any);

    expect(result).toBeNull();
    expect(createVRMAnimationClip).not.toHaveBeenCalled();
  });
});

describe("VrmIdleAnimator", () => {
  it("can be constructed, updated, and disposed without throwing", () => {
    const clip = new AnimationClip("idle_loop", 2, []);
    const animator = new VrmIdleAnimator(fakeVrm, clip);

    expect(() => animator.update(1 / 60)).not.toThrow();
    expect(() => animator.dispose()).not.toThrow();
  });

  it("forwards delta to the underlying mixer on each update", () => {
    const clip = new AnimationClip("idle_loop", 2, []);
    const animator = new VrmIdleAnimator(fakeVrm, clip);
    const updateSpy = vi.spyOn(animator["mixer"], "update");

    animator.update(0.016);

    expect(updateSpy).toHaveBeenCalledWith(0.016);
  });
});
