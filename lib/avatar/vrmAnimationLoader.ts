import { AnimationMixer, VectorKeyframeTrack } from "three";
import type { AnimationClip } from "three";
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { VRM } from "@pixiv/three-vrm";
import { createVRMAnimationClip } from "@pixiv/three-vrm-animation";
import type { VRMAnimation } from "@pixiv/three-vrm-animation";

export function recenterHipsTranslation(clip: AnimationClip, vrm: VRM): AnimationClip {
  const hipsNode = vrm.humanoid?.getNormalizedBoneNode("hips");
  if (!hipsNode) {
    return clip;
  }
  const track = clip.tracks.find((candidate) => candidate.name === `${hipsNode.name}.position`);
  if (!(track instanceof VectorKeyframeTrack) || track.times.length === 0) {
    return clip;
  }
  const values = track.values;
  let sumX = 0;
  let sumZ = 0;
  for (let index = 0; index < values.length; index += 3) {
    sumX += values[index] as number;
    sumZ += values[index + 2] as number;
  }
  const sampleCount = values.length / 3;
  const meanX = sumX / sampleCount;
  const meanZ = sumZ / sampleCount;
  track.values = values.map((value, index) => {
    if (index % 3 === 1) {
      return value;
    }
    return value - (index % 3 === 0 ? meanX : meanZ);
  });
  return clip;
}

export async function loadVrmAnimationClip(
  url: string,
  vrm: VRM,
  loader: Pick<GLTFLoader, "loadAsync">
): Promise<AnimationClip | null> {
  const gltf = await loader.loadAsync(url);
  const animations = gltf.userData.vrmAnimations as VRMAnimation[] | undefined;

  if (!animations || animations.length === 0) {
    return null;
  }

  return recenterHipsTranslation(createVRMAnimationClip(animations[0], vrm), vrm);
}

export class VrmIdleAnimator {
  private readonly mixer: AnimationMixer;

  constructor(vrm: VRM, clip: AnimationClip) {
    this.mixer = new AnimationMixer(vrm.scene);
    this.mixer.clipAction(clip).play();
  }

  update(delta: number): void {
    this.mixer.update(delta);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
