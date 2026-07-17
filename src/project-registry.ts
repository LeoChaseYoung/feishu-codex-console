import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const SKIP_DIRECTORIES = new Set([
  ".git",
  ".idea",
  ".vscode",
  ".codex",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "vendor",
]);

export interface CodexProject {
  name: string;
  path: string;
  displayPath: string;
  isGitRepository: boolean;
  source: "codex" | "scan" | "default";
}

export type ProjectResolution =
  | { status: "found"; project: CodexProject }
  | { status: "missing" }
  | { status: "ambiguous"; projects: CodexProject[] };

interface SavedProject {
  path: string;
  name?: string;
}

export class ProjectRegistry {
  private discovered: CodexProject[] = [];
  private canonicalRoots: string[] = [];
  private canonicalDefaultWorkdir: string;
  private canonicalHome = homedir();

  constructor(
    private readonly roots: string[],
    private readonly defaultWorkdir: string,
    private readonly maxDepth: number,
    private readonly maxProjects: number,
    private readonly codexStateFile?: string,
  ) {
    this.canonicalDefaultWorkdir = defaultWorkdir;
  }

  async refresh(): Promise<readonly CodexProject[]> {
    const projects = new Map<string, CodexProject>();
    try {
      this.canonicalHome = await realpath(homedir());
    } catch {
      this.canonicalHome = homedir();
    }

    if (this.codexStateFile) {
      const savedProjects = await this.readCodexSavedProjects();
      for (const saved of savedProjects) {
        const project = await this.projectFromPath(saved.path, saved.name, "codex", false);
        if (project && !projects.has(project.path)) projects.set(project.path, project);
      }
    }

    const scannedPaths = new Set<string>();
    this.canonicalRoots = [];
    for (const root of this.roots) {
      let canonicalRoot: string;
      try {
        canonicalRoot = await realpath(root);
      } catch {
        continue;
      }
      this.canonicalRoots.push(canonicalRoot);
      await this.scan(canonicalRoot, canonicalRoot, 0, scannedPaths);
      if (scannedPaths.size >= this.maxProjects) break;
    }
    for (const projectPath of [...scannedPaths].sort((left, right) => left.localeCompare(right))) {
      const project = await this.projectFromPath(projectPath, undefined, "scan", true);
      if (project && !projects.has(project.path)) projects.set(project.path, project);
    }

    const defaultProject = await this.projectFromPath(
      this.defaultWorkdir,
      undefined,
      "default",
      false,
    );
    if (!defaultProject) {
      throw new Error(`Default Codex project is unavailable: ${this.defaultWorkdir}`);
    }
    this.canonicalDefaultWorkdir = defaultProject.path;
    if (!projects.has(defaultProject.path)) projects.set(defaultProject.path, defaultProject);

    const limited = [...projects.values()].slice(0, this.maxProjects);
    if (!limited.some((project) => project.path === defaultProject.path)) {
      limited[Math.max(0, limited.length - 1)] = defaultProject;
    }
    this.discovered = limited;
    return limited;
  }

  list(): readonly CodexProject[] {
    return this.discovered;
  }

  defaultProject(): CodexProject {
    return (
      this.getByPath(this.canonicalDefaultWorkdir) ?? {
        name: path.basename(this.canonicalDefaultWorkdir),
        path: this.canonicalDefaultWorkdir,
        displayPath: this.displayPath(this.canonicalDefaultWorkdir),
        isGitRepository: false,
        source: "default",
      }
    );
  }

  getByPath(projectPath: string): CodexProject | undefined {
    return this.discovered.find((project) => project.path === projectPath);
  }

  resolve(selector: string): ProjectResolution {
    const query = selector.trim();
    if (!query) return { status: "missing" };

    if (/^\d+$/.test(query)) {
      const index = Number.parseInt(query, 10) - 1;
      const project = this.discovered[index];
      return project ? { status: "found", project } : { status: "missing" };
    }

    const normalized = query.toLocaleLowerCase();
    const exact = this.discovered.filter(
      (project) =>
        project.name.toLocaleLowerCase() === normalized ||
        project.displayPath.toLocaleLowerCase() === normalized ||
        project.path.toLocaleLowerCase() === normalized,
    );
    if (exact.length === 1 && exact[0]) return { status: "found", project: exact[0] };
    if (exact.length > 1) return { status: "ambiguous", projects: exact };

    const fuzzy = this.discovered.filter(
      (project) =>
        project.name.toLocaleLowerCase().includes(normalized) ||
        project.displayPath.toLocaleLowerCase().includes(normalized),
    );
    if (fuzzy.length === 1 && fuzzy[0]) return { status: "found", project: fuzzy[0] };
    if (fuzzy.length > 1) return { status: "ambiguous", projects: fuzzy };
    return { status: "missing" };
  }

  private async scan(
    root: string,
    directory: string,
    depth: number,
    projects: Set<string>,
  ): Promise<void> {
    if (projects.size >= this.maxProjects || depth > this.maxDepth) return;
    let canonical: string;
    try {
      canonical = await realpath(directory);
    } catch {
      return;
    }
    if (!isWithin(root, canonical)) return;

    // Additional roots are discovery-only, so arbitrary non-Git directories
    // under them never become selectable. Non-Git folders are accepted only
    // when they are exact projects explicitly saved in Codex (or the default).
    if (await isGitRepository(canonical)) {
      projects.add(canonical);
      return;
    }

    let entries;
    try {
      entries = await readdir(canonical, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || SKIP_DIRECTORIES.has(entry.name)) {
        continue;
      }
      await this.scan(root, path.join(canonical, entry.name), depth + 1, projects);
      if (projects.size >= this.maxProjects) return;
    }
  }

  private displayPath(projectPath: string): string {
    for (const root of this.canonicalRoots) {
      if (!isWithin(root, projectPath)) continue;
      const relative = path.relative(root, projectPath);
      return relative || path.basename(projectPath);
    }
    if (isWithin(this.canonicalHome, projectPath)) {
      const relative = path.relative(this.canonicalHome, projectPath);
      return relative ? `~/${relative}` : "~";
    }
    return projectPath;
  }

  private async projectFromPath(
    projectPath: string,
    name: string | undefined,
    source: CodexProject["source"],
    requireGit: boolean,
  ): Promise<CodexProject | null> {
    let canonical: string;
    try {
      canonical = await realpath(projectPath);
      const stats = await lstat(canonical);
      if (!stats.isDirectory()) return null;
    } catch {
      return null;
    }

    if (source === "codex" && isBroadDirectory(canonical, this.canonicalHome)) {
      console.warn("[projects] ignored an overly broad Codex project entry");
      return null;
    }

    const git = await isGitRepository(canonical);
    if (requireGit && !git) return null;
    return {
      name: name?.trim() || path.basename(canonical),
      path: canonical,
      displayPath: this.displayPath(canonical),
      isGitRepository: git,
      source,
    };
  }

  private async readCodexSavedProjects(): Promise<SavedProject[]> {
    if (!this.codexStateFile) return [];
    try {
      const parsed: unknown = JSON.parse(await readFile(this.codexStateFile, "utf8"));
      if (!isRecord(parsed)) return [];
      const saved = stringArray(parsed["electron-saved-workspace-roots"]);
      const order = stringArray(parsed["project-order"]);
      const labels = isRecord(parsed["electron-workspace-root-labels"])
        ? parsed["electron-workspace-root-labels"]
        : {};
      const savedSet = new Set(saved);
      const ordered = [
        ...saved.filter((projectPath) => !order.includes(projectPath)),
        ...order.filter((projectPath) => savedSet.has(projectPath)),
      ];
      const seen = new Set<string>();
      return ordered.flatMap((projectPath) => {
        if (seen.has(projectPath)) return [];
        seen.add(projectPath);
        const label = labels[projectPath];
        return [
          {
            path: projectPath,
            ...(typeof label === "string" && label.trim() ? { name: label.trim() } : {}),
          },
        ];
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`[projects] unable to read Codex saved projects: ${(error as Error).message}`);
      }
      return [];
    }
  }
}

async function isGitRepository(directory: string): Promise<boolean> {
  try {
    await lstat(path.join(directory, ".git"));
    return true;
  } catch {
    return false;
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function isBroadDirectory(candidate: string, home: string): boolean {
  return candidate === path.parse(candidate).root || candidate === home;
}
