import { describe, expect, it } from "vitest";

import { createTaskProgress, startTask, succeedTask } from "../src/progress.js";
import { reconcilePersistedTask } from "../src/task-reconciliation.js";
import type { PersistedTaskState } from "../src/types.js";

function task(status: PersistedTaskState["status"]): PersistedTaskState {
  return {
    id: "task-1",
    conversationKey: "oc-1",
    ownerId: "ou-1",
    controllerId: "ou-1",
    prompt: "test",
    replyToMessageId: "om-1",
    seed: "evt-1",
    project: {
      path: "/work/project",
      name: "project",
      displayPath: "~/work/project",
      isGitRepository: true,
      source: "scan",
    },
    status,
    progress: createTaskProgress("task-1", "test", 1, "project", 1_000),
    cardSequence: 0,
    attachments: [],
    allowedExternalActions: [],
    settings: { sandboxMode: "workspace-write" },
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:01:00.000Z",
  };
}

describe("task state reconciliation", () => {
  it("never replays a queued record whose progress proves execution started", () => {
    const saved = task("queued");
    saved.progress = startTask(saved.progress, 2_000);
    const result = reconcilePersistedTask(saved);
    expect(result.changed).toBe(true);
    expect(result.task.status).toBe("running");
    expect(result.task.progress.phase).toBe("running");
  });

  it("uses a terminal card state when the task record write lagged", () => {
    const saved = task("running");
    saved.progress = succeedTask(startTask(saved.progress, 2_000), "done", null, "thread-1", 3_000);
    const result = reconcilePersistedTask(saved);
    expect(result.task.status).toBe("succeeded");
    expect(result.task.progress.phase).toBe("succeeded");
  });

  it("uses an explicit terminal task record when the card write lagged", () => {
    const saved = task("failed");
    const result = reconcilePersistedTask(saved);
    expect(result.task.status).toBe("failed");
    expect(result.task.progress.phase).toBe("failed");
  });

  it("leaves already consistent state untouched", () => {
    const saved = task("queued");
    const result = reconcilePersistedTask(saved);
    expect(result).toEqual({ task: saved, changed: false });
  });
});
