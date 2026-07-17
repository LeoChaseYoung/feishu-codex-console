import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildEnvFile,
  defaultSetupPaths,
  normalizeInstanceId,
  validateChatIds,
  validateOpenIds,
} from "../scripts/setup-lib.mjs";

describe("open-source setup", () => {
  it("normalizes instance names and uses per-user config paths", () => {
    expect(normalizeInstanceId("Engineering West")).toBe("engineering-west");
    expect(defaultSetupPaths("Team", "/Users/demo")).toEqual({
      instance: "team",
      configDir: "/Users/demo/.config/feishu-codex-bridge",
      configFile: "/Users/demo/.config/feishu-codex-bridge/team.env",
      dataDir: "/Users/demo/.local/share/feishu-codex-bridge/team",
    });
  });

  it("rejects unrestricted or malformed Feishu operators", () => {
    expect(() => validateOpenIds("")).toThrow(/不能为空/);
    expect(() => validateOpenIds("user@example.com")).toThrow(/ou_/);
  });

  it("rejects malformed group chat allowlist entries", () => {
    expect(validateChatIds("oc_group_1,oc_group_2")).toEqual(["oc_group_1", "oc_group_2"]);
    expect(() => validateChatIds("group-1")).toThrow(/oc_/);
  });

  it("generates the recommended personal-safe configuration", () => {
    const output = buildEnvFile({
      preset: "personal",
      instanceId: "default",
      dataDir: "/Users/demo/.local/share/feishu-codex-bridge/default",
      operatorIds: ["ou_owner"],
      adminIds: ["ou_owner"],
      viewerIds: [],
      chatIds: [],
      workdir: "/Users/demo/My Project",
      projectRoots: ["/Users/demo/Code"],
    });
    expect(output).toContain("CODEX_SANDBOX_MODE=workspace-write");
    expect(output).toContain("CODEX_MULTI_AGENT_ENABLED=false");
    expect(output).toContain("CODEX_OPERATOR_SANDBOX_MODE=workspace-write");
    expect(output).toContain("CODEX_NETWORK_ACCESS=false");
    expect(output).toContain("FEISHU_COMPLETION_NOTIFICATIONS=false");
    expect(output).toContain("FEISHU_MEMBER_LABELS_JSON=\n");
    expect(output).toContain(`CODEX_WORKDIR=${JSON.stringify(path.resolve("/Users/demo/My Project"))}`);
  });

  it("keeps full access admin-only in the power preset", () => {
    const output = buildEnvFile({
      preset: "power",
      instanceId: "power",
      dataDir: "/tmp/bridge-power",
      operatorIds: ["ou_operator"],
      adminIds: ["ou_admin"],
      viewerIds: [],
      chatIds: [],
      workdir: process.cwd(),
      projectRoots: [],
    });
    expect(output).toContain("CODEX_SANDBOX_MODE=danger-full-access");
    expect(output).toContain("CODEX_OPERATOR_SANDBOX_MODE=workspace-write");
    expect(output).toContain("ALLOWED_FEISHU_CHAT_IDS=\n");
  });
});
