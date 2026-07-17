import { describe, expect, it } from "vitest";

import { parseGitStatus, readProjectGitStatus } from "../src/project-status.js";

describe("project Git status", () => {
  it("parses branch, divergence, and worktree changes from one status call", () => {
    expect(
      parseGitStatus(
        "## feature/device...origin/feature/device [ahead 2, behind 1]\n M src/index.ts\n?? docs/new.md\n",
      ),
    ).toEqual({
      branch: "feature/device",
      detached: false,
      dirty: true,
      changedFiles: 2,
      ahead: 2,
      behind: 1,
    });
    expect(parseGitStatus("## No commits yet on main\n")).toMatchObject({
      branch: "main",
      dirty: false,
    });
    expect(parseGitStatus("## HEAD (no branch)\n")).toMatchObject({
      branch: "HEAD (no branch)",
      detached: true,
    });
  });

  it("returns null when Git metadata cannot be read", async () => {
    await expect(
      readProjectGitStatus("/missing", async () => {
        throw new Error("not a repository");
      }),
    ).resolves.toBeNull();
  });
});
