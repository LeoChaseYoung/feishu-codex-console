import type { CodexProject, ProjectResolution } from "./project-registry.js";
import type { ProjectUsageState } from "./types.js";

export interface RankedProjectWorkspace {
  projects: CodexProject[];
  favoritePaths: string[];
  recentPaths: string[];
}

export function rankProjectWorkspace(
  projects: readonly CodexProject[],
  usage: readonly ProjectUsageState[],
  recentLimit = 8,
): RankedProjectWorkspace {
  const visiblePaths = new Set(projects.map((project) => project.path));
  const usageByPath = new Map(
    usage
      .filter((entry) => visiblePaths.has(entry.projectPath))
      .map((entry) => [entry.projectPath, entry]),
  );
  const favoritePaths = usage
    .filter((entry) => entry.favorite && visiblePaths.has(entry.projectPath))
    .sort(compareUsage)
    .map((entry) => entry.projectPath);
  const recentPaths = usage
    .filter((entry) => entry.lastUsedAt && visiblePaths.has(entry.projectPath))
    .sort(compareUsage)
    .slice(0, recentLimit)
    .map((entry) => entry.projectPath);
  const projectsSorted = [...projects].sort((left, right) => {
    const leftUsage = usageByPath.get(left.path);
    const rightUsage = usageByPath.get(right.path);
    const favoriteDifference = Number(rightUsage?.favorite ?? false) - Number(leftUsage?.favorite ?? false);
    if (favoriteDifference !== 0) return favoriteDifference;
    const recencyDifference = (rightUsage?.lastUsedAt ?? "").localeCompare(leftUsage?.lastUsedAt ?? "");
    if (recencyDifference !== 0) return recencyDifference;
    const nameDifference = left.name.localeCompare(right.name);
    return nameDifference !== 0 ? nameDifference : left.path.localeCompare(right.path);
  });
  return { projects: projectsSorted, favoritePaths, recentPaths };
}

export function resolveProjectSelector(
  projects: readonly CodexProject[],
  selector: string,
): ProjectResolution {
  const query = selector.trim();
  if (!query) return { status: "missing" };
  if (/^\d+$/.test(query)) {
    const project = projects[Number.parseInt(query, 10) - 1];
    return project ? { status: "found", project } : { status: "missing" };
  }

  const normalized = query.toLocaleLowerCase();
  const exact = projects.filter(
    (project) =>
      project.name.toLocaleLowerCase() === normalized ||
      project.displayPath.toLocaleLowerCase() === normalized ||
      project.path.toLocaleLowerCase() === normalized,
  );
  if (exact.length === 1 && exact[0]) return { status: "found", project: exact[0] };
  if (exact.length > 1) return { status: "ambiguous", projects: exact };

  const fuzzy = projects.filter(
    (project) =>
      project.name.toLocaleLowerCase().includes(normalized) ||
      project.displayPath.toLocaleLowerCase().includes(normalized),
  );
  if (fuzzy.length === 1 && fuzzy[0]) return { status: "found", project: fuzzy[0] };
  if (fuzzy.length > 1) return { status: "ambiguous", projects: fuzzy };
  return { status: "missing" };
}

function compareUsage(left: ProjectUsageState, right: ProjectUsageState): number {
  return (right.lastUsedAt ?? "").localeCompare(left.lastUsedAt ?? "");
}
