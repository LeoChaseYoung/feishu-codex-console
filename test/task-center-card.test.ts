import { describe, expect, it } from "vitest";

import { createTaskProgress, startTask } from "../src/progress.js";
import { renderTaskCenterCard } from "../src/task-center-card.js";
import type { PersistedTaskState } from "../src/types.js";

function collectByKey(value: unknown, key: string, result: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const item of value) collectByKey(item, key, result);
    return result;
  }
  if (typeof value !== "object" || value === null) return result;
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === key) result.push(entryValue);
    collectByKey(entryValue, key, result);
  }
  return result;
}

const task: PersistedTaskState = {
  id: "task1234",
  conversationKey: "chat::owner",
  ownerId: "owner",
  controllerId: "owner",
  prompt: "运行测试",
  replyToMessageId: "message-1",
  seed: "event-1",
  project: {
    name: "frontend",
    path: "/repos/frontend",
    displayPath: "~/repos/frontend",
    isGitRepository: true,
    source: "scan",
  },
  status: "running",
  progress: startTask(createTaskProgress("task1234", "运行测试", 1, "frontend")),
  cardSequence: 1,
  attachments: [],
  allowedExternalActions: [],
  settings: { sandboxMode: "workspace-write" },
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: new Date().toISOString(),
};

describe("task center card", () => {
  it("offers a specific stop action and identifies the task project", () => {
    const card = renderTaskCenterCard({
      scopeLabel: "我的全部授权项目",
      tasks: [task],
      running: 1,
      queued: 0,
      canOperate: true,
      people: { task1234: { initiator: "Alice", controller: "Bob" } },
    });
    const actions = collectByKey(card, "action") as string[];
    expect(actions).toContain("tasks_cancel_one");
    expect(actions).toContain("tasks_stop");
    expect(JSON.stringify(card)).toContain("frontend");
    expect(JSON.stringify(card)).toContain("#task1234");
    expect(JSON.stringify(card)).toContain("发起 Alice · 控制 Bob");
  });

  it("hides mutation controls for a viewer", () => {
    const card = renderTaskCenterCard({
      scopeLabel: "只读",
      tasks: [task],
      running: 1,
      queued: 0,
      canOperate: false,
    });
    const actions = collectByKey(card, "action") as string[];
    expect(actions).toEqual(["tasks_settings", "tasks_refresh"]);
  });

  it("does not invent a review action for completed work without validation evidence", () => {
    const completed = {
      ...task,
      status: "succeeded" as const,
      progress: { ...task.progress, phase: "succeeded" as const },
    };
    const card = renderTaskCenterCard({
      scopeLabel: "我的任务",
      tasks: [completed],
      running: 0,
      queued: 0,
      canOperate: false,
    });
    const actions = collectByKey(card, "action") as string[];
    expect(actions).not.toContain("tasks_review");
    expect(actions).not.toContain("tasks_cancel_one");
  });

  it("keeps completed code work reviewable when validation evidence exists", () => {
    const completed = {
      ...task,
      status: "succeeded" as const,
      progress: {
        ...task.progress,
        phase: "succeeded" as const,
        commandRuns: [
          {
            id: "test-1",
            command: "npm test",
            category: "test" as const,
            status: "passed" as const,
            exitCode: 0,
          },
        ],
      },
    };
    const card = renderTaskCenterCard({
      scopeLabel: "我的任务",
      tasks: [completed],
      running: 0,
      queued: 0,
      canOperate: false,
    });
    expect(collectByKey(card, "action")).toContain("tasks_review");
  });
});
