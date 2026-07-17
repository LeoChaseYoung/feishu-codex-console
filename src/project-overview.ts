import { execFile } from "node:child_process";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { CodexProject } from "./project-registry.js";
import { readProjectGitStatus, type ProjectGitStatus } from "./project-status.js";

const execFileAsync = promisify(execFile);
const MAX_METADATA_BYTES = 256 * 1024;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 20_000;
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".idea",
  ".vscode",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "vendor",
  ".next",
  ".nuxt",
]);

export interface ProjectOverviewSnapshot {
  project: CodexProject;
  generatedAt: string;
  gitStatus: ProjectGitStatus | null;
  commit: string | null;
  description: string;
  packageManager: string;
  workspace: boolean;
  fileCount: number;
  indexTruncated: boolean;
  languages: string[];
  stack: string[];
  topDirectories: string[];
  scripts: string[];
}

interface PackageMetadata {
  description?: string;
  packageManager?: string;
  workspaces?: unknown;
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
}

export async function readProjectOverview(
  project: CodexProject,
): Promise<ProjectOverviewSnapshot> {
  const [gitStatus, commit, packageMetadata, readme, indexedFiles] = await Promise.all([
    project.isGitRepository ? readProjectGitStatus(project.path) : Promise.resolve(null),
    project.isGitRepository ? readGitCommit(project.path) : Promise.resolve(null),
    readPackageMetadata(project.path),
    readReadme(project.path),
    project.isGitRepository
      ? readGitFiles(project.path)
      : readDirectoryFiles(project.path),
  ]);
  const workspacePackages = await readWorkspacePackageMetadata(
    project.path,
    indexedFiles.files,
  );
  const dependencyNames = new Set([
    ...Object.keys(packageMetadata?.dependencies ?? {}),
    ...Object.keys(packageMetadata?.devDependencies ?? {}),
    ...workspacePackages.flatMap((metadata) => Object.keys(metadata.dependencies ?? {})),
    ...workspacePackages.flatMap((metadata) => Object.keys(metadata.devDependencies ?? {})),
  ]);
  const workspace = Boolean(packageMetadata?.workspaces) || await exists(
    path.join(project.path, "pnpm-workspace.yaml"),
  );

  return {
    project,
    generatedAt: new Date().toISOString(),
    gitStatus,
    commit,
    description:
      cleanDescription(packageMetadata?.description) ||
      extractReadmeDescription(readme) ||
      "暂未发现项目描述。",
    packageManager: await detectPackageManager(project.path, packageMetadata?.packageManager),
    workspace,
    fileCount: indexedFiles.files.length,
    indexTruncated: indexedFiles.truncated,
    languages: detectLanguages(indexedFiles.files),
    stack: detectStack(dependencyNames),
    topDirectories: detectTopDirectories(indexedFiles.files),
    scripts: Object.keys(packageMetadata?.scripts ?? {}).slice(0, 8),
  };
}

async function readPackageMetadata(projectPath: string): Promise<PackageMetadata | null> {
  return readPackageMetadataFile(path.join(projectPath, "package.json"));
}

async function readWorkspacePackageMetadata(
  projectPath: string,
  files: string[],
): Promise<PackageMetadata[]> {
  const manifests = files
    .filter((file) => file !== "package.json" && file.endsWith("/package.json"))
    .slice(0, 20);
  const values = await Promise.all(
    manifests.map((manifest) => readPackageMetadataFile(path.join(projectPath, manifest))),
  );
  return values.filter((value): value is PackageMetadata => value !== null);
}

async function readPackageMetadataFile(file: string): Promise<PackageMetadata | null> {
  try {
    if ((await stat(file)).size > MAX_METADATA_BYTES) return null;
    const value = JSON.parse(await readFile(file, "utf8")) as unknown;
    return isRecord(value) ? value as PackageMetadata : null;
  } catch {
    return null;
  }
}

async function readReadme(projectPath: string): Promise<string> {
  try {
    const entries = await readdir(projectPath);
    const name = entries.find((entry) => /^readme(?:\.|$)/i.test(entry));
    if (!name) return "";
    const file = path.join(projectPath, name);
    if ((await stat(file)).size > MAX_METADATA_BYTES) return "";
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function readGitCommit(projectPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", projectPath, "rev-parse", "--short=10", "HEAD"],
      gitOptions(128 * 1024),
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function readGitFiles(
  projectPath: string,
): Promise<{ files: string[]; truncated: boolean }> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", projectPath, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      gitOptions(MAX_INDEX_BYTES),
    );
    const all = stdout.split("\0").filter(Boolean);
    return { files: all.slice(0, MAX_FILES), truncated: all.length > MAX_FILES };
  } catch {
    return readDirectoryFiles(projectPath);
  }
}

async function readDirectoryFiles(
  projectPath: string,
): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  const pending = [projectPath];
  while (pending.length > 0 && files.length < MAX_FILES) {
    const directory = pending.shift();
    if (!directory) break;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) pending.push(absolute);
      } else if (entry.isFile()) {
        files.push(path.relative(projectPath, absolute));
        if (files.length >= MAX_FILES) break;
      }
    }
  }
  return { files, truncated: pending.length > 0 };
}

function detectLanguages(files: string[]): string[] {
  const labels: Record<string, string> = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".vue": "Vue",
    ".py": "Python",
    ".go": "Go",
    ".rs": "Rust",
    ".java": "Java",
    ".kt": "Kotlin",
    ".swift": "Swift",
    ".php": "PHP",
    ".rb": "Ruby",
    ".css": "CSS",
    ".scss": "SCSS",
    ".less": "Less",
  };
  const counts = new Map<string, number>();
  for (const file of files) {
    const label = labels[path.extname(file).toLocaleLowerCase()];
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([label]) => label);
}

function detectStack(dependencies: Set<string>): string[] {
  const known: Array<[string, string]> = [
    ["react", "React"],
    ["next", "Next.js"],
    ["vue", "Vue"],
    ["nuxt", "Nuxt"],
    ["@angular/core", "Angular"],
    ["svelte", "Svelte"],
    ["typescript", "TypeScript"],
    ["vite", "Vite"],
    ["@rspack/core", "Rspack"],
    ["webpack", "Webpack"],
    ["express", "Express"],
    ["@nestjs/core", "NestJS"],
    ["jest", "Jest"],
    ["vitest", "Vitest"],
    ["playwright", "Playwright"],
    ["@playwright/test", "Playwright"],
    ["zustand", "Zustand"],
    ["redux", "Redux"],
    ["@reduxjs/toolkit", "Redux Toolkit"],
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const [dependency, label] of known) {
    if (dependencies.has(dependency) && !seen.has(label)) {
      seen.add(label);
      result.push(label);
    }
  }
  return result.slice(0, 8);
}

function detectTopDirectories(files: string[]): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const [first, ...rest] = file.split("/");
    if (!first || rest.length === 0 || SKIP_DIRECTORIES.has(first)) continue;
    counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([directory]) => directory);
}

async function detectPackageManager(projectPath: string, declared?: string): Promise<string> {
  if (declared?.trim()) return declared.trim().split("@")[0] || declared.trim();
  if (await exists(path.join(projectPath, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(path.join(projectPath, "yarn.lock"))) return "yarn";
  if (await exists(path.join(projectPath, "bun.lockb"))) return "bun";
  if (await exists(path.join(projectPath, "package-lock.json"))) return "npm";
  return "未识别";
}

function extractReadmeDescription(source: string): string {
  if (!source.trim()) return "";
  const withoutCode = source.replace(/```[\s\S]*?```/g, " ");
  const paragraphs = withoutCode.split(/\n\s*\n/);
  for (const paragraph of paragraphs) {
    const cleaned = cleanDescription(
      paragraph
        .replace(/^#{1,6}\s+.*$/gm, "")
        .replace(/!\[[^\]]*]\([^)]*\)/g, "")
        .replace(/\[[^\]]*]\([^)]*\)/g, (match) => match.replace(/^\[|]\([^)]*\)$/g, ""))
        .replace(/<[^>]+>/g, "")
        .replace(/^[-*>\s]+/gm, "")
        .replace(/[`*_~]/g, ""),
    );
    if (cleaned.length >= 24) return cleaned;
  }
  return "";
}

function cleanDescription(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function gitOptions(maxBuffer: number) {
  return {
    timeout: 4_000,
    maxBuffer,
    encoding: "utf8" as const,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
    },
  };
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
