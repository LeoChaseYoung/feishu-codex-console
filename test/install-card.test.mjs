import { describe, expect, it } from "vitest";

import { sendInstallationCard } from "../scripts/install-card.mjs";

describe("installation success card", () => {
  it("creates and replies with an actionable onboarding card", async () => {
    const calls = [];
    class FakeLarkCli {
      constructor(options) {
        calls.push(["construct", options]);
      }
      async createCard(card) {
        calls.push(["create", card]);
        return "card-install";
      }
      async replyCard(messageId, cardId, key) {
        calls.push(["reply", messageId, cardId, key]);
        return "om-install";
      }
    }
    const renderOnboardingCard = (snapshot) => {
      calls.push(["render", snapshot]);
      return { schema: "2.0", body: { elements: [] } };
    };

    await expect(
      sendInstallationCard({
        packageRoot: "/tmp/package",
        larkCliPath: "/tmp/lark-cli",
        messageId: "om-source",
        ownerId: "ou-owner",
        instanceId: "default",
        projectName: "bridge",
        sandboxLabel: "工作区写入",
        LarkCliClass: FakeLarkCli,
        renderOnboardingCard,
      }),
    ).resolves.toEqual({ cardId: "card-install" });

    expect(calls[1][1]).toMatchObject({
      role: "admin",
      state: { ownerId: "ou-owner", status: "active", step: 1 },
      projectName: "bridge",
      sandboxLabel: "工作区写入",
      deviceOnline: true,
    });
    expect(calls[1][1].feedback).toMatch(/端到端验证/);
    expect(calls.at(-1)).toEqual([
      "reply",
      "om-source",
      "card-install",
      "install_default_om-source",
    ]);
  });
});
