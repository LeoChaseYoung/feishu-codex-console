import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PERSISTED_STATE_VERSION,
  StateStore,
  STATE_SCHEMA_VERSION,
} from "../src/state-store.js";
import { listRuntimeBackups } from "../src/state-backup.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function existingDatabase(payload: unknown, sqliteUserVersion = 0): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "feishu-codex-schema-"));
  temporaryDirectories.push(directory);
  const file = path.join(directory, "state.sqlite");
  const database = new DatabaseSync(file);
  database.exec(`
    PRAGMA user_version = ${sqliteUserVersion};
    CREATE TABLE bridge_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const stateVersion =
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { version?: unknown }).version === "number"
      ? (payload as { version: number }).version
      : 0;
  database.prepare(
    "INSERT INTO bridge_state (id, version, payload, updated_at) VALUES (1, ?, ?, ?)",
  ).run(stateVersion, JSON.stringify(payload), "2026-07-16T00:00:00.000Z");
  database.close();
  return file;
}

function validState(): Record<string, unknown> {
  return {
    version: 6,
    threads: {},
    projects: {},
    chats: {},
    seenEvents: [],
    tasks: {},
    projectCards: {},
    confirmations: {},
    preferences: {},
    device: { remoteReadyEnabled: false, updatedAt: "2026-07-16T00:00:00.000Z" },
  };
}

describe("state schema migration safety", () => {
  it("backs up an existing database before advancing the schema", async () => {
    const file = await existingDatabase(validState());
    const store = new StateStore(file, 10);
    await store.load();
    store.close();

    const database = new DatabaseSync(file, { readOnly: true });
    const version = database.prepare("PRAGMA user_version").get() as { user_version: number };
    database.close();
    expect(version.user_version).toBe(STATE_SCHEMA_VERSION);
    const backups = await listRuntimeBackups(file);
    expect(backups).toHaveLength(1);
    expect(backups[0].manifest.reason).toBe(`schema-0-to-${STATE_SCHEMA_VERSION}`);
  });

  it("automatically restores the pre-migration database when state conversion fails", async () => {
    const file = await existingDatabase({ version: 999, corrupted: true });
    const store = new StateStore(file, 10);
    await expect(store.load()).rejects.toThrow("unsupported state shape");

    const database = new DatabaseSync(file, { readOnly: true });
    const version = database.prepare("PRAGMA user_version").get() as { user_version: number };
    const outbox = database
      .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'outbox'")
      .get() as { count: number };
    database.close();
    expect(version.user_version).toBe(0);
    expect(outbox.count).toBe(0);
    expect(await listRuntimeBackups(file)).toHaveLength(1);
  });

  it("also protects payload migrations when the SQLite schema is already current", async () => {
    const legacyV5: Record<string, unknown> = {
      ...validState(),
      version: 5,
    };
    delete legacyV5.preferences;
    const file = await existingDatabase(legacyV5, STATE_SCHEMA_VERSION);
    const store = new StateStore(file, 10);
    await store.load();
    store.close();

    const database = new DatabaseSync(file, { readOnly: true });
    const row = database.prepare("SELECT version FROM bridge_state WHERE id = 1").get() as {
      version: number;
    };
    database.close();
    expect(row.version).toBe(PERSISTED_STATE_VERSION);
    const backups = await listRuntimeBackups(file);
    expect(backups).toHaveLength(1);
    expect(backups[0].manifest.reason).toContain("state-5-to-6");
  });
});
