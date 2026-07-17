import { describe, expect, it } from "vitest";

import { sessionNameFromPrompt } from "../src/session-naming.js";

describe("session auto naming", () => {
  it("uses a compact first meaningful prompt line", () => {
    expect(sessionNameFromPrompt("\n# 修复登录页测试\n并补充说明", "frontend")).toBe(
      "修复登录页测试",
    );
    expect(sessionNameFromPrompt("x".repeat(80), "frontend", 20)).toHaveLength(20);
    expect(sessionNameFromPrompt("", "frontend")).toBe("frontend 新任务");
  });
});
