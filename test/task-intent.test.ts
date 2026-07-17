import { describe, expect, it } from "vitest";

import {
  inferTaskMode,
  sandboxForTaskMode,
  taskModeAllowsWrites,
  taskModeExpectsTests,
} from "../src/task-intent.js";

describe("task intent routing", () => {
  it.each([
    ["为什么读取项目会花这么多 token？", "answer"],
    ["怎么修改登录页？", "answer"],
    ["读取项目", "analyze"],
    ["看看还有什么可以优化的地方不", "analyze"],
    ["分析项目结构并给出建议", "analyze"],
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
  });

  it("keeps file and code work writable while reserving test expectations for code", () => {
    expect(sandboxForTaskMode("write", "workspace-write")).toBe("workspace-write");
    expect(sandboxForTaskMode("code", "danger-full-access")).toBe("danger-full-access");
    expect(taskModeExpectsTests("write")).toBe(false);
    expect(taskModeExpectsTests("code")).toBe(true);
  });
});
