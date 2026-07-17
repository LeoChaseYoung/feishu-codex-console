import { describe, expect, it } from "vitest";

import type { CodexApprovalRequest, CodexQuestion } from "../src/codex-events.js";
import {
  renderRuntimeApprovalCard,
  renderRuntimeQuestionCard,
} from "../src/runtime-card.js";

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

const approval: CodexApprovalRequest = {
  id: "approval-1",
  kind: "command",
  threadId: "thread-1",
  turnId: "turn-1",
  itemId: "item-1",
  title: "Codex 请求执行命令",
  detail: "npm test",
  cwd: "/Users/demo/work/project",
};

describe("runtime interaction cards", () => {
  it("keeps approval decisions explicit and updates to a terminal state", () => {
    const pending = renderRuntimeApprovalCard("request-1", approval, "project");
    const actions = collectByKey(pending, "action") as string[];
    const columns = collectByKey(pending, "columns") as unknown[][];

    expect(actions).toEqual(
      expect.arrayContaining([
        "approve_runtime_once",
        "approve_runtime_session",
        "reject_runtime",
      ]),
    );
    expect(JSON.stringify(pending)).toContain("允许一次仅用于当前请求");
    expect(JSON.stringify(pending)).toContain("命令执行");
    expect(columns.every((row) => row.length <= 3)).toBe(true);

    const accepted = renderRuntimeApprovalCard(
      "request-1",
      approval,
      "project",
      "accepted",
    );
    expect(collectByKey(accepted, "action")).toHaveLength(0);
    expect(JSON.stringify(accepted)).toContain("已允许一次");
  });

  it("never renders inline credentials in an approval card", () => {
    const card = renderRuntimeApprovalCard(
      "request-secret",
      { ...approval, detail: "curl -H 'Authorization: Bearer secret-token-value'" },
      "project",
    );
    expect(JSON.stringify(card)).not.toContain("secret-token-value");
    expect(JSON.stringify(card)).toContain("REDACTED");
  });

  it("renders quick answers and warns before secret input is sent to Feishu", () => {
    const question: CodexQuestion = {
      id: "q1",
      header: "实现方式",
      question: "你希望采用哪一种？",
      options: [
        { label: "方案 A", description: "改动更小" },
        { label: "方案 B", description: "能力更完整" },
      ],
      isOther: true,
      isSecret: false,
    };
    const card = renderRuntimeQuestionCard("request-q1", question, { index: 1, total: 1 });
    const actions = collectByKey(card, "action") as string[];

    expect(actions.filter((action) => action === "answer_runtime")).toHaveLength(2);
    expect(actions).toContain("cancel_runtime_question");
    expect(JSON.stringify(card)).toContain("下一条飞书消息");
    expect(JSON.stringify(card)).toContain("10 分钟内有效");

    const secret = renderRuntimeQuestionCard(
      "request-q2",
      { ...question, id: "q2", isSecret: true, options: [] },
      { index: 1, total: 1 },
    );
    const secretActions = collectByKey(secret, "action") as string[];
    expect(JSON.stringify(secret)).toContain("不会通过飞书收集或转发");
    expect(secretActions).toEqual(["cancel_runtime_question"]);

    const cancelled = renderRuntimeQuestionCard(
      "request-q2",
      question,
      { index: 1, total: 1 },
      "cancelled",
    );
    expect(JSON.stringify(cancelled)).toContain("已取消回答");
  });
});
