// Domain types (camelCase, used in memory) are kept separate from the tool wire
// results (snake_case, the LLM-facing contract below).

export type TimerStatus = "running" | "completed" | "cancelled";

export type Timer = {
  id: string;
  createdAt: string;
  expiresAt: string;
  durationMs: number;
  status: TimerStatus;
  label: string;
  /** Integer behind auto-generated "Timer N" labels; 0 for custom labels. */
  labelNumber: number;
  timezone: string;
};

export type TimerCreateInput = {
  durationMs: number;
  label?: string;
};

export type TimerExpiredDetail = {
  timer_id: string;
  label: string;
  duration_minutes: number;
  created_at: string;
  expires_at: string;
};

// --- tool wire results (snake_case) ---

export type TimerCreateResult = {
  success: boolean;
  timer_id: string;
  label: string;
  duration_minutes: number;
  expires_at: string;
  timezone: string;
};

export type TimerStatusResult = {
  timer_id: string;
  label: string;
  status: TimerStatus;
  remaining_seconds: number;
  remaining_human: string;
  duration_minutes: number;
  created_at: string;
  expires_at: string;
};

export type TimerCancelResult =
  | { success: true; timer_id: string; label: string }
  | { success: false; error: string };

export type TimerListResult = {
  timers: TimerStatusResult[];
  count: number;
  active_count: number;
};
