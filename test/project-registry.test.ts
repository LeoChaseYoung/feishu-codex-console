import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectRegistry } from "../src/project-registry.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function gitRepository(directory: string): Promise<string> {
  await mkdir(path.join(directory, ".git"), { recursive: true });
  return realpath(directory);
}

describe("ProjectRegistry", () => {
  it("discovers repositories and resolves them by number, name, or partial path", async () => {
    const root = await temporaryDirectory("feishu-codex-projects-");
    const alpha = await gitRepository(path.join(root, "team-a", "alpha"));
    const beta = await gitRepository(path.join(root, "team-b", "beta"));
    const registry = new ProjectRegistry([root], alpha, 5, 20);

    const projects = await registry.refresh();

    expect(projects.map((project) => project.path)).toEqual([alpha, beta]);
    expect(registry.resolve("1")).toMatchObject({ status: "found", project: { path: alpha } });
    expect(registry.resolve("beta")).toMatchObject({ status: "found", project: { path: beta } });
    expect(registry.resolve("team-b")).toMatchObject({
      status: "found",
      project: { path: beta },
    });
    expect(registry.resolve("missing")).toEqual({ status: "missing" });
  });

  it("does not follow a symlink outside an approved root", async () => {
    const root = await temporaryDirectory("feishu-codex-root-");
    const outside = await temporaryDirectory("feishu-codex-outside-");
    const local = await gitRepository(path.join(root, "local"));
    const escaped = await gitRepository(path.join(outside, "escaped"));
    await symlink(escaped, path.join(root, "outside-link"));
    const registry = new ProjectRegistry([root], local, 5, 20);

    const projects = await registry.refresh();

    expect(projects.map((project) => project.path)).toEqual([local]);
    expect(projects.some((project) => project.path === escaped)).toBe(false);
  });

  it("allows the exact configured default to be non-Git without discovering sibling folders", async () => {
    const root = await temporaryDirectory("feishu-codex-nongit-");
    const defaultWorkdir = path.join(root, "default");
    await mkdir(defaultWorkdir, { recursive: true });
    await mkdir(path.join(root, "ordinary-directory"), { recursive: true });
    const registry = new ProjectRegistry([root], defaultWorkdir, 5, 20);

    const projects = await registry.refresh();

    expect(projects.map((project) => project.path)).toEqual([await realpath(defaultWorkdir)]);
    expect(projects[0]).toMatchObject({ isGitRepository: false, source: "default" });
  });

  it("mirrors Codex saved projects, custom labels, order, and non-Git folders", async () => {
    const root = await temporaryDirectory("feishu-codex-saved-");
    const defaultProject = await gitRepository(path.join(root, "bridge"));
    const dam = await gitRepository(path.join(root, "dam"));
    const jml = path.join(root, "jml");
    await mkdir(jml, { recursive: true });
    const novartis = await gitRepository(path.join(root, "novartis"));
    const stateFile = path.join(root, "codex-state.json");
    await writeFile(
      stateFile,
      JSON.stringify({
        "electron-saved-workspace-roots": [dam, jml, novartis],
        "project-order": [dam, jml],
        "electron-workspace-root-labels": { [jml]: "JML 集合" },
      }),
    );
    const registry = new ProjectRegistry([defaultProject], defaultProject, 5, 20, stateFile);

    const projects = await registry.refresh();

    expect(projects.map((project) => project.path)).toEqual([
      novartis,
      dam,
      await realpath(jml),
      defaultProject,
    ]);
    expect(projects[2]).toMatchObject({
      name: "JML 集合",
      isGitRepository: false,
      source: "codex",
    });
  });
});
