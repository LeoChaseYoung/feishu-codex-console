import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  initializeRunbookTemplate,
  RUNBOOK_TEMPLATE_NAME,
} from "../scripts/runbook-template.mjs";

describe("runbook template initialization", () => {
  it("creates once and never overwrites a team-owned catalog", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "runbook-template-"));
    try {
      const source = path.join(root, "sample.json");
      const project = path.join(root, "project");
      await import("node:fs/promises").then(({ mkdir }) => mkdir(project));
      await writeFile(source, '{"version":1,"runbooks":[]}\n');

      const first = await initializeRunbookTemplate({ projectDir: project, sourceFile: source });
      expect(first).toEqual({ created: true, target: path.join(project, RUNBOOK_TEMPLATE_NAME) });
      await writeFile(first.target, '{"team":"kept"}\n');

      const second = await initializeRunbookTemplate({ projectDir: project, sourceFile: source });
      expect(second.created).toBe(false);
      expect(await readFile(first.target, "utf8")).toBe('{"team":"kept"}\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
