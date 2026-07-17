import { describe, expect, it } from "vitest";

import { renderResponseCard, responsePresentation } from "../src/response-card.js";

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

describe("product response card", () => {
  it("uses one polished Card 2.0 shell for ordinary replies", () => {
    const card = renderResponseCard("已创建新会话，可以继续发送任务。", "session-new");
    const ids = collectByKey(card, "element_id") as string[];
    expect(card.schema).toBe("2.0");
    expect((card.header as Record<string, unknown>).template).toBe("green");
    expect(new Set(ids).size).toBe(ids.length);
    expect(JSON.stringify(card)).toContain("会话已更新");
    expect(JSON.stringify(card)).toContain("本地 Codex 控制台");
  });

  it("distinguishes permission, failure, warning, and information states", () => {
    expect(responsePresentation("permission-denied", "没有权限").tone).toBe("warning");
    expect(responsePresentation("task-failed", "执行失败").tone).toBe("error");
    expect(responsePresentation("queue-full", "队列已满").tone).toBe("warning");
    expect(responsePresentation("task-cancelled", "任务已取消").tone).toBe("neutral");
    expect(responsePresentation("help", "常用命令").tone).toBe("info");
  });

  it("redacts credentials and neutralizes mention markup", () => {
    const serialized = JSON.stringify(
      renderResponseCard("API_KEY=secret-value <at id='all'>all</at>", "info"),
    );
    expect(serialized).not.toContain("secret-value");
    expect(serialized).not.toContain("<at id='all'>");
    expect(serialized).toContain("REDACTED");
  });
});
