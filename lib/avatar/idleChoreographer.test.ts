import { describe, expect, it, vi } from "vitest";
import { AnimationClip, Object3D, VectorKeyframeTrack } from "three";
import type { VRM } from "@pixiv/three-vrm";
import { IdleChoreographer } from "./idleChoreographer";

function makeRig() {
  const root = new Object3D();
  const bone = new Object3D();
  bone.name = "bone";
  root.add(bone);
  return { root, bone };
}

function makeVrm() {
  return { scene: makeRig().root } as unknown as VRM;
}

function makeClip(name: string, duration: number) {
  const times = [0, duration / 2, duration];
  const values = new Float32Array([0, 0, 0, 0, 0.05, 0, 0, 0, 0]);
  return new AnimationClip(name, duration, [new VectorKeyframeTrack("bone.position", times, values)]);
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("IdleChoreographer", () => {
  it("keeps looping idle until the scheduled duration elapses, then loads a fidget", async () => {
    const random = vi.fn(() => 0);
    const loadClip = vi.fn(async () => makeClip("fidget-a", 0.2));
    const choreographer = new IdleChoreographer(makeVrm(), {
      idleClip: makeClip("idle", 4),
      loadClip,
      fidgetUrls: ["/a.vrma", "/b.vrma"],
      idleDurationRangeMs: [1000, 1000],
      fadeSeconds: 0.05,
      random
    });

    choreographer.update(0.4);
    choreographer.update(0.4);
    expect(loadClip).not.toHaveBeenCalled();

    choreographer.update(0.3);
    expect(loadClip).toHaveBeenCalledTimes(1);
    expect(loadClip).toHaveBeenCalledWith("/a.vrma");

    await flushMicrotasks();
    choreographer.update(0.01);
    expect(loadClip).toHaveBeenCalledTimes(1);
    choreographer.dispose();
  });

  it("plays the fidget once, fades back to idle, notifies, and avoids repeating the same fidget", async () => {
    const random = vi.fn(() => 0);
    const onFidgetEnd = vi.fn();
    const onFidgetStart = vi.fn();
    const clipsByName = new Map<string, AnimationClip>();
    const loadClip = vi.fn(async (url: string) => {
      const clip = makeClip(url, 0.2);
      clipsByName.set(url, clip);
      return clip;
    });
    const choreographer = new IdleChoreographer(makeVrm(), {
      idleClip: makeClip("idle", 4),
      loadClip,
      fidgetUrls: ["/a.vrma", "/b.vrma"],
      idleDurationRangeMs: [1000, 1000],
      fadeSeconds: 0.05,
      random,
      onFidgetStart,
      onFidgetEnd
    });

    choreographer.update(1.1);
    await flushMicrotasks();

    choreographer.update(0.06);
    expect(choreographer.idleWeight).toBeCloseTo(0, 5);
    expect(onFidgetStart).toHaveBeenCalledTimes(1);
    expect(onFidgetEnd).not.toHaveBeenCalled();

    choreographer.update(0.2);
    choreographer.update(0.02);
    expect(onFidgetEnd).not.toHaveBeenCalled();

    choreographer.update(0.04);
    expect(onFidgetEnd).toHaveBeenCalledTimes(1);

    choreographer.update(0.02);
    expect(choreographer.idleWeight).toBeCloseTo(1, 5);

    choreographer.update(0.88);
    expect(loadClip).toHaveBeenCalledTimes(1);
    choreographer.update(0.2);
    expect(loadClip).toHaveBeenLastCalledWith("/b.vrma");
    expect(onFidgetStart).toHaveBeenCalledTimes(1);

    choreographer.dispose();
  });

  it("falls back to idle and reschedules when a fidget fails to load", async () => {
    let attempt = 0;
    const random = vi.fn(() => 0);
    const onFidgetEnd = vi.fn();
    const onFidgetStart = vi.fn();
    const loadClip = vi.fn(async () => {
      attempt += 1;
      return attempt === 1 ? null : makeClip("fidget-b", 0.2);
    });
    const choreographer = new IdleChoreographer(makeVrm(), {
      idleClip: makeClip("idle", 4),
      loadClip,
      fidgetUrls: ["/only.vrma"],
      idleDurationRangeMs: [500, 500],
      fadeSeconds: 0.05,
      random,
      onFidgetStart,
      onFidgetEnd
    });

    choreographer.update(0.6);
    await flushMicrotasks();
    expect(onFidgetEnd).not.toHaveBeenCalled();
    expect(onFidgetStart).not.toHaveBeenCalled();

    choreographer.update(0.6);
    await flushMicrotasks();
    expect(attempt).toBe(2);

    choreographer.dispose();
  });

  it("stops driving the mixer after dispose even if a pending load resolves later", async () => {
    let resolveLoad: ((clip: AnimationClip | null) => void) | undefined;
    const random = vi.fn(() => 0);
    const onFidgetEnd = vi.fn();
    const loadClip = vi.fn(
      () =>
        new Promise<AnimationClip | null>((resolve) => {
          resolveLoad = resolve;
        })
    );
    const choreographer = new IdleChoreographer(makeVrm(), {
      idleClip: makeClip("idle", 4),
      loadClip,
      fidgetUrls: ["/a.vrma"],
      idleDurationRangeMs: [200, 200],
      fadeSeconds: 0.05,
      random,
      onFidgetEnd
    });

    choreographer.update(0.3);
    choreographer.dispose();
    resolveLoad?.(makeClip("late-fidget", 0.2));
    await flushMicrotasks();

    expect(() => choreographer.update(10)).not.toThrow();
    expect(onFidgetEnd).not.toHaveBeenCalled();
  });

  it("playClipNow plays the requested clip once then returns to idle", async () => {
    const random = vi.fn(() => 0);
    const onFidgetEnd = vi.fn();
    const onFidgetStart = vi.fn();
    const loadClip = vi.fn(async (url: string) => makeClip(url, 0.2));
    const choreographer = new IdleChoreographer(makeVrm(), {
      idleClip: makeClip("idle", 4),
      loadClip,
      fidgetUrls: ["/a.vrma"],
      idleDurationRangeMs: [60_000, 60_000],
      fadeSeconds: 0.05,
      random,
      onFidgetStart,
      onFidgetEnd
    });

    choreographer.playClipNow("/greeting.vrma");
    expect(loadClip).toHaveBeenCalledWith("/greeting.vrma");
    await flushMicrotasks();
    expect(onFidgetStart).toHaveBeenCalledTimes(1);

    choreographer.update(0.06);
    expect(choreographer.idleWeight).toBeCloseTo(0, 5);

    choreographer.update(0.25);
    choreographer.update(0.02);
    choreographer.update(0.04);
    expect(onFidgetEnd).toHaveBeenCalledTimes(1);
    choreographer.update(0.02);
    expect(choreographer.idleWeight).toBeCloseTo(1, 5);

    // The scheduled fidget cycle resumes from a fresh full duration.
    choreographer.update(59.9);
    expect(loadClip).toHaveBeenLastCalledWith("/greeting.vrma");
    choreographer.update(0.2);
    expect(loadClip).toHaveBeenLastCalledWith("/a.vrma");

    choreographer.dispose();
  });

  it("playClipNow interrupts a playing fidget and supersedes pending loads", async () => {
    const random = vi.fn(() => 0);
    const onFidgetStart = vi.fn();
    const resolvers = new Map<string, (clip: AnimationClip | null) => void>();
    const loadClip = vi.fn(
      (url: string) =>
        new Promise<AnimationClip | null>((resolve) => {
          resolvers.set(url, resolve);
        })
    );
    const choreographer = new IdleChoreographer(makeVrm(), {
      idleClip: makeClip("idle", 4),
      loadClip,
      fidgetUrls: ["/a.vrma"],
      idleDurationRangeMs: [100, 100],
      fadeSeconds: 0.05,
      random,
      onFidgetStart
    });

    // Scheduled fidget load goes in flight...
    choreographer.update(0.15);
    expect(loadClip).toHaveBeenCalledWith("/a.vrma");

    // ...then an explicit cue invalidates it and wins.
    choreographer.playClipNow("/greeting.vrma");
    resolvers.get("/a.vrma")?.(makeClip("stale-a", 0.2));
    resolvers.get("/greeting.vrma")?.(makeClip("greeting", 0.2));
    await flushMicrotasks();

    expect(onFidgetStart).toHaveBeenCalledTimes(1);

    // A second cue while the first is still loading also wins cleanly.
    choreographer.playClipNow("/greeting.vrma");
    resolvers.get("/greeting.vrma")?.(makeClip("greeting-2", 0.2));
    await flushMicrotasks();
    expect(onFidgetStart).toHaveBeenCalledTimes(2);

    choreographer.dispose();

    // After dispose, playClipNow must not trigger any load.
    const before = loadClip.mock.calls.length;
    choreographer.playClipNow("/greeting.vrma");
    expect(loadClip.mock.calls.length).toBe(before);
  });

  it("playClipNow falls back to the idle cycle when the cue clip fails to load", async () => {
    const random = vi.fn(() => 0);
    const onFidgetStart = vi.fn();
    const loadClip = vi.fn(async (url: string) =>
      url === "/missing.vrma" ? null : makeClip(url, 0.2)
    );
    const choreographer = new IdleChoreographer(makeVrm(), {
      idleClip: makeClip("idle", 4),
      loadClip,
      fidgetUrls: ["/a.vrma"],
      idleDurationRangeMs: [500, 500],
      fadeSeconds: 0.05,
      random,
      onFidgetStart
    });

    choreographer.playClipNow("/missing.vrma");
    await flushMicrotasks();

    expect(onFidgetStart).not.toHaveBeenCalled();

    // Countdown resumed after the fallback: the scheduled fidget still fires.
    choreographer.update(0.55);
    await flushMicrotasks();
    expect(loadClip).toHaveBeenLastCalledWith("/a.vrma");

    choreographer.dispose();
  });
});
