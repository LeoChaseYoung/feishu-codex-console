import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  captureTaskReview,
  captureTaskReviewBaseline,
  isSensitiveReviewPath,
  isTestCommand,
  readTaskFileDiff,
  redactReviewText,
  summarizeCommandOutput,
} from "../src/task-review.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function repository(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "feishu-codex-review-"));
  await git(directory, "init", "-q");
  await git(directory, "config", "user.email", "review@example.com");
  await git(directory, "config", "user.name", "Review Test");
  await mkdir(path.join(directory, "src"));
  await writeFile(path.join(directory, "src", "index.ts"), "export const value = 1;\n");
  await git(directory, "add", ".");
  await git(directory, "commit", "-qm", "initial");
  return directory;
}

describe("task review", () => {
  it("attributes changes from a clean baseline and renders a bounded file diff", async () => {
    const directory = await repository();
    const baseline = await captureTaskReviewBaseline(directory, true);
    await writeFile(path.join(directory, "src", "index.ts"), "export const value = 2;\n");
    await writeFile(path.join(directory, "src", "new.ts"), "export const added = true;\n");

    const review = await captureTaskReview(directory, baseline, [
      { path: "src/index.ts", kind: "update" },
      { path: "src/new.ts", kind: "add" },
    ]);
    expect(review.availability).toBe("ready");
    expect(review.attribution).toBe("task");
    expect(review.totalFiles).toBe(2);
    expect(review.totalAdditions).toBeGreaterThan(0);

    const file = review.files.find((candidate) => candidate.path === "src/index.ts");
    expect(file).toBeDefined();
    const diff = await readTaskFileDiff(directory, baseline, file!);
    expect(diff.content).toContain("-export const value = 1");
    expect(diff.content).toContain("+export const value = 2");
    expect(diff.stale).toBe(false);
  });

  it("excludes untouched pre-existing dirt and marks an edited dirty file mixed", async () => {
    const directory = await repository();
    await writeFile(path.join(directory, "src", "index.ts"), "export const value = 2;\n");
    await writeFile(path.join(directory, "preexisting.txt"), "before\n");
    const baseline = await captureTaskReviewBaseline(directory, true);

    const touchedAt = new Date(Date.now() + 60_000);
    await utimes(path.join(directory, "preexisting.txt"), touchedAt, touchedAt);
    await writeFile(path.join(directory, "src", "index.ts"), "export const value = 3;\n");
    const review = await captureTaskReview(directory, baseline, [
      { path: "src/index.ts", kind: "update" },
    ]);
    const includedPreexisting = review.files.find((file) => file.path === "preexisting.txt");
    if (includedPreexisting) {
      console.log("task-review attribution diagnostics", {
        baselineFile: baseline.files.find((file) => file.path === "preexisting.txt"),
        currentFile: includedPreexisting,
        baselineFiles: baseline.files.map((file) => file.path),
      });
    }
    expect(review.attribution).toBe("mixed");
    expect(review.files.map((file) => file.path)).toEqual(["src/index.ts"]);
    expect(review.preexistingFilesExcluded).toBe(1);
  });

  it("detects test commands and redacts likely secrets", () => {
    expect(isTestCommand("npm test -- --runInBand")).toBe(true);
    expect(isTestCommand("python -m pytest tests")).toBe(true);
    expect(isTestCommand("npm run build")).toBe(false);
    expect(isSensitiveReviewPath("config/.env.production")).toBe(true);
    expect(isSensitiveReviewPath("src/index.ts")).toBe(false);
    expect(redactReviewText("API_KEY=abc123 password: hunter2")).toBe(
      "API_KEY=[REDACTED] password: [REDACTED]",
    );
    expect(summarizeCommandOutput("ok\naccess_token=secret-value")).toContain(
      "access_token=[REDACTED]",
    );
  });
});
