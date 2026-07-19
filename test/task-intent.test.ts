import { describe, expect, it } from "vitest";

import {
  inferTaskMode,
  isContextualFollowUp,
  sandboxForTaskMode,
  shouldClarifyContextualFollowUp,
  shouldStartFreshAnswerThread,
  taskModeAllowsWrites,
  taskModeExpectsTests,
} from "../src/task-intent.js";
import { FIRST_SUCCESS_PROMPT } from "../src/first-success.js";

describe("task intent routing", () => {
  it.each([
    ["为什么读取项目会花这么多 token？", "answer"],
    ["怎么修改登录页？", "answer"],
    ["读取项目", "analyze"],
    ["看看还有什么可以优化的地方不", "analyze"],
    ["分析项目结构并给出建议", "analyze"],
    ["找出登录慢的原因，先不要修改文件", "analyze"],
    ["检查项目，不要运行测试或修改代码", "analyze"],
    ["验收测试：只读回答当前项目定位，不要修改文件", "answer"],
    ["帮我分析这个 bug 的原因，不要改代码", "analyze"],
    ["继续分析，不要改代码", "analyze"],
    ["帮我写一份 README", "write"],
    ["优化 README 文案", "write"],
    ["把总结保存为文件", "write"],
    ["修复登录页", "code"],
    ["看看代码，然后修复测试", "code"],
    ["检查登录页，修复其中的错误", "code"],
    ["实现用户登录", "code"],
  ] as const)("routes %s as %s", (prompt, expected) => {
    expect(inferTaskMode(prompt)).toBe(expected);
  });

  it("forces questions and analysis into read-only execution", () => {
    expect(sandboxForTaskMode("answer", "danger-full-access")).toBe("read-only");
    expect(sandboxForTaskMode("analyze", "workspace-write")).toBe("read-only");
    expect(taskModeAllowsWrites("answer")).toBe(false);
    expect(taskModeAllowsWrites("analyze")).toBe(false);
    expect(inferTaskMode(FIRST_SUCCESS_PROMPT)).toBe("analyze");
    expect(sandboxForTaskMode(inferTaskMode(FIRST_SUCCESS_PROMPT), "danger-full-access")).toBe(
      "read-only",
    );
  });

  it.each([
    ["继续", "answer", "answer"],
    ["接着做吧", "analyze", "analyze"],
    ["再来一版", "write", "write"],
    ["那怎么办？", "code", "code"],
  ] as const)("inherits %s from the previous %s turn", (prompt, previous, expected) => {
    expect(inferTaskMode(prompt, previous)).toBe(expected);
  });

  it("fails closed for a contextual follow-up without a saved turn", () => {
    const mode = inferTaskMode("继续");
    expect(mode).toBe("analyze");
    expect(sandboxForTaskMode(mode, "danger-full-access")).toBe("read-only");
    expect(inferTaskMode("")).toBe("analyze");
    expect(isContextualFollowUp("继续吧")).toBe(true);
    expect(
      shouldClarifyContextualFollowUp("继续", {
        hasThread: false,
        hasActiveTask: false,
        queuedTasks: 0,
      }),
    ).toBe(true);
    expect(
      shouldClarifyContextualFollowUp("继续", {
        hasThread: true,
        hasActiveTask: false,
        queuedTasks: 0,
      }),
    ).toBe(false);
  });

  it("lets an explicit new intent override the previous turn", () => {
    expect(inferTaskMode("为什么会失败？", "code")).toBe("answer");
    expect(inferTaskMode("分析一下失败原因", "code")).toBe("analyze");
    expect(inferTaskMode("帮我更新 README", "code")).toBe("write");
    expect(inferTaskMode("那就修复登录问题", "analyze")).toBe("code");
  });

  it("starts independent short questions without dragging a heavy saved thread", () => {
    expect(
      shouldStartFreshAnswerThread("这个项目的定位是什么？", {
        hasThread: true,
        isReply: false,
      }),
    ).toBe(true);
    expect(
      shouldStartFreshAnswerThread("为什么读取项目会花很多 token？", {
        hasThread: true,
        isReply: false,
      }),
    ).toBe(true);
    expect(
      shouldStartFreshAnswerThread("你刚才说的第二点是什么意思？", {
        hasThread: true,
        isReply: false,
      }),
    ).toBe(false);
    expect(
      shouldStartFreshAnswerThread("这个项目的定位是什么？", {
        hasThread: true,
        isReply: true,
      }),
    ).toBe(false);
  });

  it("keeps file and code work writable while reserving test expectations for code", () => {
    expect(sandboxForTaskMode("write", "workspace-write")).toBe("workspace-write");
    expect(sandboxForTaskMode("code", "danger-full-access")).toBe("danger-full-access");
    expect(taskModeExpectsTests("write")).toBe(false);
    expect(taskModeExpectsTests("code")).toBe(true);
  });
});
