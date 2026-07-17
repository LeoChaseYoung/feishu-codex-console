import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { renderProjectOverviewCard } from "../src/project-overview-card.js";
import { readProjectOverview } from "../src/project-overview.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe("local project overview", () => {
  it("builds a useful snapshot without invoking Codex", async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), "bridge-overview-"));
    temporaryDirectories.push(projectPath);
    await mkdir(path.join(projectPath, "src"));
    await writeFile(
      path.join(projectPath, "package.json"),
      JSON.stringify({
        description: "A small remote coding console.",
        packageManager: "pnpm@10.0.0",
        workspaces: ["packages/*"],
        scripts: { test: "vitest", build: "tsc" },
        dependencies: { react: "latest", zustand: "latest" },
        devDependencies: { typescript: "latest", vitest: "latest" },
      }),
    );
    await writeFile(path.join(projectPath, "README.md"), "# Demo\n\nREADME fallback.");
    await writeFile(path.join(projectPath, "src", "index.tsx"), "export {};\n");

    const snapshot = await readProjectOverview({
      name: "demo",
      path: projectPath,
      displayPath: "demo",
      isGitRepository: false,
      source: "default",
    });

    expect(snapshot.description).toBe("A small remote coding console.");
    expect(snapshot.packageManager).toBe("pnpm");
    expect(snapshot.workspace).toBe(true);
    expect(snapshot.languages).toContain("TypeScript");
    expect(snapshot.stack).toEqual(expect.arrayContaining(["React", "TypeScript", "Vitest"]));
    expect(snapshot.topDirectories).toContain("src");
    expect(JSON.stringify(renderProjectOverviewCard(snapshot))).toContain("0 AI token");
  });
});
