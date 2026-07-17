import type { CodexEvent, CodexThreadItem, CodexUsage } from "./codex-events.js";
import {
  isTestCommand,
  summarizeCommandOutput,
  type TaskReviewBaseline,
  type TaskReviewSnapshot,
} from "./task-review.js";
import {
  completedActivity,
  inferTaskMode,
  runningActivity,
  taskModeOf,
  type TaskMode,
} from "./task-intent.js";

export type TaskPhase =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface TaskProgressContext {
  taskMode?: TaskMode;
  modelLabel?: string;
  reasoningLabel?: string;
  sessionLabel?: string;
  runbookLabel?: string;
  initiatorLabel?: string;
  controllerLabel?: string;
  controllerSelector?: string;
  handoffOptions?: TaskHandoffOption[];
  teamMode?: boolean;
}

export interface TaskHandoffOption {
  label: string;
  value: string;
}

export interface TaskCommandRun {
  id: string;
  command: string;
  category: "test" | "command";
  status: "running" | "passed" | "failed";
  exitCode?: number;
  outputSummary?: string;
}

export type TestEvidenceState = "passed" | "failed" | "running" | "missing";

export function effectiveTestRuns(commandRuns: TaskCommandRun[] = []): TaskCommandRun[] {
  const latest = new Map<string, TaskCommandRun>();
  for (const run of commandRuns) {
    if (run.category !== "test") continue;
    latest.set(run.command.trim().replace(/\s+/g, " ").toLocaleLowerCase(), run);
  }
  return [...latest.values()];
}

export function testEvidenceState(commandRuns: TaskCommandRun[] = []): TestEvidenceState {
  const tests = effectiveTestRuns(commandRuns);
  if (tests.length === 0) return "missing";
  if (tests.some((run) => run.status === "failed")) return "failed";
  if (tests.some((run) => run.status === "running")) return "running";
  return "passed";
}

export interface TaskProgress {
  taskId: string;
  prompt: string;
  projectLabel: string;
  permissionLabel: string;
  queuePosition: number;
  phase: TaskPhase;
  activity: string;
  logs: string[];
  changedFiles: Array<{ path: string; kind: "add" | "delete" | "update" }>;
  partialResponse: string;
  finalResponse: string;
  error: string;
  actionNote: string;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  usage: CodexUsage | null;
  threadId: string;
  taskMode?: TaskMode;
  modelLabel?: string;
  reasoningLabel?: string;
  sessionLabel?: string;
  runbookLabel?: string;
  initiatorLabel?: string;
  controllerLabel?: string;
  controllerSelector?: string;
  handoffOptions?: TaskHandoffOption[];
  teamMode?: boolean;
  steerCount?: number;
  commandRuns?: TaskCommandRun[];
  reviewBaseline?: TaskReviewBaseline;
  review?: TaskReviewSnapshot;
}

export function updateTaskCollaboration(
  progress: TaskProgress,
  context: Pick<
    TaskProgressContext,
    | "initiatorLabel"
    | "controllerLabel"
    | "controllerSelector"
    | "handoffOptions"
    | "teamMode"
  >,
  note?: string,
): TaskProgress {
  return {
    ...progress,
    ...context,
    ...(note ? { actionNote: note } : {}),
  };
}

const MAX_LOGS = 8;
const MAX_COMMAND_RUNS = 24;

export function createTaskProgress(
  taskId: string,
  prompt: string,
  queuePosition: number,
  projectLabel: string,
  now = Date.now(),
  permissionLabel = "工作区写入",
  context: TaskProgressContext = {},
): TaskProgress {
  const taskMode = context.taskMode ?? inferTaskMode(prompt);
  return {
    taskId,
    prompt,
    projectLabel,
    permissionLabel,
    queuePosition,
    phase: "queued",
    activity: queuePosition > 1 ? `等待队列，第 ${queuePosition} 位` : "等待开始",
    logs: [],
    changedFiles: [],
    partialResponse: "",
    finalResponse: "",
    error: "",
    actionNote: "",
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    usage: null,
    threadId: "",
    ...context,
    taskMode,
    steerCount: 0,
    commandRuns: [],
  };
}

export function startTask(
  progress: TaskProgress,
  now = Date.now(),
  reviewBaseline?: TaskReviewBaseline,
  permissionLabel?: string,
): TaskProgress {
  const mode = taskModeOf(progress);
  return appendLog(
    {
      ...progress,
      phase: "running",
      activity: runningActivity(mode),
      startedAt: progress.startedAt ?? now,
      finishedAt: null,
      actionNote: "",
      ...(reviewBaseline ? { reviewBaseline } : {}),
      ...(permissionLabel ? { permissionLabel } : {}),
    },
    runningActivity(mode),
  );
}

export function recoverTask(
  progress: TaskProgress,
  queuePosition: number,
  note = "服务重启后已恢复任务",
): TaskProgress {
  return appendLog(
    {
      ...progress,
      phase: "queued",
      queuePosition,
      activity: "服务重启后等待恢复",
      error: "",
      actionNote: note,
      finishedAt: null,
    },
    "已从可靠队列恢复",
  );
}

export function updateQueuePosition(progress: TaskProgress, queuePosition: number): TaskProgress {
  if (progress.phase !== "queued" || progress.queuePosition === queuePosition) return progress;
  return {
    ...progress,
    queuePosition,
    activity: queuePosition > 1 ? `等待队列，第 ${queuePosition} 位` : "等待开始",
  };
}

export function noteSteer(progress: TaskProgress): TaskProgress {
  const steerCount = (progress.steerCount ?? 0) + 1;
  return {
    ...progress,
    steerCount,
    actionNote: `已接收 ${steerCount} 条补充要求，并加入当前 Codex turn。`,
  };
}

export function applyCodexEvent(progress: TaskProgress, event: CodexEvent): TaskProgress {
  switch (event.type) {
    case "thread.started":
      return appendLog(
        { ...progress, activity: "已连接 Codex 会话", threadId: event.thread_id },
        "已连接 Codex 会话",
      );
    case "turn.started":
      return appendLog(
        { ...progress, activity: runningActivity(taskModeOf(progress)) },
        runningActivity(taskModeOf(progress)),
      );
    case "turn.completed":
      return { ...progress, activity: "正在整理结果", usage: event.usage };
    case "turn.failed":
      return appendLog(
        { ...progress, activity: "执行失败", error: event.error.message },
        `执行失败：${event.error.message}`,
      );
    case "error":
      return appendLog(
        { ...progress, activity: "连接异常", error: event.message },
        `连接异常：${event.message}`,
      );
    case "item.started":
    case "item.updated":
    case "item.completed":
      return applyItem(progress, event.item, event.type);
  }
}

export function succeedTask(
  progress: TaskProgress,
  finalResponse: string,
  usage: CodexUsage | null,
  threadId: string,
  now = Date.now(),
): TaskProgress {
  const mode = taskModeOf(progress);
  return appendLog(
    {
      ...progress,
      phase: "succeeded",
      activity: completedActivity(mode),
      finalResponse,
      partialResponse: finalResponse || progress.partialResponse,
      usage,
      threadId,
      finishedAt: now,
    },
    completedActivity(mode),
  );
}

export function failTask(progress: TaskProgress, error: string, now = Date.now()): TaskProgress {
  return appendLog(
    {
      ...progress,
      phase: "failed",
      activity: "任务失败",
      error,
      finishedAt: now,
    },
    `任务失败：${error}`,
  );
}

export function cancelTask(progress: TaskProgress, reason: string, now = Date.now()): TaskProgress {
  return appendLog(
    {
      ...progress,
      phase: "cancelled",
      activity: "任务已取消",
      error: reason,
      finishedAt: now,
    },
    `任务已取消：${reason}`,
  );
}

export function interruptTask(
  progress: TaskProgress,
  reason: string,
  now = Date.now(),
): TaskProgress {
  return appendLog(
    {
      ...progress,
      phase: "interrupted",
      activity: "任务被服务中断",
      error: reason,
      finishedAt: now,
    },
    `任务被服务中断：${reason}`,
  );
}

export function noteTask(progress: TaskProgress, note: string): TaskProgress {
  return { ...progress, actionNote: note };
}

export function attachTaskReview(
  progress: TaskProgress,
  review: TaskReviewSnapshot,
): TaskProgress {
  return { ...progress, review };
}

function applyItem(
  progress: TaskProgress,
  item: CodexThreadItem,
  eventType: "item.started" | "item.updated" | "item.completed",
): TaskProgress {
  const completed = eventType === "item.completed";
  switch (item.type) {
    case "agent_message":
      return {
        ...progress,
        activity: "Codex 正在回复",
        partialResponse: item.text,
      };
    case "reasoning":
      return { ...progress, activity: "Codex 正在推理" };
    case "command_execution": {
      const command = shorten(item.command, 110);
      if (eventType === "item.started") {
        return appendLog(
          {
            ...progress,
            activity: `执行命令：${command}`,
            commandRuns: upsertCommandRun(progress.commandRuns ?? [], {
              id: item.id,
              command: item.command,
              category: isTestCommand(item.command) ? "test" : "command",
              status: "running",
            }),
          },
          `运行：${command}`,
        );
      }
      if (completed) {
        const ok = item.status === "completed" && (item.exit_code ?? 0) === 0;
        return appendLog(
          {
            ...progress,
            activity: ok ? "命令执行完成" : "命令执行失败",
            commandRuns: upsertCommandRun(progress.commandRuns ?? [], {
              id: item.id,
              command: item.command,
              category: isTestCommand(item.command) ? "test" : "command",
              status: ok ? "passed" : "failed",
              ...(item.exit_code === undefined ? {} : { exitCode: item.exit_code }),
              ...(isTestCommand(item.command) && item.aggregated_output
                ? { outputSummary: summarizeCommandOutput(item.aggregated_output) }
                : {}),
            }),
          },
          `${ok ? "✓" : "✗"} 命令${ok ? "完成" : "失败"}${item.exit_code === undefined ? "" : `（退出码 ${item.exit_code}）`}`,
        );
      }
      return { ...progress, activity: `执行命令：${command}` };
    }
    case "file_change": {
      if (!completed) return { ...progress, activity: "正在修改文件" };
      const paths = item.changes.map((change) => change.path).slice(0, 4);
      const extra = item.changes.length > paths.length ? ` 等 ${item.changes.length} 个文件` : "";
      return appendLog(
        {
          ...progress,
          activity: item.status === "completed" ? "文件修改完成" : "文件修改失败",
          changedFiles:
            item.status === "completed"
              ? mergeChangedFiles(progress.changedFiles, item.changes)
              : progress.changedFiles,
        },
        `${item.status === "completed" ? "✓" : "✗"} ${paths.join("、")}${extra}`,
      );
    }
    case "mcp_tool_call": {
      const label = `${item.server}/${item.tool}`;
      if (eventType === "item.started") {
        return appendLog({ ...progress, activity: `调用工具：${label}` }, `调用工具：${label}`);
      }
      if (completed) {
        const ok = item.status === "completed";
        return appendLog(
          { ...progress, activity: ok ? "工具调用完成" : "工具调用失败" },
          `${ok ? "✓" : "✗"} 工具 ${label}`,
        );
      }
      return { ...progress, activity: `调用工具：${label}` };
    }
    case "web_search":
      return eventType === "item.started"
        ? appendLog(
            { ...progress, activity: `搜索资料：${shorten(item.query, 80)}` },
            `搜索：${shorten(item.query, 80)}`,
          )
        : progress;
    case "todo_list": {
      const completedCount = item.items.filter((todo) => todo.completed).length;
      return {
        ...progress,
        activity: `执行计划 ${completedCount}/${item.items.length}`,
      };
    }
    case "error":
      return appendLog(
        { ...progress, activity: "步骤异常", error: item.message },
        `步骤异常：${item.message}`,
      );
  }
}

function upsertCommandRun(
  current: TaskCommandRun[],
  incoming: TaskCommandRun,
): TaskCommandRun[] {
  const next = current.filter((run) => run.id !== incoming.id);
  next.push(incoming);
  return next.slice(-MAX_COMMAND_RUNS);
}

function mergeChangedFiles(
  current: TaskProgress["changedFiles"],
  incoming: TaskProgress["changedFiles"],
): TaskProgress["changedFiles"] {
  const merged = new Map(current.map((change) => [change.path, change]));
  for (const change of incoming) merged.set(change.path, change);
  return [...merged.values()].slice(-40);
}

function appendLog(progress: TaskProgress, line: string): TaskProgress {
  const clean = shorten(line.replace(/\s+/g, " ").trim(), 180);
  if (!clean || progress.logs.at(-1) === clean) return progress;
  return { ...progress, logs: [...progress.logs, clean].slice(-MAX_LOGS) };
}

function shorten(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
