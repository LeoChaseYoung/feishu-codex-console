import { describe, expect, it } from "vitest";

import type { CodexProject } from "../src/project-registry.js";
import {
  rankProjectWorkspace,
  resolveProjectSelector,
} from "../src/project-workspace.js";

const projects: CodexProject[] = ["a", "b", "c"].map((name) => ({
  name,
  path: `/repos/${name}`,
  displayPath: `repos/${name}`,
  isGitRepository: true,
  source: "scan",
}));

describe("project workspace ranking", () => {
  it("places favorites first, then recent projects, without including inaccessible usage", () => {
    const ranked = rankProjectWorkspace(projects, [
      {
        ownerId: "ou-1",
        projectPath: "/repos/a",
        favorite: false,
        lastUsedAt: "2026-07-16T12:00:00.000Z",
        useCount: 2,
      },
      {
        ownerId: "ou-1",
        projectPath: "/repos/b",
        favorite: true,
        lastUsedAt: "2026-07-16T10:00:00.000Z",
        useCount: 1,
      },
      {
        ownerId: "ou-1",
        projectPath: "/secret/x",
        favorite: true,
        lastUsedAt: "2026-07-16T13:00:00.000Z",
        useCount: 1,
      },
    ]);
    expect(ranked.projects.map((project) => project.path)).toEqual([
      "/repos/b",
      "/repos/a",
      "/repos/c",
    ]);
    expect(ranked.favoritePaths).toEqual(["/repos/b"]);
    expect(ranked.recentPaths).toEqual(["/repos/a", "/repos/b"]);
  });

  it("resolves numeric, exact, and fuzzy selectors against the displayed order", () => {
    const displayed = [projects[1]!, projects[0]!, projects[2]!];
    expect(resolveProjectSelector(displayed, "1")).toEqual({
      status: "found",
      project: projects[1],
    });
    expect(resolveProjectSelector(displayed, "/repos/a")).toEqual({
      status: "found",
      project: projects[0],
    });
    expect(resolveProjectSelector(displayed, "repos/c")).toEqual({
      status: "found",
      project: projects[2],
    });
    expect(resolveProjectSelector(displayed, "repos")).toMatchObject({
      status: "ambiguous",
    });
  });
});
