import { describe, expect, it } from "vitest";

import { renderRunbookCenterCard } from "../src/runbook-card.js";
import { parseRunbookCatalog } from "../src/runbooks.js";

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

describe("runbook center card", () => {
  it("shows reviewed task previews and only enables default-complete templates", () => {
    const runbooks = parseRunbookCatalog(
      JSON.stringify({
        version: 1,
        runbooks: [
          { id: "test", name: "运行测试", prompt: "运行测试并修复问题" },
          {
            id: "inspect",
            name: "检查模块",
            prompt: "检查 {{module}}",
            parameters: [{ name: "module", label: "模块", required: true }],
          },
        ],
      }),
    );
    const card = renderRunbookCenterCard({
      projectName: "frontend",
      canOperate: true,
      catalog: { file: "/repo/.feishu-codex-runbooks.json", status: "ready", runbooks },
    });
    const actions = collectByKey(card, "action") as string[];
    expect(actions.filter((action) => action === "runbook_run")).toHaveLength(1);
    expect(actions).toEqual(
      expect.arrayContaining(["runbook_projects", "runbook_team", "runbook_refresh"]),
    );
    expect(JSON.stringify(card)).toContain("/run inspect");
  });

  it("renders invalid configuration as a safe stopped state", () => {
    const card = renderRunbookCenterCard({
      projectName: "frontend",
      canOperate: true,
      catalog: { file: "/repo/file", status: "invalid", runbooks: [], error: "bad config" },
    });
    expect(JSON.stringify(card)).toContain("运行手册已暂停");
    expect(collectByKey(card, "action")).not.toContain("runbook_run");
  });
});
