import { describe, expect, it } from "vitest";

import { createTaskProgress, startTask, succeedTask } from "../src/progress.js";
import { renderTaskResultCard } from "../src/result-card.js";

function collectByKey(value: unknown, key: string, result: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const item of value) collectByKey(item, key, result);
    return result;
  }
  if (typeof value !== "object" || value === null) return result;
  for (const [entryKey, child] of Object.entries(value)) {
    if (entryKey === key) result.push(child);
    collectByKey(child, key, result);
  }
  return result;
}

describe("task result card", () => {
  it("shows the full remote-safe response and returns to the summary", () => {
    const progress = succeedTask(
      startTask(createTaskProgress("task1234", "读取项目", 1, "frontend")),
      "完整说明\n[README.md](/Users/demo/work/README.md)\nTAIL_MARKER",
      null,
      "thread-1",
    );
    const card = renderTaskResultCard(progress);
    const serialized = JSON.stringify(card);
    expect(serialized).toContain("TAIL_MARKER");
    expect(serialized).toContain("README.md");
    expect(serialized).not.toContain("/Users/demo");
    expect(serialized).toContain("分析结果");
    expect(serialized).toContain("只读");
    expect(serialized).not.toContain("测试 未运行");
    expect(collectByKey(card, "action")).toContain("result_back");
    expect(serialized.length).toBeLessThan(30_000);
  });
});
