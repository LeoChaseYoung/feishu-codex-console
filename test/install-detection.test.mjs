import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { detectExistingInstallation } from "../scripts/install-detection.mjs";
import { serviceHealthPath } from "../scripts/service-health.mjs";

describe("existing installation detection", () => {
  it("reports config, runtime data, health, and a running service", async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), "install-detection-"));
    const configFile = path.join(sandbox, "config", "team.env");
    const dataDir = path.join(sandbox, "data");
    const serviceDefinition = path.join(
      sandbox,
      "Library",
      "LaunchAgents",
      "com.feishu-codex-bridge.team.plist",
    );
    try {
      await mkdir(path.dirname(configFile), { recursive: true });
      await mkdir(dataDir, { recursive: true });
      await mkdir(path.dirname(serviceDefinition), { recursive: true });
      await writeFile(configFile, "BRIDGE_INSTANCE_ID=team\n");
      await writeFile(path.join(dataDir, "state.sqlite"), "state");
      await writeFile(serviceDefinition, "plist");
      await writeFile(
        serviceHealthPath(dataDir),
        JSON.stringify({
          version: 1,
          status: "ready",
          instanceId: "team",
          pid: 123,
          updatedAt: new Date().toISOString(),
        }),
      );

      const result = await detectExistingInstallation({
        configFile,
        dataDir,
        instanceId: "team",
        platform: "darwin",
        homeDir: sandbox,
        uid: 501,
        run: (command, args) => {
          expect(command).toBe("launchctl");
          expect(args).toEqual(["print", "gui/501/com.feishu-codex-bridge.team"]);
          return { status: 0 };
        },
      });

      expect(result).toMatchObject({
        exists: true,
        config: { exists: true, unsafe: false },
        data: { exists: true, unsafe: false, entryCount: 2 },
        health: { exists: true, status: "ready", pid: 123 },
        service: { manager: "launchd", installed: true, running: true },
      });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("returns an empty state on a clean unsupported host", async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), "install-detection-empty-"));
    try {
      const result = await detectExistingInstallation({
        configFile: path.join(sandbox, "missing.env"),
        dataDir: path.join(sandbox, "missing-data"),
        instanceId: "default",
        platform: "win32",
        homeDir: sandbox,
      });
      expect(result.exists).toBe(false);
      expect(result.service.manager).toBe("unsupported");
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});
