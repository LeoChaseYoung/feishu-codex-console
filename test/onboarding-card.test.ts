import { describe, expect, it } from "vitest";

import {
  renderOnboardingCard,
  type OnboardingSnapshot,
} from "../src/onboarding-card.js";

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

function snapshot(overrides: Partial<OnboardingSnapshot> = {}): OnboardingSnapshot {
  return {
    role: "operator",
    state: {
      ownerId: "ou-1",
      status: "active",
      step: 1,
      updatedAt: "2026-07-16T00:00:00Z",
    },
    projectName: "feishu-codex-bridge",
    projectAvailable: true,
    modelLabel: "gpt-5.4",
    sandboxLabel: "工作区写入",
    canWrite: true,
    deviceOnline: true,
    groupChatEnabled: true,
    ...overrides,
  };
}

describe("onboarding card", () => {
  it("gets a ready operator from welcome to product use in one card", () => {
    const card = renderOnboardingCard(snapshot());
    const actions = collectByKey(card, "action");
    const columns = collectByKey(card, "columns") as unknown[][];
    const serialized = JSON.stringify(card);

    expect(actions).toEqual(
      expect.arrayContaining([
        "onboarding_finish",
        "onboarding_projects",
        "onboarding_settings",
      ]),
    );
    expect(actions).not.toContain("onboarding_start");
    expect(actions).not.toContain("onboarding_next");
    expect(actions).not.toContain("onboarding_back");
    expect(serialized).toContain("直接在聊天框里说你想做什么");
    expect(serialized).toContain("运行测试，修复失败用例");
    expect(serialized).toContain("一个项目建一个群");
    expect(serialized).not.toContain("onboard_progress");
    expect(columns.every((row) => row.length <= 2)).toBe(true);
  });

  it("turns offline and missing-project states into one clear recovery action", () => {
    const offline = renderOnboardingCard(snapshot({ deviceOnline: false }));
    const missingProject = renderOnboardingCard(
      snapshot({ projectAvailable: false, projectName: "尚未授权项目" }),
    );

    expect(collectByKey(offline, "action")).toEqual(
      expect.arrayContaining(["onboarding_device", "onboarding_dismiss"]),
    );
    expect(collectByKey(offline, "action")).not.toContain("onboarding_finish");
    expect(JSON.stringify(offline)).toContain("本地 Codex 正在重新连接");

    expect(collectByKey(missingProject, "action")).toEqual(
      expect.arrayContaining(["onboarding_projects", "onboarding_dismiss"]),
    );
    expect(collectByKey(missingProject, "action")).not.toContain("onboarding_finish");
    expect(JSON.stringify(missingProject)).toContain("先选择一个要使用的项目");
  });

  it("gives viewers read-only destinations without pretending they can run Codex", () => {
    const card = renderOnboardingCard(snapshot({
      role: "viewer",
      sandboxLabel: "只读",
      canWrite: false,
    }));
    const actions = collectByKey(card, "action");
    const columns = collectByKey(card, "columns") as unknown[][];

    expect(actions).toEqual(
      expect.arrayContaining([
        "onboarding_projects",
        "onboarding_tasks",
        "onboarding_finish",
      ]),
    );
    expect(actions).not.toContain("onboarding_settings");
    expect(JSON.stringify(card)).toContain("不能启动 Codex 或修改本地文件");
    expect(columns.every((row) => row.length <= 2)).toBe(true);
  });

  it("keeps administrator configuration out of the member onboarding flow", () => {
    const card = renderOnboardingCard(
      snapshot({
        groupChatEnabled: false,
      }),
    );
    const serialized = JSON.stringify(card);

    expect(serialized).toContain("团队群可以以后再开");
    expect(serialized).not.toContain("discover");
    expect(serialized).not.toContain("chat_id");
    expect(serialized).not.toContain("ALLOWED_FEISHU_CHAT_IDS");
  });

  it("renders completion and sanitizes dynamic Feishu markup", () => {
    const card = renderOnboardingCard(
      snapshot({
        state: { ...snapshot().state, status: "completed", step: 4 },
        projectName: "<at id='all'>everyone</at>",
        modelLabel: "**unsafe**",
        feedback: "<at id='all'>hello</at>",
      }),
    );
    const serialized = JSON.stringify(card);

    expect(collectByKey(card, "action")).toEqual(
      expect.arrayContaining(["onboarding_device", "onboarding_restart"]),
    );
    expect(serialized).not.toContain("<at id='all'>");
    expect(serialized).toContain("＜at id='all'＞");
    expect(serialized).toContain("可以开始了");
    expect(serialized).toContain("一个项目建一个群");
  });
});
