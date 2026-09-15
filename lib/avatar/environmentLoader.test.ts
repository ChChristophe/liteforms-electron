import { describe, expect, it, vi } from "vitest";
import { Group, Mesh, MeshStandardMaterial, Scene, Texture, Vector3 } from "three";

import { applyEnvironmentTint, loadEnvironmentGlb } from "./environmentLoader";

function makeLoader(scene: Group) {
  return { loadAsync: vi.fn().mockResolvedValue({ scene }) };
}

describe("loadEnvironmentGlb", () => {
  it("loads the GLB at the given URL", async () => {
    const envScene = new Group();
    const loader = makeLoader(envScene);
    const parentScene = new Scene();
    const reference = new Group();

    await loadEnvironmentGlb("/models/Alcove.glb", loader as any, parentScene, reference);

    expect(loader.loadAsync).toHaveBeenCalledWith("/models/Alcove.glb");
  });

  it("copies the reference object's scale onto the loaded scene", async () => {
    const envScene = new Group();
    const loader = makeLoader(envScene);
    const parentScene = new Scene();
    const reference = new Group();
    reference.scale.setScalar(0.75);

    await loadEnvironmentGlb("/models/Alcove.glb", loader as any, parentScene, reference);

    expect(envScene.scale.x).toBeCloseTo(0.75);
    expect(envScene.scale.y).toBeCloseTo(0.75);
    expect(envScene.scale.z).toBeCloseTo(0.75);
  });

  it("copies the reference object's position onto the loaded scene", async () => {
    const envScene = new Group();
    const loader = makeLoader(envScene);
    const parentScene = new Scene();
    const reference = new Group();
    reference.position.set(1.2, -0.3, 0.5);

    await loadEnvironmentGlb("/models/Alcove.glb", loader as any, parentScene, reference);

    expect(envScene.position).toEqual(new Vector3(1.2, -0.3, 0.5));
  });

  it("adds the loaded scene to the parent scene", async () => {
    const envScene = new Group();
    const loader = makeLoader(envScene);
    const parentScene = new Scene();
    const reference = new Group();

    await loadEnvironmentGlb("/models/Alcove.glb", loader as any, parentScene, reference);

    expect(parentScene.children).toContain(envScene);
  });

  it("returns the loaded scene so callers can toggle visibility later", async () => {
    const envScene = new Group();
    const loader = makeLoader(envScene);
    const parentScene = new Scene();
    const reference = new Group();

    await expect(loadEnvironmentGlb("/models/Alcove.glb", loader as any, parentScene, reference))
      .resolves.toBe(envScene);
  });

  it("sets castShadow=true on all Mesh children of the loaded GLB", async () => {
    const envScene = new Group();
    const meshA = new Mesh();
    const inner = new Group();
    const meshB = new Mesh();
    inner.add(meshB);
    envScene.add(meshA, inner);
    const loader = makeLoader(envScene);
    const parentScene = new Scene();
    const reference = new Group();

    await loadEnvironmentGlb("/models/Alcove.glb", loader as any, parentScene, reference);

    expect(meshA.castShadow).toBe(true);
    expect(meshB.castShadow).toBe(true);
  });

  it("sets receiveShadow=true on all Mesh children of the loaded GLB", async () => {
    const envScene = new Group();
    const meshA = new Mesh();
    const inner = new Group();
    const meshB = new Mesh();
    inner.add(meshB);
    envScene.add(meshA, inner);
    const loader = makeLoader(envScene);
    const parentScene = new Scene();
    const reference = new Group();

    await loadEnvironmentGlb("/models/Alcove.glb", loader as any, parentScene, reference);

    expect(meshA.receiveShadow).toBe(true);
    expect(meshB.receiveShadow).toBe(true);
  });

  it("does not set shadow flags on non-Mesh (Group) nodes", async () => {
    const envScene = new Group();
    const group = new Group();
    group.castShadow = false;
    group.receiveShadow = false;
    envScene.add(group);
    const loader = makeLoader(envScene);
    const parentScene = new Scene();
    const reference = new Group();

    await loadEnvironmentGlb("/models/Alcove.glb", loader as any, parentScene, reference);

    expect(group.castShadow).toBe(false);
    expect(group.receiveShadow).toBe(false);
  });

  it("tints every mesh material when a tint color is provided", async () => {
    const envScene = new Group();
    const meshA = new Mesh();
    const meshB = new Mesh();
    envScene.add(meshA, meshB);
    const loader = makeLoader(envScene);
    const parentScene = new Scene();
    const reference = new Group();

    await loadEnvironmentGlb("/models/Alcove.glb", loader as any, parentScene, reference, "#ff0000");

    const materialA = meshA.material as MeshStandardMaterial;
    expect(materialA.color.getHexString()).toBe("ff0000");
    expect(materialA.map).toBeNull();
  });

  it("leaves materials untouched when no tint is provided", async () => {
    const envScene = new Group();
    const material = new MeshStandardMaterial({ color: 0x224466 });
    const mesh = new Mesh(undefined, material);
    envScene.add(mesh);
    const loader = makeLoader(envScene);
    const parentScene = new Scene();
    const reference = new Group();

    await loadEnvironmentGlb("/models/Alcove.glb", loader as any, parentScene, reference);

    expect(material.color.getHexString()).toBe("224466");
  });

  it("restores original colors and maps when the tint is cleared", async () => {
    const envScene = new Group();
    const map = new Texture();
    const material = new MeshStandardMaterial({ color: 0x224466, map });
    const mesh = new Mesh(undefined, material);
    envScene.add(mesh);

    applyEnvironmentTint(envScene, "#ff0000");
    expect(material.color.getHexString()).toBe("ff0000");
    expect(material.map).toBeNull();

    applyEnvironmentTint(envScene, undefined);
    expect(material.color.getHexString()).toBe("224466");
    expect(material.map).toBe(map);
  });

  it("ignores nodes without meshes when applying a tint", () => {
    const envScene = new Group();

    expect(() => applyEnvironmentTint(envScene, "#ff0000")).not.toThrow();
    expect(() => applyEnvironmentTint(null, "#ff0000")).not.toThrow();
    expect(() => applyEnvironmentTint(envScene, undefined)).not.toThrow();
  });
});
