import { describe, expect, it, vi } from "vitest";

import {
  ConversationTurnSession,
  renderConversationTurn,
} from "../src/conversation-turn-session.js";
import type { LarkCli } from "../src/lark-cli.js";
import { createTaskProgress } from "../src/progress.js";

describe("conversation turn session", () => {
  it("creates one natural Markdown reply and updates the same message", async () => {
    const lark = {
      replyMarkdown: vi.fn().mockResolvedValue("om-answer"),
      updateMarkdown: vi.fn().mockResolvedValue(undefined),
    } as unknown as LarkCli;
    const progress = createTaskProgress(
      "task-1",
      "为什么 token 很多？",
      1,
      "bridge",
      Date.now(),
      "只读",
      { taskMode: "answer" },
    );
    const session = await ConversationTurnSession.create(
      lark,
      progress,
      "om-root",
      "answer-1",
      true,
    );

    await session.markRunning();
    await session.finishSucceeded("因为读取范围过大。", null, "thread-1");

    expect(lark.replyMarkdown).toHaveBeenCalledWith(
      "om-root",
      "已收到 · 正在准备",
      "answer-1",
      true,
    );
    expect(lark.updateMarkdown).toHaveBeenLastCalledWith(
      "om-answer",
      "因为读取范围过大。",
    );
    expect(session.progress.phase).toBe("succeeded");
  });

  it("keeps task metadata out of the completed answer", () => {
    const progress = {
      ...createTaskProgress("task-secret", "问题", 1, "project", Date.now(), "只读", {
        taskMode: "answer",
        modelLabel: "GPT-5.6",
        sessionLabel: "thread-secret",
      }),
      phase: "succeeded" as const,
      finalResponse: "这是正常回答。",
      usage: { input_tokens: 44_000, cached_input_tokens: 43_000, output_tokens: 20 },
    };
    expect(renderConversationTurn(progress)).toBe("这是正常回答。");
  });

  it("keeps temporary conversation states clean in the chat preview", () => {
    const queued = createTaskProgress(
      "task-preview",
      "问题",
      3,
      "project",
      Date.now(),
      "只读",
      { taskMode: "answer" },
    );
    expect(renderConversationTurn(queued)).toBe("已收到 · 正在准备 · 队列第 3 位");

    const running = { ...queued, phase: "running" as const, activity: "Codex 正在回答" };
    expect(renderConversationTurn(running)).toBe("Codex 正在回答…");
  });

  it("reserves an edit for the terminal answer after progress updates are capped", async () => {
    const lark = {
      updateMarkdown: vi.fn().mockResolvedValue(undefined),
    } as unknown as LarkCli;
    const progress = createTaskProgress(
      "task-long",
      "分析一个较长的问题",
      1,
      "bridge",
      Date.now(),
      "只读",
      { taskMode: "analyze" },
    );
    const session = ConversationTurnSession.restore(
      lark,
      "om-long-answer",
      progress,
      18,
    );

    await session.markRunning();
    expect(lark.updateMarkdown).not.toHaveBeenCalled();

    await expect(
      session.finishSucceeded("这是最终答案。", null, "thread-long"),
    ).resolves.toBe(true);
    expect(lark.updateMarkdown).toHaveBeenCalledTimes(1);
    expect(lark.updateMarkdown).toHaveBeenCalledWith(
      "om-long-answer",
      "这是最终答案。",
    );
  });
});
