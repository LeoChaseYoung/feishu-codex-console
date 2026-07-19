import { describe, expect, it } from "vitest";

import {
  renderPrivateHomeCard,
  type PrivateHomeSnapshot,
} from "../src/home-card.js";

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

function snapshot(overrides: Partial<PrivateHomeSnapshot> = {}): PrivateHomeSnapshot {
  return {
    deviceName: "Developer MacBook Pro",
    availability: {
      state: "online",
      title: "可以开始任务",
      detail: "飞书消息、卡片和 Codex 引擎均已连接。",
      nextAction: "直接发送完整任务。",
      canExecute: true,
      canInteract: true,
      sampledAt: "2026-07-18T00:00:00.000Z",
    },
    project: { name: "feishu-codex-bridge", isGitRepository: true },
    role: "operator",
    modelLabel: "gpt-5.4",
    sandboxLabel: "工作区写入",
    hasSession: false,
    queuedTasks: 0,
    canOperate: true,
    onboardingStatus: "completed",
    ...overrides,
  };
}

describe("private home card", () => {
  it("keeps normal use focused on session, project and device actions", () => {
    const card = renderPrivateHomeCard(snapshot({ hasSession: true }));
    const actions = collectByKey(card, "action");
    const serialized = JSON.stringify(card);

    expect(actions).toEqual(expect.arrayContaining([
      "home_new_session",
      "home_sessions",
      "home_projects",
      "home_project_chat",
      "home_device",
    ]));
    expect(actions).not.toContain("home_first_task");
    expect(serialized).toContain("直接继续当前会话");
    expect(serialized).toContain("继续当前");
    expect(serialized).not.toContain("远程就绪");
  });

  it("turns first use into one safe real task", () => {
    const card = renderPrivateHomeCard(snapshot({ onboardingStatus: "active" }));
    const actions = collectByKey(card, "action");
    const serialized = JSON.stringify(card);

    expect(actions).toContain("home_first_task");
    expect(actions).toContain("home_project_chat");
    expect(actions).not.toContain("home_new_session");
    expect(serialized).toContain("先完成一次真实任务");
    expect(serialized).toContain("不会修改文件");
  });

  it("gives read-only members destinations without execution actions", () => {
    const card = renderPrivateHomeCard(snapshot({
      role: "viewer",
      canOperate: false,
      sandboxLabel: "只读",
      onboardingStatus: "active",
      projectChatName: "feishu-codex-bridge · Codex",
    }));
    const actions = collectByKey(card, "action");

    expect(actions).toEqual(expect.arrayContaining(["home_projects", "home_project_chat"]));
    expect(actions).not.toContain("home_first_task");
    expect(actions).not.toContain("home_new_session");
    expect(JSON.stringify(card)).toContain("只读成员");
  });

  it("turns a degraded project group into a repair action", () => {
    const card = renderPrivateHomeCard(snapshot({
      projectChatName: "feishu-codex-bridge · Codex",
      projectChatNeedsRepair: true,
    }));
    expect(JSON.stringify(card)).toContain("修复项目群");
    expect(collectByKey(card, "action")).toContain("home_project_chat");
  });
});
