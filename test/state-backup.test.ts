import { DatabaseSync } from "node:sqlite";
import { appendFile, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { removeBridgeHealth, writeBridgeHealth } from "../src/health-file.js";
import {
  createRuntimeBackup,
  listRuntimeBackups,
  restoreRuntimeBackup,
} from "../src/state-backup.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function createDatabase(file: string, value: string): void {
  const database = new DatabaseSync(file);
  database.exec(`
    PRAGMA user_version = 1;
    CREATE TABLE bridge_state (
      id INTEGER PRIMARY KEY,
      version INTEGER NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  database.prepare(
    "INSERT INTO bridge_state (id, version, payload, updated_at) VALUES (1, 6, ?, ?)",
  ).run(value, "2026-07-16T00:00:00.000Z");
  database.close();
}

function readPayload(file: string): string {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const row = database.prepare("SELECT payload FROM bridge_state WHERE id = 1").get() as {
      payload: string;
    };
    return row.payload;
  } finally {
    database.close();
  }
}

describe("runtime state backup", () => {
  it("creates a private verified snapshot and restores it with a safety backup", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "feishu-codex-backup-"));
    temporaryDirectories.push(dataDir);
    const databaseFile = path.join(dataDir, "state.sqlite");
    createDatabase(databaseFile, "before");

    const original = await createRuntimeBackup(databaseFile, {
      reason: "manual",
      now: new Date("2026-07-16T12:00:00.000Z"),
    });
    expect((await stat(original.databaseFile)).mode & 0o777).toBe(0o600);
    expect(original.manifest.database.integrity).toBe("ok");
    expect(original.manifest.database.sqliteUserVersion).toBe(1);
    expect((await readdir(original.directory)).sort()).toEqual(["manifest.json", "state.sqlite"]);

    await rm(databaseFile, { force: true });
    createDatabase(databaseFile, "after");
    const result = await restoreRuntimeBackup(databaseFile, dataDir, original.id);

    expect(readPayload(databaseFile)).toBe("before");
    expect(result.safetyBackup?.manifest.reason).toBe("before-rollback");
    expect((await listRuntimeBackups(databaseFile)).map((entry) => entry.id)).toContain(original.id);
  });

  it("refuses rollback while the bridge process is alive", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "feishu-codex-live-backup-"));
    temporaryDirectories.push(dataDir);
    const databaseFile = path.join(dataDir, "state.sqlite");
    createDatabase(databaseFile, "stable");
    const snapshot = await createRuntimeBackup(databaseFile);
    await writeBridgeHealth(dataDir, {
      status: "ready",
      instanceId: "test",
      pid: process.pid,
      startedAt: new Date().toISOString(),
      configFile: null,
      consumers: [],
    });

    await expect(restoreRuntimeBackup(databaseFile, dataDir, snapshot.id)).rejects.toThrow(
      "仍在运行",
    );
    await removeBridgeHealth(dataDir, process.pid);
  });

  it("rejects a snapshot whose checksum no longer matches the manifest", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "feishu-codex-corrupt-backup-"));
    temporaryDirectories.push(dataDir);
    const databaseFile = path.join(dataDir, "state.sqlite");
    createDatabase(databaseFile, "stable");
    const snapshot = await createRuntimeBackup(databaseFile);
    await appendFile(snapshot.databaseFile, "tampered");

    await expect(restoreRuntimeBackup(databaseFile, dataDir, snapshot.id)).rejects.toThrow(
      "校验和不匹配",
    );
    expect(readPayload(databaseFile)).toBe("stable");
  });
});
