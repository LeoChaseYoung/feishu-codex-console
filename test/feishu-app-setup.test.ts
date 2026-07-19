import { describe, expect, it } from "vitest";

import {
  buildFeishuAppAddons,
  permissionPlan,
} from "../scripts/feishu-app-setup.mjs";

describe("Feishu app one-click permission setup", () => {
  it("requests only the ordinary group-message scope for the focused repair", () => {
    const addons = buildFeishuAppAddons("ordinary-group");

    expect(addons).toEqual({
      preset: false,
      scopes: { tenant: ["im:message.group_msg"] },
      events: { items: { tenant: ["im.message.receive_v1"] } },
      callbacks: { items: [] },
    });
  });

  it("keeps the complete product profile least-privilege and deterministic", () => {
    const plan = permissionPlan("all");

    expect(plan.label).toBe("本产品所需最小权限");
    expect(plan.scopes).toContain("im:message.group_msg");
    expect(plan.scopes).toContain("im:message:send_as_bot");
    expect(plan.scopes).toContain("cardkit:card:write");
    expect(plan.scopes).not.toContain("contact:contact.base:readonly");
    expect(plan.scopes).not.toContain("drive:drive.metadata:readonly");
    expect(plan.events).toEqual(["im.message.receive_v1"]);
    expect(plan.callbacks).toEqual(["card.action.trigger"]);
    expect(plan.scopes).toEqual([...plan.scopes].sort());
  });

  it("rejects an unknown profile before opening an authorization flow", () => {
    expect(() => buildFeishuAppAddons("everything")).toThrow("未知飞书权限方案");
  });
});
