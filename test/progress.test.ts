import { describe, expect, it } from "vitest";

import type { CodexEvent, CodexUsage } from "../src/codex-events.js";
import {
  applyCodexEvent,
  createTaskProgress,
  effectiveTestRuns,
  interruptTask,
  noteSteer,
  startTask,
  succeedTask,
  testEvidenceState,
  updateQueuePosition,
} from "../src/progress.js";

const usage: CodexUsage = {
  input_tokens: 120,
  cached_input_tokens: 20,
  output_tokens: 45,
  reasoning_output_tokens: 10,
};

describe("task progress", () => {
  it("reduces streamed command and response events", () => {
    let progress = startTask(
      createTaskProgress("abc123", "修复测试", 1, "bridge", 1_000),
      2_000,
    );
    progress = applyCodexEvent(progress, {
      type: "item.started",
      item: {
        id: "cmd-1",
        type: "command_execution",
        command: "npm test",
        aggregated_output: "",
        status: "in_progress",
      },
    });
    progress = applyCodexEvent(progress, {
      type: "item.completed",
      item: {
        id: "cmd-1",
        type: "command_execution",
        command: "npm test",
        aggregated_output: "ok",
        exit_code: 0,
        status: "completed",
      },
    });
    progress = applyCodexEvent(progress, {
      type: "item.updated",
      item: { id: "msg-1", type: "agent_message", text: "已经修复" },
    });

    expect(progress.activity).toBe("Codex 正在回复");
    expect(progress.partialResponse).toBe("已经修复");
    expect(progress.logs).toContain("运行：npm test");
    expect(progress.logs).toContain("✓ 命令完成（退出码 0）");
    expect(progress.commandRuns).toMatchObject([
      { command: "npm test", category: "test", status: "passed", exitCode: 0 },
    ]);
  });

  it("stores final response, usage, and thread", () => {
    const progress = succeedTask(
      startTask(createTaskProgress("abc123", "修复测试", 1, "bridge", 1_000), 2_000),
      "完成",
      usage,
      "thread-1",
      4_000,
    );

    expect(progress.phase).toBe("succeeded");
    expect(progress.finalResponse).toBe("完成");
    expect(progress.usage).toEqual(usage);
    expect(progress.threadId).toBe("thread-1");
    expect(progress.finishedAt).toBe(4_000);
  });

  it("retains only recent, useful log entries", () => {
    let progress = startTask(createTaskProgress("abc123", "任务", 1, "bridge"));
    for (let index = 0; index < 12; index += 1) {
      const event: CodexEvent = {
        type: "item.started",
        item: {
          id: `search-${index}`,
          type: "web_search",
          query: `query ${index}`,
        },
      };
      progress = applyCodexEvent(progress, event);
    }
    expect(progress.logs).toHaveLength(8);
    expect(progress.logs.at(-1)).toBe("搜索：query 11");
  });

  it("tracks queue movement, steering, and interruption without replaying work", () => {
    let progress = createTaskProgress("abc123", "任务", 3, "bridge");
    progress = updateQueuePosition(progress, 2);
    progress = startTask(progress, 2_000);
    progress = noteSteer(progress);
    progress = interruptTask(progress, "service stopped", 3_000);

    expect(progress.queuePosition).toBe(2);
    expect(progress.steerCount).toBe(1);
    expect(progress.phase).toBe("interrupted");
    expect(progress.finishedAt).toBe(3_000);
  });

  it("uses the latest run of the same test command as validation evidence", () => {
    const runs = [
      { id: "1", command: "npm test", category: "test" as const, status: "failed" as const },
      { id: "2", command: "npm   test", category: "test" as const, status: "passed" as const },
    ];
    expect(effectiveTestRuns(runs)).toHaveLength(1);
    expect(testEvidenceState(runs)).toBe("passed");
  });
});
