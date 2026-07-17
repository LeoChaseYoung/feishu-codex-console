import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ProjectGitStatus {
  branch: string;
  detached: boolean;
  dirty: boolean;
  changedFiles: number;
  ahead: number;
  behind: number;
}

export async function readProjectGitStatus(
  projectPath: string,
  run: typeof runGitStatus = runGitStatus,
): Promise<ProjectGitStatus | null> {
  try {
    return parseGitStatus(await run(projectPath));
  } catch {
    return null;
  }
}

export function parseGitStatus(output: string): ProjectGitStatus {
  const lines = output.split(/\r?\n/).filter(Boolean);
  const header = lines[0]?.startsWith("## ") ? lines[0].slice(3) : "HEAD (unknown)";
  const branchPart = (header.split("...")[0] ?? header).trim();
  const branch = branchPart.replace(/^No commits yet on\s+/i, "").trim() || "HEAD";
  const detached = /^HEAD(?:\s|$|\()/i.test(branch);
  const ahead = numberFrom(header, /ahead\s+(\d+)/i);
  const behind = numberFrom(header, /behind\s+(\d+)/i);
  const changedFiles = lines[0]?.startsWith("## ") ? Math.max(0, lines.length - 1) : lines.length;
  return {
    branch,
    detached,
    dirty: changedFiles > 0,
    changedFiles,
    ahead,
    behind,
  };
}

async function runGitStatus(projectPath: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", projectPath, "status", "--short", "--branch", "--untracked-files=normal"],
    {
      timeout: 3_000,
      maxBuffer: 512 * 1024,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
      },
    },
  );
  return stdout;
}

function numberFrom(value: string, pattern: RegExp): number {
  const match = value.match(pattern);
  return match?.[1] ? Number.parseInt(match[1], 10) : 0;
}
