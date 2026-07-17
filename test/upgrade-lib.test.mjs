import { describe, expect, it } from "vitest";

import {
  assessUpgradeReadiness,
  compareVersions,
  parseBackupId,
} from "../scripts/upgrade-lib.mjs";

describe("safe upgrade planning", () => {
  it("orders stable and prerelease semantic versions", () => {
    expect(compareVersions("1.0.0", "1.0.0-beta.4")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-beta.4", "1.0.0-beta.3")).toBeGreaterThan(0);
    expect(compareVersions("1.1.0", "1.0.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0+build.7", "1.0.0+build.2")).toBe(0);
    expect(() => compareVersions("1.0.0-not valid", "1.0.0")).toThrow("无效版本号");
  });

  it("blocks upgrades while a live or persisted task is running", () => {
    expect(
      assessUpgradeReadiness({
        currentVersion: "1.0.0-beta.3",
        targetVersion: "1.0.0-beta.4",
        healthActiveTasks: 1,
        databaseActiveTasks: 0,
      }),
    ).toMatchObject({ allowed: false, reason: expect.stringContaining("运行任务") });
  });

  it("requires an explicit downgrade flag and detects no-op upgrades", () => {
    expect(
      assessUpgradeReadiness({
        currentVersion: "1.1.0",
        targetVersion: "1.0.0",
      }).allowed,
    ).toBe(false);
    expect(
      assessUpgradeReadiness({
        currentVersion: "1.0.0",
        targetVersion: "1.0.0",
      }),
    ).toMatchObject({ allowed: false, upToDate: true });
  });

  it("allows an unknown legacy version with a visible rollback warning", () => {
    const result = assessUpgradeReadiness({
      currentVersion: "unknown",
      targetVersion: "1.0.0-beta.4",
    });
    expect(result.allowed).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it("extracts the immutable backup id from maintenance output", () => {
    expect(parseBackupId("运行数据备份完成\n备份 ID：upgrade-123\n位置：/tmp/x")).toBe(
      "upgrade-123",
    );
  });
});
