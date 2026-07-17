import { describe, expect, it } from "vitest";

import type { BridgeConfig } from "../src/config.js";
import {
  memberLabel,
  memberSelector,
  operatingTeamMembers,
  resolveMemberSelector,
  teamMembers,
} from "../src/team-directory.js";

function config(): BridgeConfig {
  return {
    adminSenderIds: new Set(["ou-admin"]),
    allowedSenderIds: new Set(["ou-operator"]),
    viewerSenderIds: new Set(["ou-viewer"]),
    memberLabels: new Map([
      ["ou-admin", "平台管理员"],
      ["ou-operator", "前端同学"],
    ]),
    projectAcl: new Map([["frontend", new Set(["ou-operator", "ou-viewer"])]]),
  } as BridgeConfig;
}

describe("team directory", () => {
  it("uses friendly labels and never needs to expose raw open ids", () => {
    const value = config();
    expect(memberLabel(value, "ou-operator")).toBe("前端同学");
    expect(memberLabel(value, "ou-viewer")).toMatch(/^成员 [A-F0-9]{6}$/);
    expect(memberSelector("ou-operator")).not.toContain("ou-operator");
  });

  it("resolves stable opaque selectors and preserves role priority", () => {
    const value = config();
    const members = teamMembers(value);
    expect(members.map((member) => member.role)).toEqual(["admin", "operator", "viewer"]);
    expect(resolveMemberSelector(value, members[1]!.selector)?.id).toBe("ou-operator");
  });

  it("only offers operating members with project access for handoff", () => {
    const members = operatingTeamMembers(config(), {
      path: "/repos/frontend",
      name: "frontend",
      displayPath: "~/repos/frontend",
    });
    expect(members.map((member) => member.id)).toEqual(["ou-admin", "ou-operator"]);
  });
});
