import { describe, expect, it } from "vitest";

import {
  projectGroupBindingCardFailureText,
  renderProjectCard,
} from "../src/project-card.js";
import type { CodexProject } from "../src/project-registry.js";

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

const projects: CodexProject[] = [
  {
    name: "team-frontend",
    path: "/Users/demo/project/team-frontend",
    displayPath: "~/project/team-frontend",
    isGitRepository: true,
    source: "codex",
  },
  {
    name: "team-api",
    path: "/Users/demo/project/team-api",
    displayPath: "~/project/team-api",
    isGitRepository: false,
    source: "codex",
  },
  {
    name: "内容工具",
    path: "/Users/demo/project/content-tool",
    displayPath: "~/project/content-tool",
    isGitRepository: true,
    source: "codex",
  },
];

describe("project card", () => {
  it("uses an honest non-executable fallback when the binding card cannot render", () => {
    const fallback = projectGroupBindingCardFailureText();
    expect(fallback).toContain("本群仍未授权");
    expect(fallback).toContain("不会执行任务");
    expect(fallback).toContain("card.action.trigger");
    expect(fallback).not.toMatch(/\/use|切换\s+\w+/);
  });

  it("renders a polished Card 2.0 workspace with metrics and a project selector", () => {
    const card = renderProjectCard(
      projects,
      projects[0]!,
      "已切换到 team-frontend · 已开启新会话",
      {
        gitStatus: {
          branch: "feature/search",
          detached: false,
          dirty: true,
          changedFiles: 3,
          ahead: 1,
          behind: 0,
        },
        favoritePaths: [projects[0]!.path],
        recentPaths: [projects[2]!.path],
        activeTasks: 1,
        queuedTasks: 2,
        hasSavedThread: true,
        policyLabel: "仓库策略 · 权限最高 工作区写入",
        canCreateProjectChat: true,
      },
    );
    const ids = collectByKey(card, "element_id") as string[];
    const options = collectByKey(card, "options")[0] as Array<{
      text: { content: string };
      value: string;
    }>;
    const actions = collectByKey(card, "action") as string[];
    const initialOptions = collectByKey(card, "initial_option") as string[];

    expect(card.schema).toBe("2.0");
    expect((card.config as Record<string, unknown>).width_mode).toBe("default");
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("project_select");
    expect(options).toHaveLength(3);
    expect(options.map((option) => option.value)).toEqual(projects.map((project) => project.path));
    expect(options[2]?.text.content).toContain("内容工具");
    expect(options[0]?.text.content).toContain("★");
    expect(options[0]?.text.content).toContain("~/project/team-frontend");
    expect(initialOptions).toContain(projects[0]!.path);
    expect(actions).toContain("select_project");
    expect(actions).toContain("toggle_project_favorite");
    expect(actions).toContain("project_chat");
    expect(JSON.stringify(card)).toContain("分支 feature/search");
    expect(JSON.stringify(card)).toContain("3 个未提交变更");
    expect(JSON.stringify(card)).toContain("安全策略：仓库策略");
    expect(JSON.stringify(card)).toContain("会停止 1 个运行任务和 2 个排队任务");
    expect(JSON.stringify(card)).toContain("已切换到 team-frontend");
    expect(JSON.stringify(card).length).toBeLessThan(30_000);
  });

  it("shows an existing project chat and locks project switching inside that chat", () => {
    const card = renderProjectCard(projects, projects[0]!, "", {
      canSwitch: false,
      projectChat: { name: "team-frontend · Codex", isCurrentChat: true },
    });
    const serialized = JSON.stringify(card);
    const actions = collectByKey(card, "action") as string[];

    expect(serialized).toContain("本群已固定连接这个项目");
    expect(serialized).toContain("每个新话题对应一段独立 Codex 会话");
    expect(serialized).toContain("项目已固定");
    expect(serialized).not.toContain("project_select");
    expect(serialized).not.toContain("project_stats");
    expect(serialized).not.toContain("project_fav_toggle");
    expect(actions).not.toContain("select_project");
    expect(actions).not.toContain("toggle_project_favorite");
    expect(actions).not.toContain("project_chat");
    expect(serialized.length).toBeLessThan(8_000);
  });

  it("shows an explicit repair action for a partially configured project chat", () => {
    const card = renderProjectCard(projects, projects[0]!, "", {
      projectChat: {
        name: "team-frontend · Codex",
        isCurrentChat: false,
        needsRepair: true,
      },
    });
    const serialized = JSON.stringify(card);
    expect(serialized).toContain("项目群待修复");
    expect(serialized).toContain("修复并打开项目群");
    expect(serialized).toContain("不会重复建群");
  });

  it("guides an unbound group through one irreversible project selection", () => {
    const card = renderProjectCard(projects, projects[0]!, "", {
      canSwitch: true,
      requiresProjectBinding: true,
    });
    const serialized = JSON.stringify(card);
    const actions = collectByKey(card, "action") as string[];
    const initialOptions = collectByKey(card, "initial_option") as string[];

    expect(serialized).toContain("为这个群选择项目");
    expect(serialized).toContain("绑定后不支持切换");
    expect(serialized).toContain("绑定前不会执行任何 Codex 任务");
    expect(actions).toEqual(["select_project"]);
    expect(initialOptions).toEqual([]);
    expect(serialized).not.toContain("toggle_project_favorite");
  });

  it("neutralizes markup in dynamic project names and paths", () => {
    const unsafe: CodexProject = {
      ...projects[0]!,
      name: "<at id='all'>everyone</at>",
      displayPath: "~/project/<unsafe>",
    };
    const card = renderProjectCard([unsafe], unsafe);

    expect(JSON.stringify(card)).not.toContain("<at id='all'>");
    expect(JSON.stringify(card)).toContain("＜at id='all'＞");
  });

  it("renders a read-only workspace without a switch selector", () => {
    const card = renderProjectCard(projects, projects[0]!, "", { canSwitch: false });
    const ids = collectByKey(card, "element_id") as string[];
    const actions = collectByKey(card, "action") as string[];
    expect(ids).not.toContain("project_select");
    expect(ids).toContain("selector_readonly");
    expect(actions).toEqual(["toggle_project_favorite"]);
  });
});
