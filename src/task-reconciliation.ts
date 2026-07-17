import type { TaskProgress } from "./progress.js";
import type { PersistedTaskState, TaskRecordStatus } from "./types.js";

export interface TaskReconciliationResult {
  task: PersistedTaskState;
  changed: boolean;
  reason?: string;
}

const TERMINAL = new Set<TaskRecordStatus>([
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
]);

/**
 * Reconciles the independently persisted task status and CardKit progress state.
 * The result deliberately prefers "do not replay" over convenience: any evidence
 * that a task started or reached a terminal state prevents it from being treated
 * as a fresh queued task after a crash.
 */
export function reconcilePersistedTask(task: PersistedTaskState): TaskReconciliationResult {
  const recordStatus = task.status;
  const cardStatus = task.progress.phase;
  const canonical = canonicalStatus(task);
  const changed = recordStatus !== canonical || cardStatus !== canonical;
  if (!changed) return { task, changed: false };

  const reason = `状态对账：任务记录 ${recordStatus}、卡片 ${cardStatus}，统一为 ${canonical}`;
  return {
    changed: true,
    reason,
    task: {
      ...task,
      status: canonical,
      progress: reconcileProgress(task.progress, canonical, reason, task.updatedAt),
      updatedAt: new Date().toISOString(),
    },
  };
}

function canonicalStatus(task: PersistedTaskState): TaskRecordStatus {
  if (TERMINAL.has(task.status)) return task.status;
  if (TERMINAL.has(task.progress.phase)) return task.progress.phase;
  if (
    task.status === "running" ||
    task.progress.phase === "running" ||
    (task.progress.startedAt !== null && task.progress.finishedAt === null) ||
    Boolean(task.progress.threadId)
  ) {
    return "running";
  }
  return "queued";
}

function reconcileProgress(
  progress: TaskProgress,
  status: TaskRecordStatus,
  reason: string,
  updatedAt: string,
): TaskProgress {
  const terminal = TERMINAL.has(status);
  const finishedAt = terminal
    ? progress.finishedAt ?? validTime(updatedAt) ?? Date.now()
    : null;
  return {
    ...progress,
    phase: status,
    activity: activityFor(status),
    startedAt:
      status === "running" && progress.startedAt === null
        ? validTime(updatedAt) ?? progress.createdAt
        : progress.startedAt,
    finishedAt,
    actionNote: [progress.actionNote, reason].filter(Boolean).join(" · ").slice(0, 1_000),
  };
}

function activityFor(status: TaskRecordStatus): string {
  switch (status) {
    case "queued":
      return "等待恢复队列";
    case "running":
      return "检测到已启动任务，等待安全中断处理";
    case "succeeded":
      return "任务已完成";
    case "failed":
      return "任务执行失败";
    case "cancelled":
      return "任务已取消";
    case "interrupted":
      return "任务被服务中断";
  }
}

function validTime(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
