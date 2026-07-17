import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  applyProjectSandboxMaximum,
  decideProjectActions,
  loadProjectPolicy,
  projectPolicySummary,
  ProjectPolicyError,
} from "../src/project-policy.js";

describe("project policy", () => {
  it("uses the safe bridge floor when a repository has no policy", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "feishu-policy-none-"));
    const policy = await loadProjectPolicy(directory);
    expect(policy.source).toBe("default");
    expect(decideProjectActions(policy, ["commit", "deploy"])).toEqual({
      blockedActions: [],
      approvalActions: ["commit", "deploy"],
    });
  });

  it("can only tighten the sandbox ceiling and external actions", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "feishu-policy-repo-"));
    await writeFile(
      path.join(directory, ".feishu-codex-policy.json"),
      JSON.stringify({
        version: 1,
        sandbox: { maximum: "workspace-write" },
        operations: {
          allow: ["commit", "push", "pull_request"],
          deny: ["push"],
          requireApproval: ["commit"],
        },
      }),
    );
    const policy = await loadProjectPolicy(directory);
    expect(applyProjectSandboxMaximum("danger-full-access", policy)).toBe("workspace-write");
    expect(applyProjectSandboxMaximum("read-only", policy)).toBe("read-only");
    expect(decideProjectActions(policy, ["commit", "push", "deploy"])).toEqual({
      blockedActions: ["push", "deploy"],
      approvalActions: ["commit"],
    });
    expect(projectPolicySummary(policy)).toContain("仓库策略");
  });

  it("rejects invalid values and symbolic-link policy files", async () => {
    const invalid = await mkdtemp(path.join(os.tmpdir(), "feishu-policy-invalid-"));
    await writeFile(
      path.join(invalid, ".feishu-codex-policy.json"),
      JSON.stringify({ version: 1, operations: { deny: ["delete_everything"] } }),
    );
    await expect(loadProjectPolicy(invalid)).rejects.toBeInstanceOf(ProjectPolicyError);

    const linked = await mkdtemp(path.join(os.tmpdir(), "feishu-policy-link-"));
    const target = path.join(linked, "actual.json");
    await writeFile(target, JSON.stringify({ version: 1 }));
    await symlink(target, path.join(linked, ".feishu-codex-policy.json"));
    await expect(loadProjectPolicy(linked)).rejects.toThrow("普通文件");
  });
});
