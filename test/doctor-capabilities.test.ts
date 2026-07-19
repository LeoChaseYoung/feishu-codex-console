import { describe, expect, it } from "vitest";

import { assessProjectChatScopes } from "../src/doctor-capabilities.js";

describe("doctor project-chat capability assessment", () => {
  it("reports ready when every application scope is present", () => {
    const result = assessProjectChatScopes(
      0,
      `Querying app scopes...\n${JSON.stringify({
        tenantScopes: [
          "im:chat:create",
          "im:chat.members:write_only",
          "im:message.pins:write_only",
          "im:message.group_msg:readonly",
        ],
      })}`,
    );
    expect(result).toEqual({
      status: "ready",
      missing: [],
      detail: expect.stringContaining("权限已验证"),
    });
  });

  it("lists exact missing scopes without marking private chat unavailable", () => {
    const result = assessProjectChatScopes(
      0,
      JSON.stringify({ tenantScopes: ["im:chat:create"] }),
    );
    expect(result.status).toBe("missing");
    expect(result.missing).toEqual([
      "im:chat.members:write_only",
      "im:message.pins:write_only",
      "im:message.group_msg（或 im:message.group_msg:readonly）",
    ]);
    expect(result.detail).toContain("私聊仍可使用");
  });

  it("is honest when lark-cli only returns user scopes", () => {
    const result = assessProjectChatScopes(
      0,
      JSON.stringify({ tokenType: "user", userScopes: ["offline_access"] }),
    );
    expect(result.status).toBe("unknown");
    expect(result.detail).toContain("普通消息能力尚未验证");
  });

  it("uses successful runtime delivery evidence when app scopes cannot be enumerated", () => {
    const result = assessProjectChatScopes(
      0,
      JSON.stringify({ tokenType: "user", userScopes: ["offline_access"] }),
      {
        totalBindings: 1,
        readyBindings: 1,
        messageVerifiedBindings: 1,
        lastVerifiedAt: "2026-07-19T08:51:56.794Z",
      },
    );

    expect(result.status).toBe("ready");
    expect(result.detail).toContain("通过运行实证");
    expect(result.detail).toContain("群内普通消息均成功");
  });

  it("accepts either ordinary group-message scope", () => {
    const result = assessProjectChatScopes(
      0,
      JSON.stringify({
        tenantScopes: [
          "im:chat:create",
          "im:chat.members:write_only",
          "im:message.pins:write_only",
          "im:message.group_msg",
        ],
      }),
    );
    expect(result.status).toBe("ready");
  });
});
