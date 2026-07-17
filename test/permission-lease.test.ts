import { describe, expect, it } from "vitest";

import {
  permissionLeaseIsActive,
  permissionLeaseLabel,
  persistentSandboxMode,
} from "../src/permission-lease.js";

describe("permission leases", () => {
  it("never stores full access as the persistent conversation default", () => {
    expect(persistentSandboxMode(undefined, "danger-full-access")).toBe("workspace-write");
    expect(persistentSandboxMode("danger-full-access", "danger-full-access")).toBe(
      "workspace-write",
    );
    expect(persistentSandboxMode("workspace-write", "read-only")).toBe("read-only");
  });

  it("labels and expires a one-task lease", () => {
    const now = Date.parse("2026-07-16T00:00:00Z");
    const lease = {
      conversationKey: "chat::owner",
      ownerId: "owner",
      projectPath: "/workspace/demo",
      scope: "next-task" as const,
      createdAt: "2026-07-16T00:00:00Z",
      updatedAt: "2026-07-16T00:00:00Z",
      expiresAt: "2026-07-16T00:30:00Z",
      remainingUses: 1,
    };
    expect(permissionLeaseIsActive(lease, now)).toBe(true);
    expect(permissionLeaseLabel(lease, now)).toContain("下一任务");
    expect(permissionLeaseIsActive(lease, now + 31 * 60_000)).toBe(false);
  });
});
