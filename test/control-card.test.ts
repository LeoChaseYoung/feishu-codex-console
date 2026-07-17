import { describe, expect, it } from "vitest";

import { renderControlCenterCard } from "../src/control-card.js";
import type { CodexModel } from "../src/codex-runner.js";

function findById(value: unknown, id: string): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findById(item, id);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.element_id === id) return record;
  for (const child of Object.values(record)) {
    const found = findById(child, id);
    if (found) return found;
  }
  return undefined;
}

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

const models: CodexModel[] = [
  {
    id: "gpt-default",
    model: "gpt-default",
    displayName: "GPT Default",
    description: "Default",
    isDefault: true,
    supportedReasoningEfforts: ["low", "high", "ultra"],
    defaultReasoningEffort: "high",
  },
];

describe("control center card", () => {
  it("uses the effective default model capabilities and keeps default selection semantic", () => {
    const card = renderControlCenterCard({
      projectName: "frontend",
      role: "admin",
      models,
      selectedModel: "__default__",
      selectedEffort: "ultra",
      selectedSandbox: "workspace-write",
      sandboxModes: ["read-only", "workspace-write"],
      modelCatalogAvailable: true,
      accountQuota: {
        status: "available",
        sampledAt: "2026-07-16T12:00:00.000Z",
        resetCredits: 0,
        limits: [
          {
            id: "codex",
            name: "Codex",
            primary: {
              usedPercent: 20,
              remainingPercent: 80,
              windowDurationMins: 300,
            },
          },
        ],
      },
    });
    const model = findById(card, "model_select");
    const effort = findById(card, "effort_select");
    expect(model?.initial_option).toBe("__default__");
    expect(
      (model?.options as Array<{ value: string }>).map((option) => option.value),
    ).toContain("__default__");
    expect(
      (effort?.options as Array<{ value: string }>).map((option) => option.value),
    ).toEqual(["low", "high", "ultra"]);
    expect(findById(card, "cq_sum_panel")).toBeDefined();
    expect(JSON.stringify(card)).toContain("Codex 80%");
  });

  it("downgrades model and effort controls when the Codex catalog is unavailable", () => {
    const card = renderControlCenterCard({
      projectName: "frontend",
      role: "admin",
      models: [],
      selectedModel: "__default__",
      selectedEffort: "medium",
      selectedSandbox: "workspace-write",
      sandboxModes: ["read-only", "workspace-write"],
      modelCatalogAvailable: false,
    });
    expect(findById(card, "model_select")).toBeUndefined();
    expect(findById(card, "effort_select")).toBeUndefined();
    expect(JSON.stringify(card)).toContain("兼容模式");
    expect(JSON.stringify(card)).toContain("未提供模型目录");
  });

  it("never renders an unsupported effort as a selectable compatibility option", () => {
    const card = renderControlCenterCard({
      projectName: "frontend",
      role: "admin",
      models,
      selectedModel: "gpt-default",
      selectedEffort: "xhigh",
      selectedSandbox: "workspace-write",
      sandboxModes: ["read-only", "workspace-write"],
      modelCatalogAvailable: true,
    });
    const effort = findById(card, "effort_select");
    expect(effort?.initial_option).toBe("high");
    expect(
      (effort?.options as Array<{ value: string }>).map((option) => option.value),
    ).toEqual(["low", "high", "ultra"]);
  });

  it("offers only explicit, expiring full-access leases above the safe default", () => {
    const card = renderControlCenterCard({
      projectName: "frontend",
      role: "admin",
      models,
      selectedModel: "__default__",
      selectedEffort: "high",
      selectedSandbox: "workspace-write",
      sandboxModes: ["read-only", "workspace-write"],
      modelCatalogAvailable: true,
      fullAccessMaximum: true,
      fullAccessLeaseLabel: "下一任务 · 29 分钟内有效",
      fullAccessSessionAvailable: true,
    });
    const actions = collectByKey(card, "action") as string[];
    const sandbox = findById(card, "access_select");
    expect((sandbox?.options as Array<{ value: string }>).map((option) => option.value)).toEqual([
      "read-only",
      "workspace-write",
    ]);
    expect(actions).toEqual(
      expect.arrayContaining([
        "lease_full_once",
        "lease_full_30m",
        "lease_full_session",
        "lease_full_revoke",
      ]),
    );
    expect(JSON.stringify(card)).toContain("租约到期");
  });
});
