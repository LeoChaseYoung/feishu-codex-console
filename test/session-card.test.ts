import { describe, expect, it } from "vitest";

import { renderSessionCenterCard } from "../src/session-card.js";

const desktopSession = {
  id: "thread-desktop",
  name: "桌面继续开发",
  preview: "修复会话接力",
  cwd: "/Users/demo/project",
  createdAt: 1_000,
  updatedAt: 2_000,
  status: "idle" as const,
  activitySource: "desktop" as const,
  activityAt: 2_000_000,
};

describe("session center card", () => {
  it("shows the exact-thread desktop handoff and source", () => {
    const card = renderSessionCenterCard({
      projectName: "demo",
      currentThreadId: desktopSession.id,
      sessions: [desktopSession],
    });
    const serialized = JSON.stringify(card);

    expect(serialized).toContain("在本机打开当前会话");
    expect(serialized).toContain("session_open_desktop");
    expect(serialized).toContain("最近在本机更新");
    expect(serialized).toContain("飞书卡片、按钮、群聊普通消息不会写入 Codex 历史");
  });

  it("requires confirmation before binding a local history thread", () => {
    const card = renderSessionCenterCard({
      projectName: "demo",
      sessions: [desktopSession],
    });
    const select = findElement(card, "session_select");

    expect(select?.confirm).toEqual({
      title: { tag: "plain_text", content: "确认绑定这个会话？" },
      text: {
        tag: "plain_text",
        content: "后续飞书消息会继续所选 Codex 上下文。运行或排队中的任务不会被强制切换。",
      },
    });
    expect(JSON.stringify(card)).not.toContain("session_open_desktop");
  });
});

function findElement(value: unknown, elementId: string): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findElement(child, elementId);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.element_id === elementId) return record;
  for (const child of Object.values(record)) {
    const found = findElement(child, elementId);
    if (found) return found;
  }
  return undefined;
}
