import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("team configuration", () => {
  it("loads explicit roles, project ACLs, isolation, and operator permission ceilings", () => {
    const cwd = process.cwd();
    const config = loadConfig(
      {
        ALLOWED_FEISHU_OPEN_IDS: "ou-operator",
        FEISHU_ADMIN_OPEN_IDS: "ou-admin",
        FEISHU_VIEWER_OPEN_IDS: "ou-viewer",
        FEISHU_MEMBER_LABELS_JSON: JSON.stringify({ "ou-operator": "前端同学" }),
        FEISHU_GROUP_SESSION_SCOPE: "member",
        FEISHU_PROJECT_ACL_JSON: JSON.stringify({ bridge: ["ou-operator"] }),
        CODEX_WORKDIR: cwd,
        CODEX_SANDBOX_MODE: "danger-full-access",
        CODEX_OPERATOR_SANDBOX_MODE: "workspace-write",
        BRIDGE_INSTANCE_ID: "Engineering West",
        BRIDGE_DATA_DIR: path.join(cwd, "var", "team-test"),
      },
      cwd,
    );
    expect(config.adminSenderIds).toEqual(new Set(["ou-admin"]));
    expect(config.viewerSenderIds).toEqual(new Set(["ou-viewer"]));
    expect(config.operatorSandboxMode).toBe("workspace-write");
    expect(config.groupSessionScope).toBe("member");
    expect(config.projectAcl.get("bridge")).toEqual(new Set(["ou-operator"]));
    expect(config.memberLabels.get("ou-operator")).toBe("前端同学");
    expect(config.configVersion).toBe(1);
    expect(config.serviceLabel).toBe("com.feishu-codex-bridge.engineering-west");
    expect(config.databaseFile).toBe(path.join(cwd, "var", "team-test", "state.sqlite"));
    expect(config.autoOnboarding).toBe(true);
    expect(config.completionNotifications).toBe(false);
    expect(config.multiAgentEnabled).toBe(false);
  });

  it("treats operators as administrators in backward-compatible personal mode", () => {
    const cwd = process.cwd();
    const config = loadConfig(
      {
        ALLOWED_FEISHU_OPEN_IDS: "ou-owner",
        CODEX_WORKDIR: cwd,
      },
      cwd,
    );
    expect(config.adminSenderIds).toEqual(new Set(["ou-owner"]));
    expect(config.autoOnboarding).toBe(true);
  });

  it("allows automatic onboarding to be disabled for managed deployments", () => {
    const cwd = process.cwd();
    const config = loadConfig(
      {
        ALLOWED_FEISHU_OPEN_IDS: "ou-owner",
        CODEX_WORKDIR: cwd,
        FEISHU_AUTO_ONBOARDING: "false",
      },
      cwd,
    );
    expect(config.autoOnboarding).toBe(false);
  });

  it("requires an explicit opt-in before Codex can spawn subagents", () => {
    const cwd = process.cwd();
    const config = loadConfig(
      {
        ALLOWED_FEISHU_OPEN_IDS: "ou-owner",
        CODEX_WORKDIR: cwd,
        CODEX_MULTI_AGENT_ENABLED: "true",
      },
      cwd,
    );
    expect(config.multiAgentEnabled).toBe(true);
  });

  it("rejects an operator sandbox ceiling above the service ceiling", () => {
    const cwd = process.cwd();
    expect(() =>
      loadConfig(
        {
          ALLOWED_FEISHU_OPEN_IDS: "ou-owner",
          CODEX_WORKDIR: cwd,
          CODEX_SANDBOX_MODE: "read-only",
          CODEX_OPERATOR_SANDBOX_MODE: "workspace-write",
        },
        cwd,
      ),
    ).toThrow(/cannot exceed/);
  });

  it("refuses unknown future configuration contracts", () => {
    const cwd = process.cwd();
    expect(() =>
      loadConfig(
        {
          BRIDGE_CONFIG_VERSION: "2",
          ALLOWED_FEISHU_OPEN_IDS: "ou-owner",
          CODEX_WORKDIR: cwd,
        },
        cwd,
      ),
    ).toThrow(/newer than this bridge supports/);
  });
});
