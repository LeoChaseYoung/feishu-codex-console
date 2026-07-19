import type { CodexThreadSummary } from "./codex-runner.js";

export type ThreadActivitySource = "feishu" | "desktop" | "unknown";

export interface SessionThreadActivity {
  source: ThreadActivitySource;
  activityAt: number;
}

export interface SessionCenterItem extends CodexThreadSummary {
  activitySource: ThreadActivitySource;
  activityAt: number;
}

export interface DeriveThreadActivityOptions {
  threadUpdatedAt: number;
  latestFeishuActivityAt?: number;
  bridgeOwned?: boolean;
  toleranceMs?: number;
}

export interface SessionHandoffWorkState {
  blocked: boolean;
  active: boolean;
  queued: number;
}

export function assessSessionHandoff(
  activeTaskId: string | undefined,
  queuedTasks: number,
): SessionHandoffWorkState {
  const queued = Number.isSafeInteger(queuedTasks) ? Math.max(0, queuedTasks) : 0;
  const active = Boolean(activeTaskId);
  return { blocked: active || queued > 0, active, queued };
}

export function deriveThreadActivity(
  options: DeriveThreadActivityOptions,
): SessionThreadActivity {
  const activityAt = normalizeThreadTime(options.threadUpdatedAt);
  const latestFeishuActivityAt = validTimestamp(options.latestFeishuActivityAt);
  if (latestFeishuActivityAt === undefined) {
    return {
      source: options.bridgeOwned ? "unknown" : "desktop",
      activityAt,
    };
  }
  const toleranceMs = Math.max(0, options.toleranceMs ?? 5_000);
  return {
    source: activityAt > latestFeishuActivityAt + toleranceMs ? "desktop" : "feishu",
    activityAt: Math.max(activityAt, latestFeishuActivityAt),
  };
}

function normalizeThreadTime(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value < 10_000_000_000 ? value * 1_000 : value;
}

function validTimestamp(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}
