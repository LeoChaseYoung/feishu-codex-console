import { describe, expect, it } from "vitest";

import { renderReviewCard, type ReviewCardSnapshot } from "../src/review-card.js";

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

const snapshot: ReviewCardSnapshot = {
  taskId: "task1234",
  projectLabel: "frontend",
  prompt: "修复测试并说明改动",
  phase: "succeeded",
  review: {
    capturedAt: "2026-07-16T00:00:00Z",
    availability: "ready",
    attribution: "task",
    files: [
      {
        path: "src/index.ts",
        kind: "update",
        additions: 5,
        deletions: 2,
        binary: false,
        sensitive: false,
        attribution: "task",
        fingerprint: "file:20:1",
      },
    ],
    totalFiles: 1,
    totalAdditions: 5,
    totalDeletions: 2,
    binaryFiles: 0,
    preexistingFilesExcluded: 2,
    truncated: false,
  },
  commandRuns: [
    {
      id: "test-1",
      command: "npm test",
      category: "test",
      status: "passed",
      exitCode: 0,
    },
  ],
  page: 0,
  pageSize: 5,
};

describe("review card", () => {
  it("shows attribution, test evidence, file stats, and file actions", () => {
    const card = renderReviewCard(snapshot);
    const actions = collectByKey(card, "action") as string[];
    expect(JSON.stringify(card)).toContain("任务基线清晰");
    expect(JSON.stringify(card)).toContain("npm test");
    expect(JSON.stringify(card)).toContain("+5 / -2");
    expect(actions).toContain("review_file");
    expect(actions).toContain("review_refresh");
    expect(JSON.stringify(card).length).toBeLessThan(30_000);
  });

  it("warns for mixed attribution and renders a stale bounded diff", () => {
    const card = renderReviewCard({
      ...snapshot,
      review: {
        ...snapshot.review,
        attribution: "mixed",
        files: [{ ...snapshot.review.files[0]!, attribution: "mixed" }],
      },
      selectedFileIndex: 0,
      fileDiff: {
        path: "src/index.ts",
        content: "-old\n+new",
        stale: true,
        sensitive: false,
        truncated: false,
        capturedAt: "2026-07-16T00:01:00Z",
      },
    });
    expect(JSON.stringify(card)).toContain("任务完成后又发生了变化");
    expect(JSON.stringify(card)).toContain("合并后的工作区 Diff");
    expect(collectByKey(card, "action")).toEqual(
      expect.arrayContaining(["review_back", "review_refresh"]),
    );
  });

  it("paginates long per-file diffs without overflowing a card", () => {
    const card = renderReviewCard({
      ...snapshot,
      selectedFileIndex: 0,
      diffPage: 0,
      diffPageSize: 7_000,
      fileDiff: {
        path: "src/index.ts",
        content: `+${"a".repeat(8_500)}`,
        stale: false,
        sensitive: false,
        truncated: false,
        capturedAt: "2026-07-16T00:01:00Z",
      },
    });
    expect(JSON.stringify(card)).toContain("Diff 第 1 / 2 页");
    expect(collectByKey(card, "action")).toContain("review_diff_page");
    expect(JSON.stringify(card).length).toBeLessThan(30_000);
  });

  it("returns to the original task card when used as an embedded surface", () => {
    const card = renderReviewCard({ ...snapshot, embedded: true });
    expect(collectByKey(card, "action")).toContain("review_close");
    expect(JSON.stringify(card)).toContain("Codex 任务验证");
  });

  it("collapses empty validation into a single explanation", () => {
    const card = renderReviewCard({
      ...snapshot,
      review: {
        ...snapshot.review,
        availability: "no_changes",
        files: [],
        totalFiles: 0,
        totalAdditions: 0,
        totalDeletions: 0,
      },
      commandRuns: [],
      embedded: true,
    });
    const serialized = JSON.stringify(card);
    expect(serialized).toContain("没有可验证的代码结果");
    expect(serialized).not.toContain("任务基线清晰");
    expect(collectByKey(card, "action")).toContain("review_close");
  });
});
