import { describe, expect, it } from "vitest";

import type { CodexUsage } from "../src/codex-events.js";
import {
  createTaskProgress,
  interruptTask,
  noteSteer,
  startTask,
  succeedTask,
} from "../src/progress.js";
import { renderStreamContent, renderTaskCard } from "../src/task-card.js";

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

const usage: CodexUsage = {
  input_tokens: 1_200,
  cached_input_tokens: 200,
  output_tokens: 345,
  reasoning_output_tokens: 100,
  model_calls: 3,
};

describe("task card", () => {
  it("renders a valid running card with unique element IDs and live actions", () => {
    const progress = startTask(
      createTaskProgress(
        "task1234",
        "检查并修复测试",
        2,
        "FastGPT",
        1_000,
        "工作区写入",
        {
          modelLabel: "gpt-5.4",
          reasoningLabel: "深入",
          sessionLabel: "继续当前会话",
          initiatorLabel: "Alice",
          controllerLabel: "Bob",
          controllerSelector: "member-bob",
          teamMode: true,
          handoffOptions: [
            { label: "Alice · 操作者", value: "member-alice" },
            { label: "Bob · 操作者", value: "member-bob" },
          ],
        },
      ),
      2_000,
    );
    const card = renderTaskCard(progress, 5_000);
    const ids = collectByKey(card, "element_id") as string[];
    const actions = collectByKey(card, "action") as string[];

    expect(card.schema).toBe("2.0");
    expect((card.config as Record<string, unknown>).update_multi).toBe(true);
    expect((card.config as Record<string, unknown>).streaming_mode).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[A-Za-z][A-Za-z0-9_]{0,19}$/.test(id))).toBe(true);
    expect(ids).toContain("stream_text");
    expect(actions).toContain("cancel");
    expect(actions).toContain("review");
    expect(actions).toContain("handoff");
    expect(actions).toContain("takeover");
    expect(JSON.stringify(card)).toContain("FastGPT");
    expect(JSON.stringify(card)).toContain("gpt-5.4");
    expect(JSON.stringify(card)).toContain("继续当前会话");
    expect(JSON.stringify(card)).toContain("当前控制者");
    expect(JSON.stringify(card)).not.toContain("ou_");
    expect(JSON.stringify(card)).toContain("提交、推送、部署和 PR 仍需确认");
    expect(JSON.stringify(card).length).toBeLessThan(30_000);
  });

  it("renders final content, usage, and safe follow-up actions", () => {
    const progress = succeedTask(
      startTask(
        createTaskProgress("task1234", "检查并修复测试", 1, "FastGPT", 1_000),
        2_000,
      ),
      "测试已经通过。",
      usage,
      "thread-1",
      62_000,
    );
    const card = renderTaskCard(progress, 62_000);
    const actions = collectByKey(card, "action") as string[];
    const confirms = collectByKey(card, "confirm");

    expect((card.header as Record<string, unknown>).template).toBe("green");
    expect(renderStreamContent(progress)).toContain("测试已经通过");
    expect(renderStreamContent(progress)).toContain("未检测到测试命令");
    expect(actions).toEqual(expect.arrayContaining(["retry", "new"]));
    expect(actions).not.toContain("review");
    expect(confirms).toHaveLength(2);
    expect(JSON.stringify(card)).toContain("1,000 / 200");
    expect(JSON.stringify(card)).toContain("累计输入 1,200");
    expect(JSON.stringify(card)).toContain("3 次模型调用");
  });

  it("neutralizes user-supplied at tags", () => {
    const card = renderTaskCard(
      createTaskProgress("task1234", "通知 <at id='all'>所有人</at>", 1, "bridge"),
    );
    expect(JSON.stringify(card)).not.toContain('"<at');
  });

  it("redacts credentials from prompts and streamed results", () => {
    const progress = succeedTask(
      startTask(
        createTaskProgress("task1234", "检查 API_KEY=prompt-secret", 1, "bridge"),
      ),
      "完成，access_token=result-secret",
      null,
      "thread-1",
    );
    const card = JSON.stringify(renderTaskCard(progress));
    expect(card).not.toContain("prompt-secret");
    expect(card).not.toContain("result-secret");
    expect(card).toContain("REDACTED");
  });

  it("does not visually present a completed turn as successful when final tests failed", () => {
    const progress = succeedTask(
      startTask(createTaskProgress("task1234", "修复测试", 1, "frontend")),
      "已完成修改。",
      null,
      "thread-1",
    );
    progress.commandRuns = [
      {
        id: "test-1",
        command: "npm test",
        category: "test",
        status: "failed",
        exitCode: 1,
      },
    ];
    const card = renderTaskCard(progress);
    expect((card.header as Record<string, unknown>).template).toBe("red");
    expect(JSON.stringify(card)).toContain("测试未通过");
  });

  it("explains interrupted work and preserves explicit retry controls", () => {
    const progress = interruptTask(
      noteSteer(
        startTask(createTaskProgress("task1234", "修改登录页", 1, "frontend"), 2_000),
      ),
      "service stopped",
      3_000,
    );
    progress.changedFiles.push({ path: "src/login.ts", kind: "update" });
    const card = renderTaskCard(progress, 3_000);
    const actions = collectByKey(card, "action") as string[];
    expect(JSON.stringify(card)).toContain("没有自动重跑");
    expect(JSON.stringify(card)).toContain("已追加 1 条");
    expect(actions).toEqual(expect.arrayContaining(["retry", "new"]));
    expect(actions).not.toContain("review");
  });

  it("keeps long results compact and exposes the full result in the same card", () => {
    const progress = succeedTask(
      startTask(createTaskProgress("task1234", "读取项目", 1, "frontend")),
      `结论先行。\n\n${"详细说明。".repeat(500)}\nTAIL_MARKER`,
      null,
      "thread-1",
    );
    const card = renderTaskCard(progress);
    const actions = collectByKey(card, "action") as string[];
    expect(renderStreamContent(progress)).toContain("内容较长");
    expect(renderStreamContent(progress)).not.toContain("TAIL_MARKER");
    expect(actions).toContain("result");
    expect(actions).not.toContain("review");
  });

  it("only exposes validation when there is review or test evidence", () => {
    const progress = succeedTask(
      startTask(createTaskProgress("task1234", "修复登录页", 1, "frontend")),
      "完成修改。",
      null,
      "thread-1",
    );
    progress.review = {
      capturedAt: "2026-07-16T00:00:00Z",
      availability: "ready",
      attribution: "task",
      files: [
        {
          path: "src/login.ts",
          kind: "update",
          additions: 4,
          deletions: 1,
          binary: false,
          sensitive: false,
          attribution: "task",
          fingerprint: "file:40:1",
        },
      ],
      totalFiles: 1,
      totalAdditions: 4,
      totalDeletions: 1,
      binaryFiles: 0,
      preexistingFilesExcluded: 0,
      truncated: false,
    };
    expect(collectByKey(renderTaskCard(progress), "action")).toContain("review");
  });

  it("renders a question as a read-only answer without code review or test noise", () => {
    const running = startTask(
      createTaskProgress("task1234", "为什么输入 token 这么大？", 1, "frontend"),
    );
    const runningCard = renderTaskCard(running);
    expect(JSON.stringify(runningCard)).toContain("Codex 正在回答");
    expect(collectByKey(runningCard, "action")).toEqual(["cancel"]);

    const completed = succeedTask(running, "因为当前会话包含历史上下文。", null, "thread-1");
    const completedCard = renderTaskCard(completed);
    const serialized = JSON.stringify(completedCard);
    expect(serialized).toContain("回答已完成");
    expect(serialized).toContain("再次回答");
    expect(serialized).not.toContain("未检测到测试命令");
    expect(serialized).not.toContain("代码审阅");
  });

  it("treats project inspection as analysis and document creation as content work", () => {
    const analysis = succeedTask(
      startTask(createTaskProgress("task1234", "看看还有什么可以优化的地方不", 1, "frontend")),
      "建议先优化会话隔离。",
      null,
      "thread-1",
    );
    const writing = startTask(
      createTaskProgress("task5678", "帮我写一份 README", 1, "frontend"),
    );
    expect(JSON.stringify(renderTaskCard(analysis))).toContain("分析已完成");
    expect(renderStreamContent(analysis)).not.toContain("未检测到测试命令");
    expect(JSON.stringify(renderTaskCard(writing))).toContain("Codex 正在生成内容");
    expect(collectByKey(renderTaskCard(writing), "action")).toContain("review");
  });
});
