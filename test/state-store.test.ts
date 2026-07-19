import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { createTaskProgress } from "../src/progress.js";
import { StateStore } from "../src/state-store.js";

describe("StateStore", () => {
  it("persists state transactionally in SQLite", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "feishu-codex-state-"));
    const databaseFile = path.join(directory, "state.sqlite");
    const state = new StateStore(databaseFile, 2);
    await state.load();
    await state.setChatType("oc-1", "p2p");
    expect(await state.markEventIfNew("evt-1")).toBe(true);
    expect(await state.markEventIfNew("evt-1")).toBe(false);
    await state.markEventIfNew("evt-2");
    await state.markEventIfNew("evt-3");
    await state.setThread("oc-1", "thread-1");
    expect(await state.setProject("oc-1", "/repos/FastGPT")).toEqual({
      changed: true,
      threadReset: true,
    });
    await state.setThread("oc-1", "thread-2");
    await state.setRemoteReady(true);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(databaseFile)).mode & 0o777).toBe(0o600);
    expect((await stat(`${databaseFile}-wal`)).mode & 0o777).toBe(0o600);
    expect((await stat(`${databaseFile}-shm`)).mode & 0o777).toBe(0o600);
    state.close();

    const restored = new StateStore(databaseFile, 2);
    await restored.load();
    expect(restored.getThread("oc-1")).toBe("thread-2");
    expect(restored.getProject("oc-1")).toBe("/repos/FastGPT");
    expect(restored.getChatType("oc-1")).toBe("p2p");
    expect(restored.getRemoteReady()).toBe(true);
    expect(await restored.markEventIfNew("evt-1")).toBe(true);
    expect(readSqliteState(databaseFile)).toMatchObject({
      version: 6,
      tasks: {},
      projectCards: {},
      confirmations: {},
      device: { remoteReadyEnabled: true },
    });
    restored.close();
  });

  it("migrates V1 JSON without losing threads or seen events", async () => {
    const { databaseFile, legacyFile } = await migrationFiles("v1");
    await writeFile(
      legacyFile,
      JSON.stringify({
        version: 1,
        threads: { "oc-1": { threadId: "thread-1", updatedAt: "2026-07-15T00:00:00Z" } },
        seenEvents: [{ id: "evt-1", seenAt: "2026-07-15T00:00:00Z" }],
      }),
    );

    const state = new StateStore(databaseFile, 10, legacyFile);
    await state.load();

    expect(state.getThread("oc-1")).toBe("thread-1");
    expect(state.getProject("oc-1")).toBeUndefined();
    expect(await state.markEventIfNew("evt-1")).toBe(false);
    expect(readSqliteState(databaseFile)).toMatchObject({
      version: 6,
      projects: {},
      chats: {},
      tasks: {},
      projectCards: {},
      confirmations: {},
    });
    state.close();
  });

  it("migrates V2 JSON into the V5 recovery shape", async () => {
    const { databaseFile, legacyFile } = await migrationFiles("v2");
    await writeFile(
      legacyFile,
      JSON.stringify({
        version: 2,
        threads: { "oc-1": { threadId: "thread-1", updatedAt: "2026-07-15T00:00:00Z" } },
        projects: { "oc-1": { path: "/repos/bridge", updatedAt: "2026-07-15T00:00:00Z" } },
        seenEvents: [],
      }),
    );

    const state = new StateStore(databaseFile, 10, legacyFile);
    await state.load();

    expect(state.getThread("oc-1")).toBe("thread-1");
    expect(state.getProject("oc-1")).toBe("/repos/bridge");
    expect(readSqliteState(databaseFile)).toMatchObject({
      version: 6,
      tasks: {},
      projectCards: {},
      confirmations: {},
      chats: {},
    });
    state.close();
  });

  it("migrates V3 tasks without retaining inline attachment contents", async () => {
    const { databaseFile, legacyFile } = await migrationFiles("v3");
    await writeFile(
      legacyFile,
      JSON.stringify({
        version: 3,
        threads: {},
        projects: {},
        seenEvents: [],
        projectCards: {},
        tasks: {
          task1: {
            id: "task1",
            conversationKey: "oc-1",
            prompt: "read attachment",
            replyToMessageId: "om-1",
            seed: "evt-1",
            project: {
              path: "/repos/bridge",
              name: "bridge",
              displayPath: "bridge",
              isGitRepository: true,
              source: "scan",
            },
            status: "cancelled",
            progress: { taskId: "task1" },
            cardSequence: 0,
            attachments: [
              {
                kind: "text",
                path: "/tmp/private.txt",
                name: "private.txt",
                sizeBytes: 12,
                text: "do not persist me",
              },
            ],
            allowedExternalActions: [],
            createdAt: "2026-07-15T00:00:00Z",
            updatedAt: "2026-07-15T00:00:00Z",
          },
        },
      }),
    );

    const state = new StateStore(databaseFile, 10, legacyFile);
    await state.load();

    expect(JSON.stringify(readSqliteState(databaseFile))).not.toContain("do not persist me");
    expect(await readFile(legacyFile, "utf8")).not.toContain("do not persist me");
    expect(readSqliteState(databaseFile)).toMatchObject({ version: 6, confirmations: {} });
    expect(state.listTasks()[0]).toMatchObject({ ownerId: "legacy", controllerId: "legacy" });
    state.close();
  });

  it("repairs an early V4 JSON state", async () => {
    const { databaseFile, legacyFile } = await migrationFiles("v4");
    await writeFile(
      legacyFile,
      JSON.stringify({
        version: 4,
        threads: {},
        projects: {},
        seenEvents: [],
        tasks: {},
        projectCards: {},
        confirmations: {},
      }),
    );

    const state = new StateStore(databaseFile, 10, legacyFile);
    await state.load();
    expect(readSqliteState(databaseFile)).toMatchObject({
      version: 6,
      chats: {},
      confirmations: {},
      device: { remoteReadyEnabled: false },
    });
    state.close();
  });

  it("persists pending confirmations for restart recovery", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "feishu-codex-confirmation-"));
    const databaseFile = path.join(directory, "state.sqlite");
    const state = new StateStore(databaseFile, 10);
    await state.load();
    await state.upsertConfirmation({
      id: "confirm-1",
      seed: "evt-1",
      conversationKey: "oc-1",
      ownerId: "ou-1",
      prompt: "push the branch",
      project: {
        path: "/repos/bridge",
        name: "bridge",
        displayPath: "bridge",
        isGitRepository: true,
        source: "scan",
      },
      actions: ["push"],
      attachments: [],
      cardId: "card-1",
      messageId: "om-1",
      sequence: 0,
      createdAt: "2026-07-15T00:00:00Z",
      expiresAt: "2026-07-15T00:10:00Z",
    });
    state.close();

    const restored = new StateStore(databaseFile, 10);
    await restored.load();
    expect(restored.listConfirmations()).toHaveLength(1);
    await restored.removeConfirmation("confirm-1");
    expect(restored.listConfirmations()).toHaveLength(0);
    restored.close();
  });

  it("persists the lightweight fallback card reference for in-place recovery", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "feishu-codex-fallback-card-"));
    const databaseFile = path.join(directory, "state.sqlite");
    const state = new StateStore(databaseFile, 10);
    await state.load();
    await state.upsertTask({
      id: "task-1",
      conversationKey: "oc-1",
      ownerId: "ou-1",
      controllerId: "ou-1",
      prompt: "读取项目",
      replyToMessageId: "om-source",
      seed: "evt-1",
      project: {
        path: "/repos/bridge",
        name: "bridge",
        displayPath: "bridge",
        isGitRepository: true,
        source: "scan",
      },
      status: "queued",
      progress: createTaskProgress("task-1", "读取项目", 1, "bridge"),
      cardSequence: 0,
      fallbackCardId: "card-fallback",
      fallbackCardMessageId: "om-fallback",
      fallbackCardSequence: 3,
      attachments: [],
      allowedExternalActions: [],
      settings: { sandboxMode: "workspace-write" },
      createdAt: "2026-07-16T00:00:00Z",
      updatedAt: "2026-07-16T00:00:00Z",
    });
    state.close();

    const restored = new StateStore(databaseFile, 10);
    await restored.load();
    expect(restored.listTasks()[0]).toMatchObject({
      fallbackCardId: "card-fallback",
      fallbackCardMessageId: "om-fallback",
      fallbackCardSequence: 3,
    });
    restored.close();
  });

  it("persists per-conversation settings and team audit records", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "feishu-codex-team-state-"));
    const databaseFile = path.join(directory, "state.sqlite");
    const state = new StateStore(databaseFile, 10);
    await state.load();
    await state.setPreferences("oc-1::ou-1", {
      model: "gpt-5.4",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    });
    await state.appendAudit({
      occurredAt: "2026-07-16T00:00:00Z",
      actorId: "ou-1",
      action: "settings.model",
      resourceType: "settings",
      resourceId: "oc-1::ou-1",
      outcome: "allowed",
    });
    await state.registerThreadAccess(
      "thread-owned",
      "oc-1::ou-1",
      "ou-1",
      "/repos/bridge",
    );
    expect(state.getPreferences("oc-1::ou-1")).toMatchObject({
      model: "gpt-5.4",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    });
    expect(state.listAudit(10, "ou-1")).toMatchObject([
      { actorId: "ou-1", action: "settings.model", outcome: "allowed" },
    ]);
    expect(state.listOwnedThreadIds("ou-1", "/repos/bridge")).toEqual(
      new Set(["thread-owned"]),
    );
    expect(state.listOwnedThreadIds("ou-2", "/repos/bridge")).toEqual(new Set());
    state.close();
  });

  it("persists, consumes, expires, and session-binds full-access leases", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "feishu-codex-lease-"));
    const state = new StateStore(path.join(directory, "state.sqlite"), 10);
    await state.load();
    const now = Date.parse("2026-07-16T00:00:00Z");

    await state.setPermissionLease({
      conversationKey: "oc-1::ou-1",
      ownerId: "ou-1",
      projectPath: "/workspace/one",
      scope: "next-task",
      remainingUses: 1,
      expiresAt: "2026-07-16T00:30:00Z",
    });
    expect(state.getPermissionLease("oc-1::ou-1", "ou-1", now)?.scope).toBe("next-task");
    expect(
      state.consumePermissionLease(
        "oc-1::ou-1",
        "ou-1",
        "/workspace/one",
        undefined,
        now,
      )?.scope,
    ).toBe("next-task");
    expect(state.getPermissionLease("oc-1::ou-1", "ou-1", now)).toBeUndefined();

    await state.setThread("oc-1::ou-1", "thread-1");
    await state.setPermissionLease({
      conversationKey: "oc-1::ou-1",
      ownerId: "ou-1",
      projectPath: "/workspace/one",
      scope: "session",
      threadId: "thread-1",
      remainingUses: 1,
      expiresAt: "2026-07-16T01:00:00Z",
    });
    expect(
      state.consumePermissionLease(
        "oc-1::ou-1",
        "ou-1",
        "/workspace/one",
        "thread-1",
        now,
      )?.scope,
    ).toBe("session");
    await state.setThread("oc-1::ou-1", "thread-2");
    expect(state.getPermissionLease("oc-1::ou-1", "ou-1", now)).toBeUndefined();

    await state.setPermissionLease({
      conversationKey: "oc-1::ou-1",
      ownerId: "ou-1",
      projectPath: "/workspace/one",
      scope: "timed",
      remainingUses: 1,
      expiresAt: "2026-07-16T00:01:00Z",
    });
    expect(state.getPermissionLease("oc-1::ou-1", "ou-1", now + 61_000)).toBeUndefined();

    await state.setPermissionLease({
      conversationKey: "oc-1::ou-1",
      ownerId: "ou-1",
      projectPath: "/workspace/one",
      scope: "timed",
      remainingUses: 1,
      expiresAt: "2026-07-16T00:30:00Z",
    });
    expect(
      state.consumePermissionLease(
        "oc-1::ou-1",
        "ou-1",
        "/workspace/two",
        undefined,
        now,
      ),
    ).toBeUndefined();
    expect(state.getPermissionLease("oc-1::ou-1", "ou-1", now)).toBeUndefined();
    state.close();
  });

  it("persists each member's onboarding progress outside the legacy state blob", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "feishu-codex-onboarding-"));
    const databaseFile = path.join(directory, "state.sqlite");
    const state = new StateStore(databaseFile, 10);
    await state.load();

    expect(state.getOnboarding("oc-1::onboarding::ou-1")).toBeUndefined();
    await state.setOnboarding("oc-1::onboarding::ou-1", "ou-1", "active", 2);
    await state.setOnboarding("oc-1::onboarding::ou-2", "ou-2", "dismissed", 1);
    state.close();

    const restored = new StateStore(databaseFile, 10);
    await restored.load();
    expect(restored.getOnboarding("oc-1::onboarding::ou-1")).toMatchObject({
      ownerId: "ou-1",
      status: "active",
      step: 2,
    });
    expect(restored.getOnboarding("oc-1::onboarding::ou-2")).toMatchObject({
      ownerId: "ou-2",
      status: "dismissed",
      step: 1,
    });
    await restored.setOnboarding("oc-1::onboarding::ou-1", "ou-1", "active", 4);
    expect(restored.getOnboarding("oc-1::onboarding::ou-1")).toMatchObject({
      status: "active",
      step: 4,
    });
    const completed = await restored.setOnboarding(
      "oc-1::onboarding::ou-1",
      "ou-1",
      "completed",
      4,
    );
    expect(completed).toMatchObject({ status: "completed", step: 4 });
    restored.close();
  });

  it("persists and retries the outbound text-message outbox", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "feishu-codex-outbox-"));
    const databaseFile = path.join(directory, "state.sqlite");
    const state = new StateStore(databaseFile, 10);
    await state.load();
    await state.enqueueOutbox({
      id: "reply-1",
      kind: "reply_text",
      payload: { messageId: "om-1", text: "完成", idempotencyKey: "evt-complete" },
      attempts: 0,
      createdAt: "2026-07-15T00:00:00Z",
      nextAttemptAt: "2026-07-15T00:00:00Z",
    });
    expect(state.listDueOutbox("2026-07-16T00:00:00Z")).toHaveLength(1);
    await state.markOutboxFailed("reply-1", "network unavailable");
    expect(state.listDueOutbox("2030-01-01T00:00:00Z")[0]).toMatchObject({
      attempts: 1,
      lastError: "network unavailable",
    });
    await state.markOutboxSent("reply-1");
    expect(state.listDueOutbox("2030-01-01T00:00:00Z")).toHaveLength(0);
    state.close();
  });

  it("persists bounded device cards and recovery-notice deduplication", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "feishu-codex-device-cards-"));
    const databaseFile = path.join(directory, "state.sqlite");
    const state = new StateStore(databaseFile, 10);
    await state.load();
    for (let index = 0; index < 32; index += 1) {
      await state.upsertDeviceCard({
        messageId: `om-${index}`,
        cardId: `card-${index}`,
        conversationKey: `oc-${index % 2}`,
        ownerId: `ou-${index % 2}`,
        sequence: index,
        createdAt: index,
      });
    }
    expect(state.listDeviceCards()).toHaveLength(30);
    expect(state.listDeviceCards().at(-1)?.messageId).toBe("om-2");
    await state.setLastDeviceRecoveryNotice("oc-1", "2026-07-16T12:00:00.000Z");
    state.close();

    const restored = new StateStore(databaseFile, 10);
    await restored.load();
    expect(restored.listDeviceCards()[0]).toMatchObject({
      messageId: "om-31",
      sequence: 31,
    });
    expect(restored.getLastDeviceRecoveryNotice("oc-1")).toBe(
      "2026-07-16T12:00:00.000Z",
    );
    await restored.removeDeviceCard("om-31");
    expect(restored.listDeviceCards().some((card) => card.messageId === "om-31")).toBe(false);
    restored.close();
  });

  it("tracks per-member recent and favorite projects without sharing preferences", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "feishu-codex-project-usage-"));
    const databaseFile = path.join(directory, "state.sqlite");
    const state = new StateStore(databaseFile, 10);
    await state.load();
    await state.recordProjectUse("ou-1", "/repos/a", "2026-07-16T10:00:00.000Z");
    await state.recordProjectUse("ou-1", "/repos/b", "2026-07-16T11:00:00.000Z");
    await state.recordProjectUse("ou-2", "/repos/a", "2026-07-16T12:00:00.000Z");
    expect(await state.toggleProjectFavorite("ou-1", "/repos/a")).toBe(true);
    expect(state.listProjectUsage("ou-1")).toEqual([
      expect.objectContaining({ projectPath: "/repos/a", favorite: true, useCount: 1 }),
      expect.objectContaining({ projectPath: "/repos/b", favorite: false, useCount: 1 }),
    ]);
    expect(state.listProjectUsage("ou-2")).toEqual([
      expect.objectContaining({ projectPath: "/repos/a", favorite: false, useCount: 1 }),
    ]);
    expect(await state.toggleProjectFavorite("ou-1", "/repos/a")).toBe(false);
    state.close();
  });

  it("persists one automatically managed Feishu chat per project", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "feishu-codex-project-chat-"));
    const databaseFile = path.join(directory, "state.sqlite");
    const state = new StateStore(databaseFile, 10);
    await state.load();
    await state.upsertProjectChat({
      chatId: "oc-project-a",
      projectPath: "/repos/a",
      ownerId: "ou-owner",
      name: "project-a · Codex",
    });
    expect(state.getProjectChat("oc-project-a")).toMatchObject({
      projectPath: "/repos/a",
      ownerId: "ou-owner",
      origin: "existing",
      membersStatus: "unknown",
      membersFingerprint: null,
      workspaceStatus: "unknown",
      pinStatus: "unknown",
      messageStatus: "unknown",
    });
    state.close();

    const restored = new StateStore(databaseFile, 10);
    await restored.load();
    expect(restored.getProjectChatByProject("/repos/a")).toMatchObject({
      chatId: "oc-project-a",
      name: "project-a · Codex",
    });
    await expect(
      restored.upsertProjectChat({
        chatId: "oc-project-a-recreated",
        projectPath: "/repos/a",
        ownerId: "ou-owner",
        name: "project-a · Codex",
      }),
    ).rejects.toThrow("已经绑定了其他项目群");
    await expect(
      restored.upsertProjectChat({
        chatId: "oc-project-a",
        projectPath: "/repos/b",
        ownerId: "ou-owner",
        name: "project-b · Codex",
      }),
    ).rejects.toThrow("这个群已经绑定项目");
    expect(restored.listProjectChats()).toHaveLength(1);
    expect(restored.getProjectChat("oc-project-a")).toBeDefined();
    expect(restored.getProjectChatByProject("/repos/a")?.chatId).toBe(
      "oc-project-a",
    );
    restored.close();
  });

  it("migrates legacy project chat bindings to recoverable setup state", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "feishu-codex-project-chat-v2-"));
    const databaseFile = path.join(directory, "state.sqlite");
    const legacy = new DatabaseSync(databaseFile);
    legacy.exec(`
      CREATE TABLE project_chats (
        chat_id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL UNIQUE,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO project_chats VALUES (
        'oc-legacy', '/repos/legacy', 'ou-owner', 'legacy · Codex',
        '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z'
      );
      PRAGMA user_version = 2;
    `);
    legacy.close();

    const state = new StateStore(databaseFile, 10);
    await state.load();
    expect(state.getProjectChat("oc-legacy")).toMatchObject({
      projectPath: "/repos/legacy",
      origin: "existing",
      membersStatus: "unknown",
      membersFingerprint: null,
      workspaceStatus: "unknown",
      pinStatus: "unknown",
      messageStatus: "unknown",
      workspaceMessageId: null,
      lastError: null,
    });
    await state.updateProjectChatSetup("oc-legacy", {
      workspaceStatus: "succeeded",
      workspaceCardId: "cc-legacy",
      workspaceMessageId: "om-legacy",
      pinStatus: "failed",
      messageStatus: "succeeded",
      membersFingerprint: "team-v1",
      lastErrorStep: "pin",
      lastError: "missing pin scope",
    });
    expect(state.getProjectChat("oc-legacy")).toMatchObject({
      workspaceStatus: "succeeded",
      workspaceMessageId: "om-legacy",
      pinStatus: "failed",
      messageStatus: "succeeded",
      membersFingerprint: "team-v1",
      lastErrorStep: "pin",
    });
    state.close();
  });

  it("can be loaded again after a transient filesystem failure", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "feishu-codex-state-recovery-"));
    const blockedParent = path.join(directory, "blocked");
    const databaseFile = path.join(blockedParent, "state.sqlite");
    await writeFile(blockedParent, "not a directory");
    const state = new StateStore(databaseFile, 10);

    await expect(state.load()).rejects.toBeDefined();
    await rm(blockedParent);
    await mkdir(blockedParent);
    await expect(state.load()).resolves.toBeUndefined();
    await expect(state.markEventIfNew("evt-recovered")).resolves.toBe(true);
    state.close();
  });
});

async function migrationFiles(label: string): Promise<{
  databaseFile: string;
  legacyFile: string;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), `feishu-codex-state-${label}-`));
  return {
    databaseFile: path.join(directory, "state.sqlite"),
    legacyFile: path.join(directory, "state.json"),
  };
}

function readSqliteState(databaseFile: string): Record<string, unknown> {
  const database = new DatabaseSync(databaseFile, { readOnly: true });
  try {
    const row = database.prepare("SELECT payload FROM bridge_state WHERE id = 1").get() as {
      payload: string;
    };
    return JSON.parse(row.payload) as Record<string, unknown>;
  } finally {
    database.close();
  }
}
