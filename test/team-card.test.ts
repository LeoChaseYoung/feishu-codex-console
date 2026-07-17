import { describe, expect, it } from "vitest";

import { renderTeamDashboardCard } from "../src/team-card.js";

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

describe("team dashboard card", () => {
  it("renders product metrics and navigation without raw identities or prompts", () => {
    const card = renderTeamDashboardCard({
      scopeLabel: "工程团队 · 本机实例",
      periodLabel: "最近 7 天",
      members: [
        {
          label: "前端同学",
          role: "operator",
          tasks: 8,
          active: 1,
          controlled: 2,
          succeeded: 6,
          failed: 1,
          inputTokens: 20_000,
          outputTokens: 4_000,
        },
      ],
      projects: [{ label: "frontend", tasks: 8, active: 1, members: 1 }],
      activeTasks: 1,
      queuedTasks: 0,
      completedTasks: 7,
      successRate: 6 / 7,
      inputTokens: 20_000,
      outputTokens: 4_000,
      canAdminister: true,
    });
    const serialized = JSON.stringify(card);
    const actions = collectByKey(card, "action");
    expect(serialized).toContain("Codex 团队工作台");
    expect(serialized).toContain("前端同学");
    expect(serialized).toContain("86%");
    expect(serialized).not.toContain("ou_");
    expect(actions).toEqual(
      expect.arrayContaining(["team_tasks", "team_runbooks", "team_projects", "team_refresh"]),
    );
  });
});
