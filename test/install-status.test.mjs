import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { inspectInstallStatus } from "../scripts/install-status.mjs";
import { recordInstallError, recordInstallStep } from "../scripts/install-state.mjs";
import { serviceHealthPath } from "../scripts/service-health.mjs";

describe("machine-readable install status", () => {
  it("directs a clean host to the existing init command", async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), "bridge-install-status-empty-"));
    try {
      const report = await inspectInstallStatus({
        configFile: path.join(sandbox, "missing.env"),
        platform: "win32",
        homeDir: sandbox,
      });

      expect(report).toMatchObject({
        contractVersion: 1,
        phase: "not_started",
        ready: false,
        nextAction: { code: "run_init", requiresUserAction: false },
      });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("reports a healthy service and separates Feishu verification", async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), "bridge-install-status-ready-"));
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
      await writeFile(
        configFile,
        `BRIDGE_INSTANCE_ID=team\nBRIDGE_DATA_DIR=${dataDir}\n`,
      );
      await writeFile(serviceDefinition, "plist");
      await writeFile(
        serviceHealthPath(dataDir),
        JSON.stringify({
          version: 1,
          status: "ready",
          instanceId: "team",
          pid: 123,
          updatedAt: new Date().toISOString(),
          configFile,
          consumers: [
            { eventKey: "im.message.receive_v1", ready: true },
            { eventKey: "card.action.trigger", ready: true },
          ],
        }),
      );
      await recordInstallStep(configFile, null, "service_running");

      const awaitingFeishu = await inspectInstallStatus({
        configFile,
        platform: "darwin",
        homeDir: sandbox,
        uid: 501,
        run: () => ({ status: 0 }),
        processAlive: () => true,
      });
      expect(awaitingFeishu).toMatchObject({
        ready: true,
        testCardDelivered: false,
        health: { valid: true, readyConsumers: 2, totalConsumers: 2 },
        nextAction: { code: "verify_feishu", requiresUserAction: true },
      });

      let completed = await recordInstallStep(configFile, null, "service_running");
      completed = await recordInstallStep(configFile, completed, "test_card_delivered");
      await recordInstallStep(configFile, completed, "completed");
      const verified = await inspectInstallStatus({
        configFile,
        platform: "darwin",
        homeDir: sandbox,
        uid: 501,
        run: () => ({ status: 0 }),
        processAlive: () => true,
      });
      expect(verified).toMatchObject({
        phase: "completed",
        ready: true,
        testCardDelivered: true,
        nextAction: { code: "ready", requiresUserAction: false },
      });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("does not expose the recorded error text", async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), "bridge-install-status-error-"));
    const configFile = path.join(sandbox, "config", "default.env");
    try {
      await recordInstallError(configFile, null, "Bearer secret-install-token");
      const report = await inspectInstallStatus({
        configFile,
        platform: "win32",
        homeDir: sandbox,
      });

      expect(report.hasRecordedError).toBe(true);
      expect(JSON.stringify(report)).not.toContain("secret-install-token");
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});
