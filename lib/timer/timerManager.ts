import { timerStore, type TimerStore } from "@/lib/storage/timerStore";
import type {
  Timer,
  TimerCancelResult,
  TimerCreateInput,
  TimerCreateResult,
  TimerExpiredDetail,
  TimerListResult,
  TimerStatusResult,
} from "./types";

function formatRemainingHuman(remainingMs: number): string {
  if (remainingMs <= 0) return "Terminé";
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} heure${hours > 1 ? "s" : ""}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? "s" : ""}`);
  if (seconds > 0 && hours === 0) parts.push(`${seconds} seconde${seconds > 1 ? "s" : ""}`);
  return parts.join(" ") || "Moins d'une seconde";
}

export class TimerManager {
  private timers = new Map<string, Timer>();
  private timeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private expiredListeners = new Set<(detail: TimerExpiredDetail) => void>();
  private labelCounter = 0;
  private loaded = false;

  constructor(private readonly store: TimerStore = timerStore) {}

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const now = Date.now();
    for (const entry of this.store.load()) {
      this.timers.set(entry.id, entry);
      if (entry.status !== "running") continue;
      if (entry.labelNumber > this.labelCounter) this.labelCounter = entry.labelNumber;
      const expiresAt = new Date(entry.expiresAt).getTime();
      if (expiresAt <= now) {
        entry.status = "completed";
        this.save();
        this.emitExpired(entry);
      } else {
        this.scheduleTimeout(entry, expiresAt - now);
      }
    }
    // Reset counter if no running timers remain so labels restart from 1.
    if (!this.hasRunningTimers()) {
      this.labelCounter = 0;
    }
  }

  createTimer(input: TimerCreateInput): TimerCreateResult {
    const id = crypto.randomUUID();
    const now = new Date();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const expiresAt = new Date(now.getTime() + input.durationMs);
    const labelNumber = input.label ? 0 : this.nextLabelNumber();
    const label = input.label || `Timer ${labelNumber}`;
    const timer: Timer = {
      id,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      durationMs: input.durationMs,
      status: "running",
      label,
      labelNumber,
      timezone,
    };
    this.timers.set(id, timer);
    this.scheduleTimeout(timer, input.durationMs);
    this.save();
    return {
      success: true,
      timer_id: id,
      label,
      duration_minutes: Math.round(input.durationMs / 60_000),
      expires_at: timer.expiresAt,
      timezone,
    };
  }

  getTimerStatus(timerId?: string): TimerStatusResult | { error: string } {
    if (timerId) {
      const timer = this.timers.get(timerId);
      if (!timer) return { error: "Timer introuvable" };
      return this.buildStatusResult(timer);
    }
    const running = this.getRunningTimers();
    if (running.length === 0) return { error: "Aucun timer actif" };
    if (running.length === 1) return this.buildStatusResult(running[0]);
    return this.buildStatusResult(running[running.length - 1]);
  }

  cancelTimer(timerId?: string): TimerCancelResult {
    if (timerId) {
      const timer = this.timers.get(timerId);
      if (!timer) return { success: false, error: "Timer introuvable" };
      if (timer.status !== "running") return { success: false, error: "Ce timer n'est pas actif" };
      return this.cancelTimerEntry(timer);
    }
    const running = this.getRunningTimers();
    if (running.length === 0) return { success: false, error: "Aucun timer actif à annuler" };
    if (running.length === 1) return this.cancelTimerEntry(running[0]);
    return { success: false, error: "Plusieurs timers actifs — précise l'identifiant du timer à annuler" };
  }

  listTimers(): TimerListResult {
    const all = Array.from(this.timers.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const statusResults = all.map((t) => this.buildStatusResult(t));
    const activeCount = all.filter((t) => t.status === "running").length;
    return { timers: statusResults, count: all.length, active_count: activeCount };
  }

  /** Subscribes to timer expirations; the returned function unsubscribes. */
  onExpired(listener: (detail: TimerExpiredDetail) => void): () => void {
    this.expiredListeners.add(listener);
    return () => {
      this.expiredListeners.delete(listener);
    };
  }

  /**
   * dispose() libère les timeouts programmés ; load() ré-arme les timers encore `running`.
   * In-memory timers and persisted state are kept intact.
   */
  dispose(): void {
    for (const timeout of this.timeouts.values()) {
      clearTimeout(timeout);
    }
    this.timeouts.clear();
    this.loaded = false;
  }

  private getRunningTimers(): Timer[] {
    return Array.from(this.timers.values())
      .filter((t) => t.status === "running")
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  private hasRunningTimers(): boolean {
    return Array.from(this.timers.values()).some((t) => t.status === "running");
  }

  private nextLabelNumber(): number {
    this.labelCounter += 1;
    return this.labelCounter;
  }

  private scheduleTimeout(timer: Timer, delayMs: number): void {
    this.clearTimerTimeout(timer.id);
    const timeout = setTimeout(() => {
      this.timeouts.delete(timer.id);
      timer.status = "completed";
      this.save();
      this.emitExpired(timer);
    }, delayMs);
    this.timeouts.set(timer.id, timeout);
  }

  private clearTimerTimeout(timerId: string): void {
    const existing = this.timeouts.get(timerId);
    if (existing) {
      clearTimeout(existing);
      this.timeouts.delete(timerId);
    }
  }

  private cancelTimerEntry(timer: Timer): TimerCancelResult {
    this.clearTimerTimeout(timer.id);
    timer.status = "cancelled";
    this.save();
    return { success: true, timer_id: timer.id, label: timer.label };
  }

  private buildStatusResult(timer: Timer): TimerStatusResult {
    const now = Date.now();
    const expiresAt = new Date(timer.expiresAt).getTime();
    const remainingMs = timer.status === "running" ? Math.max(0, expiresAt - now) : -1;
    return {
      timer_id: timer.id,
      label: timer.label,
      status: timer.status,
      remaining_seconds: remainingMs > 0 ? Math.ceil(remainingMs / 1000) : -1,
      remaining_human: remainingMs > 0 ? formatRemainingHuman(remainingMs) : timer.status === "completed" ? "Terminé" : "Annulé",
      duration_minutes: Math.round(timer.durationMs / 60_000),
      created_at: timer.createdAt,
      expires_at: timer.expiresAt,
    };
  }

  private emitExpired(timer: Timer): void {
    const detail: TimerExpiredDetail = {
      timer_id: timer.id,
      label: timer.label,
      duration_minutes: Math.round(timer.durationMs / 60_000),
      created_at: timer.createdAt,
      expires_at: timer.expiresAt,
    };
    for (const listener of this.expiredListeners) {
      listener(detail);
    }
  }

  private save(): void {
    this.store.save(Array.from(this.timers.values()));
  }
}
