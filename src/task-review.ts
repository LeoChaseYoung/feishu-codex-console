import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readlink } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";

import type { TaskProgress } from "./progress.js";
import { redactSensitiveText } from "./redaction.js";

const MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_REVIEW_FILES = 80;
const MAX_UNTRACKED_PREVIEW_BYTES = 256 * 1024;
const MAX_DIFF_CHARS = 500_000;

export interface ReviewBaselineFile {
  path: string;
  fingerprint: string | null;
}

export interface TaskReviewBaseline {
  capturedAt: string;
  available: boolean;
  dirty: boolean;
  branch?: string;
  head?: string;
  files: ReviewBaselineFile[];
  truncated?: boolean;
  error?: string;
}

export type ReviewFileAttribution = "task" | "mixed";

export interface TaskReviewFile {
  path: string;
  kind: "add" | "update" | "delete";
  additions: number | null;
  deletions: number | null;
  binary: boolean;
  sensitive: boolean;
  attribution: ReviewFileAttribution;
  fingerprint: string | null;
}

export interface TaskReviewSnapshot {
  capturedAt: string;
  availability: "ready" | "no_changes" | "unavailable";
  attribution: "task" | "mixed" | "unknown";
  branch?: string;
  baseHead?: string;
  files: TaskReviewFile[];
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  binaryFiles: number;
  preexistingFilesExcluded: number;
  truncated: boolean;
  error?: string;
}

export interface TaskFileDiff {
  path: string;
  content: string;
  stale: boolean;
  sensitive: boolean;
  truncated: boolean;
  capturedAt: string;
  error?: string;
}

interface GitFileState {
  path: string;
  kind: TaskReviewFile["kind"];
  additions: number | null;
  deletions: number | null;
  binary: boolean;
  fingerprint: string | null;
}

export async function captureTaskReviewBaseline(
  projectPath: string,
  isGitRepository: boolean,
): Promise<TaskReviewBaseline> {
  const capturedAt = new Date().toISOString();
  if (!isGitRepository) {
    return {
      capturedAt,
      available: false,
      dirty: false,
      files: [],
      truncated: false,
      error: "当前项目不是 Git 仓库，无法建立可归因的代码基线。",
    };
  }

  try {
    const [branch, head, states] = await Promise.all([
      runGit(projectPath, ["branch", "--show-current"]).catch(() => ""),
      runGit(projectPath, ["rev-parse", "HEAD"]).catch(() => ""),
      readGitWorkspaceState(projectPath, "HEAD"),
    ]);
    const files = await Promise.all(
      [...states.values()].slice(0, 200).map(async (file) => ({
        path: file.path,
        fingerprint: await fileFingerprint(projectPath, file.path),
      })),
    );
    return {
      capturedAt,
      available: true,
      dirty: states.size > 0,
      ...(branch.trim() ? { branch: branch.trim() } : {}),
      ...(head.trim() ? { head: head.trim() } : {}),
      files,
      truncated: states.size > files.length,
    };
  } catch (error) {
    return {
      capturedAt,
      available: false,
      dirty: false,
      files: [],
      truncated: false,
      error: reviewError(error),
    };
  }
}

export async function captureTaskReview(
  projectPath: string,
  baseline: TaskReviewBaseline | undefined,
  observedChanges: TaskProgress["changedFiles"] = [],
): Promise<TaskReviewSnapshot> {
  const capturedAt = new Date().toISOString();
  if (!baseline?.available) {
    const files = await observedReviewFiles(projectPath, observedChanges, "mixed");
    return {
      capturedAt,
      availability: files.length > 0 ? "ready" : "unavailable",
      attribution: "unknown",
      files,
      totalFiles: files.length,
      totalAdditions: sumKnown(files, "additions"),
      totalDeletions: sumKnown(files, "deletions"),
      binaryFiles: files.filter((file) => file.binary).length,
      preexistingFilesExcluded: 0,
      truncated: false,
      error: baseline?.error ?? "任务开始时没有可用的 Git 基线。",
    };
  }

  try {
    const baseRef = baseline.head || "HEAD";
    const states = await readGitWorkspaceState(projectPath, baseRef);
    const observed = new Map(
      observedChanges
        .map((change) => [normalizeObservedPath(projectPath, change.path), change] as const)
        .filter(([path]) => Boolean(path)),
    );
    for (const [path, change] of observed) {
      if (!path || states.has(path)) continue;
      states.set(path, {
        path,
        kind: change.kind,
        additions: null,
        deletions: null,
        binary: false,
        fingerprint: await fileFingerprint(projectPath, path),
      });
    }

    const baselineFiles = new Map(baseline.files.map((file) => [file.path, file]));
    let preexistingFilesExcluded = 0;
    const reviewFiles: TaskReviewFile[] = [];
    for (const state of states.values()) {
      const before = baselineFiles.get(state.path);
      const wasObserved = observed.has(state.path);
      if (before && before.fingerprint === state.fingerprint && !wasObserved) {
        preexistingFilesExcluded += 1;
        continue;
      }
      reviewFiles.push({
        ...state,
        sensitive: isSensitiveReviewPath(state.path),
        attribution: before ? "mixed" : "task",
      });
    }

    reviewFiles.sort((left, right) => left.path.localeCompare(right.path));
    const totalFiles = reviewFiles.length;
    const visibleFiles = reviewFiles.slice(0, MAX_REVIEW_FILES);
    const hasMixedFiles =
      baseline.truncated === true || reviewFiles.some((file) => file.attribution === "mixed");
    return {
      capturedAt,
      availability: totalFiles > 0 ? "ready" : "no_changes",
      attribution: hasMixedFiles ? "mixed" : "task",
      ...(baseline.branch ? { branch: baseline.branch } : {}),
      ...(baseline.head ? { baseHead: baseline.head } : {}),
      files: visibleFiles,
      totalFiles,
      totalAdditions: sumKnown(reviewFiles, "additions"),
      totalDeletions: sumKnown(reviewFiles, "deletions"),
      binaryFiles: reviewFiles.filter((file) => file.binary).length,
      preexistingFilesExcluded,
      truncated: totalFiles > visibleFiles.length,
    };
  } catch (error) {
    const files = await observedReviewFiles(projectPath, observedChanges, "mixed");
    return {
      capturedAt,
      availability: files.length > 0 ? "ready" : "unavailable",
      attribution: "unknown",
      files,
      totalFiles: files.length,
      totalAdditions: sumKnown(files, "additions"),
      totalDeletions: sumKnown(files, "deletions"),
      binaryFiles: files.filter((file) => file.binary).length,
      preexistingFilesExcluded: 0,
      truncated: false,
      error: reviewError(error),
    };
  }
}

export async function readTaskFileDiff(
  projectPath: string,
  baseline: TaskReviewBaseline | undefined,
  file: TaskReviewFile,
): Promise<TaskFileDiff> {
  const capturedAt = new Date().toISOString();
  const stale = (await fileFingerprint(projectPath, file.path)) !== file.fingerprint;
  if (file.sensitive) {
    return {
      path: file.path,
      content: "该路径可能包含凭据或秘密，飞书端不展示内容。请回到可信本机审阅。",
      stale,
      sensitive: true,
      truncated: false,
      capturedAt,
    };
  }
  if (!baseline?.available) {
    return {
      path: file.path,
      content: "缺少任务开始时的 Git 基线，无法生成可信 Diff。",
      stale,
      sensitive: false,
      truncated: false,
      capturedAt,
      error: "baseline unavailable",
    };
  }

  try {
    let raw = "";
    if (file.kind === "add" && !(await isTracked(projectPath, file.path))) {
      raw = await untrackedFilePreview(projectPath, file.path);
    } else {
      raw = await runGit(projectPath, [
        "diff",
        "--relative",
        "--no-ext-diff",
        "--no-color",
        "--unified=3",
        baseline.head || "HEAD",
        "--",
        file.path,
      ]);
    }
    const redacted = redactReviewText(raw || "当前文件没有可展示的文本差异。");
    const truncated = redacted.length > MAX_DIFF_CHARS;
    return {
      path: file.path,
      content: truncated ? `${redacted.slice(0, MAX_DIFF_CHARS)}\n\n[Diff 已截断]` : redacted,
      stale,
      sensitive: false,
      truncated,
      capturedAt,
    };
  } catch (error) {
    return {
      path: file.path,
      content: "暂时无法读取这个文件的 Diff，请回到本机查看。",
      stale,
      sensitive: false,
      truncated: false,
      capturedAt,
      error: reviewError(error),
    };
  }
}

export function isTestCommand(command: string): boolean {
  const normalized = command.trim().toLocaleLowerCase();
  return [
    /(?:^|\s)(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?:\s|$|:)/,
    /(?:^|\s)(?:vitest|jest|pytest|rspec)(?:\s|$)/,
    /(?:^|\s)go\s+test(?:\s|$)/,
    /(?:^|\s)cargo\s+test(?:\s|$)/,
    /(?:^|\s)dotnet\s+test(?:\s|$)/,
    /(?:^|\s)(?:mvn|mvnw)(?:\s+[^;&|]+)?\s+test(?:\s|$)/,
    /(?:^|\s)(?:gradle|gradlew)(?:\s+[^;&|]+)?\s+test(?:\s|$)/,
    /(?:^|\s)swift\s+test(?:\s|$)/,
  ].some((pattern) => pattern.test(normalized));
}

export function summarizeCommandOutput(output: string, maxChars = 1_200): string {
  const clean = redactReviewText(
    output
      .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .slice(-12)
      .join("\n"),
  );
  if (clean.length <= maxChars) return clean;
  return `…${clean.slice(clean.length - maxChars + 1)}`;
}

export function redactReviewText(value: string): string {
  return redactSensitiveText(value);
}

export function isSensitiveReviewPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLocaleLowerCase();
  const name = basename(normalized);
  return (
    name === ".env" ||
    name.startsWith(".env.") ||
    [".npmrc", ".netrc", "credentials", "id_rsa", "id_ed25519"].includes(name) ||
    /\.(?:pem|key|p12|pfx|jks|keystore)$/.test(name) ||
    /(?:^|\/)\.ssh\//.test(normalized) ||
    /(?:^|\/)(?:secret|secrets|credentials)(?:\/|\.|$)/.test(normalized)
  );
}

async function readGitWorkspaceState(
  projectPath: string,
  baseRef: string,
): Promise<Map<string, GitFileState>> {
  const [namesOutput, numstatOutput, untrackedOutput] = await Promise.all([
    runGit(projectPath, [
      "diff",
      "--relative",
      "--no-ext-diff",
      "--no-renames",
      "--name-status",
      "-z",
      baseRef,
      "--",
      ".",
    ]),
    runGit(projectPath, [
      "diff",
      "--relative",
      "--no-ext-diff",
      "--no-renames",
      "--numstat",
      "-z",
      baseRef,
      "--",
      ".",
    ]),
    runGit(projectPath, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."]),
  ]);

  const stats = parseNumstat(numstatOutput);
  const states = new Map<string, GitFileState>();
  const nameParts = namesOutput.split("\0").filter(Boolean);
  for (let index = 0; index + 1 < nameParts.length; index += 2) {
    const status = nameParts[index] ?? "M";
    const path = normalizeGitPath(nameParts[index + 1] ?? "");
    if (!path) continue;
    const numbers = stats.get(path);
    states.set(path, {
      path,
      kind: status.startsWith("A") ? "add" : status.startsWith("D") ? "delete" : "update",
      additions: numbers?.additions ?? null,
      deletions: numbers?.deletions ?? null,
      binary: numbers?.binary ?? false,
      fingerprint: await fileFingerprint(projectPath, path),
    });
  }

  for (const rawPath of untrackedOutput.split("\0").filter(Boolean)) {
    const path = normalizeGitPath(rawPath);
    if (!path || states.has(path)) continue;
    const stats = await untrackedStats(projectPath, path);
    states.set(path, {
      path,
      kind: "add",
      additions: stats.additions,
      deletions: 0,
      binary: stats.binary,
      fingerprint: await fileFingerprint(projectPath, path),
    });
  }
  return states;
}

function parseNumstat(output: string): Map<string, { additions: number | null; deletions: number | null; binary: boolean }> {
  const result = new Map<string, { additions: number | null; deletions: number | null; binary: boolean }>();
  for (const entry of output.split("\0").filter(Boolean)) {
    const [added = "-", deleted = "-", ...pathParts] = entry.split("\t");
    const path = normalizeGitPath(pathParts.join("\t"));
    if (!path) continue;
    const binary = added === "-" || deleted === "-";
    result.set(path, {
      additions: binary ? null : Number.parseInt(added, 10),
      deletions: binary ? null : Number.parseInt(deleted, 10),
      binary,
    });
  }
  return result;
}

async function observedReviewFiles(
  projectPath: string,
  changes: TaskProgress["changedFiles"],
  attribution: ReviewFileAttribution,
): Promise<TaskReviewFile[]> {
  const result: TaskReviewFile[] = [];
  for (const change of changes.slice(0, MAX_REVIEW_FILES)) {
    const path = normalizeObservedPath(projectPath, change.path);
    if (!path) continue;
    result.push({
      path,
      kind: change.kind,
      additions: null,
      deletions: null,
      binary: false,
      sensitive: isSensitiveReviewPath(path),
      attribution,
      fingerprint: await fileFingerprint(projectPath, path),
    });
  }
  return result;
}

async function untrackedStats(
  projectPath: string,
  path: string,
): Promise<{ additions: number | null; binary: boolean }> {
  const localPath = safeLocalPath(projectPath, path);
  if (!localPath) return { additions: null, binary: false };
  try {
    const details = await lstat(localPath);
    if (!details.isFile() || details.size > MAX_UNTRACKED_PREVIEW_BYTES) {
      return { additions: null, binary: details.isFile() && details.size > 0 };
    }
    const content = await readFile(localPath);
    if (content.includes(0)) return { additions: null, binary: true };
    const text = content.toString("utf8");
    return { additions: text ? text.split(/\r?\n/).length : 0, binary: false };
  } catch {
    return { additions: null, binary: false };
  }
}

async function untrackedFilePreview(projectPath: string, path: string): Promise<string> {
  const localPath = safeLocalPath(projectPath, path);
  if (!localPath) throw new Error("unsafe review path");
  const details = await lstat(localPath);
  if (!details.isFile()) return "该路径不是普通文件，无法生成文本 Diff。";
  if (details.size > MAX_UNTRACKED_PREVIEW_BYTES) {
    return `新增文件大小为 ${details.size} 字节，超过飞书预览上限。`;
  }
  const content = await readFile(localPath);
  if (content.includes(0)) return "新增文件是二进制内容，飞书端不展示正文。";
  const lines = content.toString("utf8").split(/\r?\n/);
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join("\n");
}

async function isTracked(projectPath: string, path: string): Promise<boolean> {
  try {
    await runGit(projectPath, ["ls-files", "--error-unmatch", "--", path]);
    return true;
  } catch {
    return false;
  }
}

async function fileFingerprint(projectPath: string, path: string): Promise<string | null> {
  const localPath = safeLocalPath(projectPath, path);
  if (!localPath) return null;
  try {
    const details = await lstat(localPath);
    if (details.isSymbolicLink()) {
      return `link:${await readlink(localPath)}`;
    }
    if (details.isFile()) {
      const digest = await hashFile(localPath);
      return `file:${details.size}:${details.mode & 0o777}:${digest}`;
    }
    return `other:${details.mode}:${details.size}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "deleted";
    return null;
  }
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolvePromise(`sha256:${hash.digest("hex")}`));
  });
}

function normalizeObservedPath(projectPath: string, path: string): string {
  const absolute = resolve(projectPath, path);
  const root = resolve(projectPath);
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) return "";
  return normalizeGitPath(relative(root, absolute));
}

function normalizeGitPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").trim();
}

function safeLocalPath(projectPath: string, path: string): string | null {
  const root = resolve(projectPath);
  const localPath = resolve(root, path);
  return localPath === root || localPath.startsWith(`${root}${sep}`) ? localPath : null;
}

function sumKnown(files: TaskReviewFile[], key: "additions" | "deletions"): number {
  return files.reduce((total, file) => total + (file[key] ?? 0), 0);
}

function reviewError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactReviewText(message).slice(0, 500);
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let overflow = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_GIT_OUTPUT_BYTES) {
        overflow = true;
        child.kill("SIGKILL");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (overflow) {
        reject(new Error("Git review output exceeded the safe local limit"));
        return;
      }
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `git exited ${code}`));
        return;
      }
      resolvePromise(Buffer.concat(stdout).toString("utf8"));
    });
  });
}
