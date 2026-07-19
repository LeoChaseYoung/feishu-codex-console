import { DatabaseSync } from "node:sqlite";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { BridgeConfig } from "../src/config.js";
import { createDiagnosticBundle, repairRuntime } from "../src/diagnostics.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{ config: BridgeConfig; root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "feishu-codex-diagnostics-"));
  temporaryDirectories.push(root);
  const dataDir = path.join(root, "data");
  const workdir = path.join(root, "project");
  const configFile = path.join(root, ".env");
  await mkdir(path.join(dataDir, "log"), { recursive: true, mode: 0o755 });
  await mkdir(workdir, { recursive: true });
  await writeFile(configFile, "ALLOWED_FEISHU_OPEN_IDS=ou_operator\n", { mode: 0o644 });
  const config: BridgeConfig = {
    configFile,
    projectDir: root,
    workdir,
    projectRoots: [workdir],
    projectScanDepth: 4,
    maxProjects: 20,
    syncSavedProjects: false,
    codexProjectStateFile: path.join(root, "codex-state.json"),
    databaseFile: path.join(dataDir, "state.sqlite"),
    stateFile: path.join(dataDir, "state.json"),
    dataDir,
    instanceId: "diagnostic-test",
    serviceLabel: "com.feishu-codex-bridge.diagnostic-test",
    larkCliPath: "lark-cli",
    allowedSenderIds: new Set(["ou_operator"]),
    adminSenderIds: new Set(["ou_admin"]),
    viewerSenderIds: new Set(["ou_viewer"]),
    allowedChatIds: new Set(["oc_chat"]),
    groupSessionScope: "member",
    projectAcl: new Map([[workdir, new Set(["ou_operator"])]]),
    botMentionNames: [],
    sandboxMode: "danger-full-access",
    operatorSandboxMode: "workspace-write",
    skipGitRepoCheck: false,
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    maxReplyChars: 12_000,
    codexTimeoutMs: 60_000,
    maxSeenEvents: 2_000,
    maxConcurrentTasks: 2,
    maxQueuedPerConversation: 5,
    maxAttachmentBytes: 20 * 1024 * 1024,
    maxTextAttachmentBytes: 128 * 1024,
    attachmentRetentionHours: 72,
    confirmationTtlMinutes: 10,
    maxLogBytes: 1024 * 1024,
    codexAllowedEnvVars: [],
    logMessageContent: false,
    completionNotifications: true,
    autoOnboarding: true,
  };
  return { config, root };
}

function createStateDatabase(file: string): void {
  const database = new DatabaseSync(file);
  database.exec("CREATE TABLE bridge_state (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)");
  database.prepare("INSERT INTO bridge_state (id, payload) VALUES (1, ?)").run(
    JSON.stringify({
      version: 6,
      tasks: {
        a: { status: "running" },
        b: { status: "succeeded" },
        c: { status: "succeeded" },
      },
    }),
  );
  database.close();
}

describe("doctor diagnostics", () => {
  it("repairs private permissions and removes a stale health marker", async () => {
    const { config } = await fixture();
    createStateDatabase(config.databaseFile);
    await chmod(config.dataDir, 0o755);
    await chmod(path.join(config.dataDir, "log"), 0o755);
    await chmod(config.databaseFile, 0o644);
    await writeFile(
      path.join(config.dataDir, "bridge-health.json"),
      `${JSON.stringify({
        version: 1,
        status: "failed",
        instanceId: config.instanceId,
        pid: 999_999,
        startedAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        configFile: null,
        consumers: [],
      })}\n`,
      { mode: 0o644 },
    );

    const result = await repairRuntime(config);

    expect((await stat(config.dataDir)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(config.dataDir, "log"))).mode & 0o777).toBe(0o700);
    expect((await stat(config.databaseFile)).mode & 0o777).toBe(0o600);
    expect((await stat(config.configFile!)).mode & 0o777).toBe(0o600);
    await expect(stat(path.join(config.dataDir, "bridge-health.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(result.changed.join(" ")).toContain("失效的服务健康标记");
  });

  it("writes a private, redacted support bundle with health and database summaries", async () => {
    const { config, root } = await fixture();
    createStateDatabase(config.databaseFile);
    await writeFile(
      path.join(config.dataDir, "log", "bridge.error.log"),
      "request failed API_KEY=super-secret-value\n",
      { mode: 0o600 },
    );
    const output = path.join(root, "support", "diagnostic.json");

    const created = await createDiagnosticBundle(config, [
      { label: "测试", status: "warning", detail: "Bearer abcdefghijklmnop" },
    ], output);
    const serialized = await readFile(created, "utf8");
    const report = JSON.parse(serialized) as Record<string, unknown>;

    expect(created).toBe(output);
    expect((await stat(created)).mode & 0o777).toBe(0o600);
    expect(serialized).not.toContain("super-secret-value");
    expect(serialized).not.toContain("abcdefghijklmnop");
    expect(serialized).toContain("REDACTED");
    expect(report).toMatchObject({
      version: 1,
      product: "feishu-codex-console",
      database: {
        integrity: "ok",
        stateVersion: 6,
        taskStatuses: { running: 1, succeeded: 2 },
      },
    });
    await expect(createDiagnosticBundle(config, [], output)).rejects.toThrow("已存在");
  });
});
