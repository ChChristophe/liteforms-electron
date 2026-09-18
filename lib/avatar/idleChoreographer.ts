import { AnimationMixer, LoopOnce } from "three";
import type { AnimationAction, AnimationClip } from "three";
import type { VRM } from "@pixiv/three-vrm";

export const DEFAULT_IDLE_DURATION_RANGE_MS: readonly [number, number] = [30_000, 50_000];
const DEFAULT_FADE_SECONDS = 0.4;

type ChoreographerState = "idle" | "loading" | "fidgeting" | "returning";

export type IdleChoreographerOptions = {
  idleClip: AnimationClip;
  loadClip(url: string): Promise<AnimationClip | null>;
  fidgetUrls: readonly string[];
  idleDurationRangeMs?: readonly [number, number];
  fadeSeconds?: number;
  random?(): number;
  onFidgetStart?(): void;
  onFidgetEnd?(): void;
};

export class IdleChoreographer {
  private readonly mixer: AnimationMixer;
  private readonly idleAction: AnimationAction;
  private readonly options: IdleChoreographerOptions & {
    idleDurationRangeMs: readonly [number, number];
    fadeSeconds: number;
    random(): number;
  };
  private state: ChoreographerState = "idle";
  private remainingMs = 0;
  private fadeRemaining = 0;
  private fidgetAction: AnimationAction | null = null;
  private fidgetClip: AnimationClip | null = null;
  private lastFidgetUrl: string | null = null;
  private loadPending = false;
  private disposed = false;
  /**
   * Bumped whenever an explicit cue (playClipNow) supersedes in-flight work:
   * stale scheduled-fidget or stale cue load resolutions become no-ops.
   */
  private cueToken = 0;

  constructor(vrm: VRM, options: IdleChoreographerOptions) {
    this.options = {
      ...options,
      idleDurationRangeMs: options.idleDurationRangeMs ?? DEFAULT_IDLE_DURATION_RANGE_MS,
      fadeSeconds: options.fadeSeconds ?? DEFAULT_FADE_SECONDS,
      random: options.random ?? Math.random
    };
    this.mixer = new AnimationMixer(vrm.scene);
    this.idleAction = this.mixer.clipAction(options.idleClip);
    this.idleAction.play();
    this.scheduleNextIdle();
  }

  update(delta: number): void {
    if (this.disposed) {
      return;
    }
    const step = Number.isFinite(delta) && delta > 0 ? delta : 0;
    this.mixer.update(step);

    if (this.state === "idle" && !this.loadPending) {
      this.remainingMs -= step * 1000;
      if (this.remainingMs <= 0) {
        this.startLoadingNextFidget();
      }
    } else if (this.state === "fidgeting") {
      if (this.fidgetAction?.paused === true) {
        this.beginReturnToIdle();
      }
    } else if (this.state === "returning") {
      this.fadeRemaining -= step;
      if (this.fadeRemaining <= 0) {
        this.finishReturnToIdle();
      }
    }
  }

  /** Effective weight of the idle action (used by tests and crossfade checks). */
  get idleWeight(): number {
    return this.idleAction.getEffectiveWeight();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }

  private scheduleNextIdle() {
    const [minMs, maxMs] = this.options.idleDurationRangeMs;
    this.remainingMs = minMs + (maxMs - minMs) * this.options.random();
    this.state = "idle";
  }

  private startLoadingNextFidget() {
    const url = this.pickNextFidgetUrl();
    this.lastFidgetUrl = url;
    this.loadPending = true;
    this.state = "loading";
    const token = this.cueToken;
    void this.options
      .loadClip(url)
      .then((clip) => {
        this.loadPending = false;
        if (this.disposed || token !== this.cueToken) {
          return;
        }
        if (clip) {
          this.startFidget(clip);
        } else {
          this.scheduleNextIdle();
        }
      })
      .catch(() => {
        this.loadPending = false;
        if (!this.disposed && token === this.cueToken) {
          this.scheduleNextIdle();
        }
      });
  }

  /**
   * Plays a specific animation immediately (e.g. the wake-word greeting cue),
   * interrupting any scheduled or playing fidget. The clip plays once, then
   * the regular fade-back-to-idle machinery takes over. Safe to call again
   * while a previous cue is still loading/playing: the latest call wins.
   */
  playClipNow(url: string): void {
    if (this.disposed) {
      return;
    }
    const token = ++this.cueToken;
    this.loadPending = true;
    this.state = "loading";
    void this.options
      .loadClip(url)
      .then((clip) => {
        this.loadPending = false;
        if (this.disposed || token !== this.cueToken) {
          return;
        }
        if (!clip) {
          // Cue asset unavailable: fall back to the normal idle cycle.
          this.scheduleNextIdle();
          return;
        }
        if (this.fidgetAction) {
          // Interrupt whatever is playing (fidget, previous cue, or a
          // returning fade) with a hard stop; the new clip fades in.
          this.fidgetAction.stop();
          if (this.fidgetClip) {
            this.mixer.uncacheAction(this.fidgetClip);
          }
          this.fidgetAction = null;
          this.fidgetClip = null;
        }
        this.startFidget(clip);
      })
      .catch(() => {
        this.loadPending = false;
        if (!this.disposed && token === this.cueToken) {
          this.scheduleNextIdle();
        }
      });
  }

  private pickNextFidgetUrl(): string {
    const pool = this.options.fidgetUrls;
    const withoutLast = pool.filter((url) => url !== this.lastFidgetUrl);
    const candidates = withoutLast.length > 0 ? withoutLast : [...pool];
    const index = Math.min(candidates.length - 1, Math.max(0, Math.floor(this.options.random() * candidates.length)));
    return candidates[index] as string;
  }

  private startFidget(clip: AnimationClip) {
    this.options.onFidgetStart?.();
    const action = this.mixer.clipAction(clip);
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.reset().fadeIn(this.options.fadeSeconds).play();
    this.idleAction.fadeOut(this.options.fadeSeconds);
    this.fidgetAction = action;
    this.fidgetClip = clip;
    this.state = "fidgeting";
  }

  private beginReturnToIdle() {
    this.idleAction.enabled = true;
    this.idleAction.fadeIn(this.options.fadeSeconds);
    this.fidgetAction?.fadeOut(this.options.fadeSeconds);
    this.fadeRemaining = this.options.fadeSeconds;
    this.state = "returning";
  }

  private finishReturnToIdle() {
    this.fidgetAction?.stop();
    if (this.fidgetClip) {
      this.mixer.uncacheAction(this.fidgetClip);
    }
    this.fidgetAction = null;
    this.fidgetClip = null;
    this.options.onFidgetEnd?.();
    this.scheduleNextIdle();
  }
}
