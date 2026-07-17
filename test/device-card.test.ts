import { describe, expect, it } from "vitest";

import {
  renderDeviceCard,
  type DeviceConsoleSnapshot,
} from "../src/device-card.js";

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

const base: DeviceConsoleSnapshot = {
  deviceName: "Developer MacBook Pro",
  osLabel: "macOS 25.0 · arm64",
  uptimeLabel: "12 分钟",
  availability: {
    state: "online",
    title: "可以开始任务",
    detail: "飞书连接正常；Codex 引擎将在首个任务时按需启动。",
    nextAction: "直接发送完整任务，或先切换项目与模型。",
    canExecute: true,
    canInteract: true,
    sampledAt: "2026-07-16T12:00:00.000Z",
    lastSuccessfulTaskAt: "2026-07-16T11:00:00.000Z",
  },
  project: {
    name: "feishu-codex-bridge",
    displayPath: "~/work/feishu-codex-bridge",
    isGitRepository: true,
  },
  codex: { state: "standby", restartCount: 0 },
  listener: { ready: true, restartCount: 0 },
  remoteReady: { supported: true, enabled: false, active: false },
  powerLabel: "外接电源 · 92%",
  queuedForConversation: 0,
  activeTasks: 0,
  queuedTasks: 0,
  maxConcurrentTasks: 2,
  threadCount: 4,
  sandboxLabel: "完全访问",
  networkEnabled: true,
  accountQuota: {
    status: "available",
    sampledAt: "2026-07-16T12:00:00.000Z",
    resetCredits: 2,
    limits: [
      {
        id: "codex",
        name: "Codex",
        planType: "pro",
        primary: {
          usedPercent: 42,
          remainingPercent: 58,
          windowDurationMins: 10_080,
          resetsAt: "2026-07-20T12:00:00.000Z",
        },
      },
    ],
  },
};

describe("device console card", () => {
  it("renders one polished control surface with bounded action rows", () => {
    const card = renderDeviceCard(base);
    const ids = collectByKey(card, "element_id") as string[];
    const actions = collectByKey(card, "action") as string[];
    const allColumns = collectByKey(card, "columns") as unknown[][];

    expect(card.schema).toBe("2.0");
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("remote_ready_panel");
    expect(ids).toContain("health_metrics");
    expect(ids).toContain("dq_sum_panel");
    expect(JSON.stringify(card)).toContain("Codex 58%");
    expect(actions).toContain("device_quota");
    expect(ids.every((id) => /^[A-Za-z][A-Za-z0-9_]{0,19}$/.test(id))).toBe(true);
    expect(actions).toEqual(
      expect.arrayContaining([
        "device_refresh",
        "device_projects",
        "device_new_session",
        "remote_ready_enable",
      ]),
    );
    expect(actions).not.toContain("device_stop");
    expect(allColumns.every((columns) => columns.length <= 3)).toBe(true);
    expect(JSON.stringify(card).length).toBeLessThan(30_000);
  });

  it("shows the active controls and sanitizes dynamic machine data", () => {
    const card = renderDeviceCard({
      ...base,
      deviceName: "<at id='all'>everyone</at>",
      activeTask: "task1234",
      codex: { state: "online", pid: 42, restartCount: 1 },
      remoteReady: { supported: true, enabled: true, active: true },
      feedback: "远程就绪已开启。",
    });
    const actions = collectByKey(card, "action") as string[];
    const serialized = JSON.stringify(card);

    expect(actions).toContain("device_stop");
    expect(actions).toContain("remote_ready_disable");
    expect(actions).not.toContain("remote_ready_enable");
    expect(serialized).not.toContain("<at id='all'>");
    expect(serialized).toContain("＜at id='all'＞");
    expect(serialized).toContain("远程就绪已开启");
  });

  it("hides false execution controls and exposes Codex recovery on engine errors", () => {
    const card = renderDeviceCard({
      ...base,
      availability: {
        state: "error",
        title: "Codex 引擎异常",
        detail: "login expired",
        nextAction: "点击“重连 Codex”验证登录和本地引擎。",
        canExecute: false,
        canInteract: true,
        sampledAt: "2026-07-16T12:00:00.000Z",
      },
      codex: { state: "error", restartCount: 2, lastError: "login expired" },
    });
    const actions = collectByKey(card, "action") as string[];
    expect(actions).toContain("device_reconnect");
    expect(actions).toContain("device_refresh");
    expect(actions).not.toContain("device_projects");
    expect(actions).not.toContain("device_new_session");
  });

  it("removes all buttons when CardKit callbacks are unavailable", () => {
    const card = renderDeviceCard({
      ...base,
      availability: {
        state: "degraded",
        title: "设备部分可用",
        detail: "文字消息可用，但卡片按钮连接正在恢复。",
        nextAction: "直接发送文字任务。",
        canExecute: true,
        canInteract: false,
        sampledAt: "2026-07-16T12:00:00.000Z",
      },
    });
    expect(collectByKey(card, "action")).toEqual([]);
    expect(JSON.stringify(card)).toContain("控制按钮已暂时隐藏");
  });
});
