import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseEnvEntries } from "../scripts/config-file.mjs";
import { migrateLegacyInstallation } from "../scripts/migrate-legacy.mjs";

describe("legacy source installation migration", () => {
  it("copies config safely, keeps unknown settings, and reuses legacy data", async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), "legacy-migration-"));
    const sourceDir = path.join(sandbox, "old-source");
    const workdir = path.join(sourceDir, "work");
    const home = path.join(sandbox, "home");
    try {
      await mkdir(workdir, { recursive: true });
      await writeFile(
        path.join(sourceDir, ".env"),
        [
          "# keep this comment",
          "ALLOWED_FEISHU_OPEN_IDS=ou_owner",
          "CODEX_WORKDIR=./work",
          "CODEX_PROJECT_ROOTS=./work,../shared",
          "BRIDGE_DATA_DIR=",
          "BRIDGE_STATE_FILE=./var/state.json",
          "CUSTOM_TEAM_SETTING=kept",
          "",
        ].join("\n"),
      );

      const result = await migrateLegacyInstallation({ sourceDir, home, instance: "Team West" });
      const content = await readFile(result.targetConfig, "utf8");
      const entries = parseEnvEntries(content);
      expect(result.instanceId).toBe("team-west");
      expect(entries.BRIDGE_DATA_DIR).toBe(path.join(sourceDir, "var"));
      expect(entries.CODEX_WORKDIR).toBe(workdir);
      expect(entries.CODEX_PROJECT_ROOTS).toBe(
        [workdir, path.join(sandbox, "shared")].join(","),
      );
      expect(entries.BRIDGE_STATE_FILE).toBe(path.join(sourceDir, "var", "state.json"));
      expect(entries.CUSTOM_TEAM_SETTING).toBe("kept");
      expect(content).toContain("# keep this comment");
      expect((await stat(result.targetConfig)).mode & 0o777).toBe(0o600);
      expect(await stat(path.join(sourceDir, ".env"))).toBeDefined();
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an existing target unless merge is explicit", async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), "legacy-migration-existing-"));
    const sourceDir = path.join(sandbox, "source");
    const target = path.join(sandbox, "config", "default.env");
    try {
      await mkdir(sourceDir, { recursive: true });
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(
        path.join(sourceDir, ".env"),
        "ALLOWED_FEISHU_OPEN_IDS=ou_legacy\nCODEX_WORKDIR=.\n",
      );
      await writeFile(target, "ALLOWED_FEISHU_OPEN_IDS=ou_current\nTARGET_ONLY=kept\n");

      await expect(
        migrateLegacyInstallation({ sourceDir, targetConfig: target }),
      ).rejects.toThrow(/--force/);

      const result = await migrateLegacyInstallation({
        sourceDir,
        targetConfig: target,
        allowExisting: true,
        now: new Date("2026-07-16T12:00:00.000Z"),
      });
      const entries = parseEnvEntries(await readFile(target, "utf8"));
      expect(entries.ALLOWED_FEISHU_OPEN_IDS).toBe("ou_legacy");
      expect(entries.TARGET_ONLY).toBe("kept");
      expect(result.backupFile).toContain(".bak.2026-07-16T12-00-00-000Z");
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});
