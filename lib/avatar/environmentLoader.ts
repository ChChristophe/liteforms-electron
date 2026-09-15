import type { Material, Mesh, Object3D, Scene, Texture } from "three";
import type { MeshStandardMaterial } from "three";
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { setMeshShadowFlags } from "./shadowSetup";

export type EnvironmentTransform = Pick<Object3D, "scale" | "position">;

type MaterialSnapshot = { colorHex: string; map: Texture | null };

const originalMaterials = new WeakMap<Material, MaterialSnapshot>();

/**
 * Loads a plain GLB environment model and places it in the scene using a
 * reference transform. Custom avatars still use the default lobster's reference
 * transform so the alcove remains a stable size benchmark.
 */
export async function loadEnvironmentGlb(
  url: string,
  loader: Pick<GLTFLoader, "loadAsync">,
  scene: Scene,
  referenceObject: EnvironmentTransform,
  tint?: string
): Promise<Object3D> {
  const gltf = await loader.loadAsync(url);
  const envScene = gltf.scene;
  envScene.scale.copy(referenceObject.scale);
  envScene.position.copy(referenceObject.position);
  if (tint) {
    applyEnvironmentTint(envScene, tint);
  }
  scene.add(envScene);
  setMeshShadowFlags(envScene, true, true);
  return envScene;
}

export function applyEnvironmentTint(root: Object3D | undefined | null, hex?: string): void {
  if (!root) {
    return;
  }
  root.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      applyTintToMaterial(material as MeshStandardMaterial, hex);
    }
  });
}

function applyTintToMaterial(material: MeshStandardMaterial, hex?: string): void {
  if (!material.color) {
    return;
  }
  if (hex) {
    rememberOriginalMaterial(material);
    material.map = null;
    material.needsUpdate = true;
    material.color.set(hex);
    return;
  }
  restoreOriginalMaterial(material);
}

function rememberOriginalMaterial(material: MeshStandardMaterial): void {
  if (originalMaterials.has(material)) {
    return;
  }
  originalMaterials.set(material, {
    colorHex: `#${material.color.getHexString()}`,
    map: material.map
  });
}

function restoreOriginalMaterial(material: MeshStandardMaterial): void {
  const snapshot = originalMaterials.get(material);
  if (!snapshot) {
    return;
  }
  material.map = snapshot.map;
  material.needsUpdate = true;
  material.color.set(snapshot.colorHex);
  originalMaterials.delete(material);
}
