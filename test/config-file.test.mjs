import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  mergeEnvContent,
  parseEnvEntries,
  writeManagedConfig,
} from "../scripts/config-file.mjs";

describe("managed installer configuration", () => {
  it("updates managed keys while preserving comments and unknown advanced settings", () => {
    const existing = [
      "# Existing deployment",
      "CODEX_WORKDIR=/old/project",
      "CUSTOM_DEPLOYMENT_FLAG=keep-me",
      "CODEX_NETWORK_ACCESS=true",
      "",
    ].join("\n");
    const generated = [
      "# Generated",
      'CODEX_WORKDIR="/new project"',
      "CODEX_NETWORK_ACCESS=false",
      "FEISHU_AUTO_ONBOARDING=true",
      "",
    ].join("\n");
    const merged = mergeEnvContent(existing, generated);
    expect(merged).toContain("# Existing deployment");
    expect(merged).toContain("CUSTOM_DEPLOYMENT_FLAG=keep-me");
    expect(merged).toContain('CODEX_WORKDIR="/new project"');
    expect(merged).toContain("CODEX_NETWORK_ACCESS=false");
    expect(merged).toContain("FEISHU_AUTO_ONBOARDING=true");
    expect(parseEnvEntries(merged).CODEX_WORKDIR).toBe("/new project");
  });

  it("atomically writes a private config and creates a private backup", async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), "bridge-config-test-"));
    const config = path.join(sandbox, "private", "default.env");
    try {
      const first = await writeManagedConfig(config, "ALLOWED_FEISHU_OPEN_IDS=ou_first\n");
      expect(first.created).toBe(true);
      expect((await stat(config)).mode & 0o777).toBe(0o600);
      expect((await stat(path.dirname(config))).mode & 0o777).toBe(0o700);

      await writeFile(
        config,
        "ALLOWED_FEISHU_OPEN_IDS=ou_first\nCUSTOM_DEPLOYMENT_FLAG=keep\n",
        { mode: 0o600 },
      );
      const second = await writeManagedConfig(
        config,
        "ALLOWED_FEISHU_OPEN_IDS=ou_second\nCODEX_NETWORK_ACCESS=false\n",
        { now: new Date("2026-07-16T00:00:00.000Z") },
      );
      expect(second.created).toBe(false);
      expect(second.backupFile).toBe(`${config}.bak.2026-07-16T00-00-00-000Z`);
      expect((await stat(second.backupFile)).mode & 0o777).toBe(0o600);
      const updated = await readFile(config, "utf8");
      const backup = await readFile(second.backupFile, "utf8");
      expect(updated).toContain("ALLOWED_FEISHU_OPEN_IDS=ou_second");
      expect(updated).toContain("CUSTOM_DEPLOYMENT_FLAG=keep");
      expect(backup).toContain("ALLOWED_FEISHU_OPEN_IDS=ou_first");
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});
