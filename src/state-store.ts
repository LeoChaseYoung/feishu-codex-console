import { chmod, mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  createRuntimeBackupFromDatabase,
  restoreRuntimeBackupFile,
  type RuntimeBackup,
} from "./state-backup.js";

import type {
  AuditEvent,
  ConversationPreferences,
  LegacyConfirmationState,
  LegacyPersistedStateV5,
  LegacyPersistedStateV4,
  LegacyPersistedStateV3,
  LegacyPersistedStateV1,
  LegacyPersistedStateV2,
  LegacyProjectCardState,
  LegacyTaskState,
  OnboardingState,
  PermissionLease,
  PermissionLeaseScope,
  PersistedConfirmationState,
  PersistedDeviceCardState,
  PersistedOutboxItem,
  PersistedProjectCardState,
  PersistedState,
  PersistedTaskState,
  ProjectChatBinding,
  ProjectChatSetupPatch,
  ProjectChatStepStatus,
  ProjectUsageState,
} from "./types.js";

export const PERSISTED_STATE_VERSION = 6;
export const STATE_SCHEMA_VERSION = 4;

function freshState(): PersistedState {
  return {
    version: PERSISTED_STATE_VERSION,
    threads: {},
    projects: {},
    chats: {},
    seenEvents: [],
    tasks: {},
    projectCards: {},
    confirmations: {},
    preferences: {},
    device: { remoteReadyEnabled: false, updatedAt: new Date(0).toISOString() },
  };
}

function isPersistedState(value: unknown): value is PersistedState {
  if (!isRecord(value)) return false;
  return (
    value.version === 6 &&
    isRecord(value.threads) &&
    isRecord(value.projects) &&
    isRecord(value.chats) &&
    Array.isArray(value.seenEvents) &&
    isRecord(value.tasks) &&
    isRecord(value.projectCards) &&
    isRecord(value.confirmations) &&
    isRecord(value.preferences) &&
    isRecord(value.device) &&
    typeof value.device.remoteReadyEnabled === "boolean"
  );
}

function isLegacyV5State(value: unknown): value is LegacyPersistedStateV5 {
  if (!isRecord(value)) return false;
  return (
    value.version === 5 &&
    isRecord(value.threads) &&
    isRecord(value.projects) &&
    isRecord(value.chats) &&
    Array.isArray(value.seenEvents) &&
    isRecord(value.tasks) &&
    isRecord(value.projectCards) &&
    isRecord(value.confirmations) &&
    isRecord(value.device)
  );
}

function isLegacyV4State(value: unknown): value is LegacyPersistedStateV4 {
  if (!isRecord(value)) return false;
  return (
    value.version === 4 &&
    isRecord(value.threads) &&
    isRecord(value.projects) &&
    Array.isArray(value.seenEvents) &&
    isRecord(value.tasks) &&
    isRecord(value.projectCards)
  );
}

function isLegacyV3State(value: unknown): value is LegacyPersistedStateV3 {
  if (!isRecord(value)) return false;
  return (
    value.version === 3 &&
    isRecord(value.threads) &&
    isRecord(value.projects) &&
    Array.isArray(value.seenEvents) &&
    isRecord(value.tasks) &&
    isRecord(value.projectCards)
  );
}

function isLegacyV2State(value: unknown): value is LegacyPersistedStateV2 {
  if (!isRecord(value)) return false;
  return (
    value.version === 2 &&
    isRecord(value.threads) &&
    isRecord(value.projects) &&
    Array.isArray(value.seenEvents)
  );
}

function isLegacyV1State(value: unknown): value is LegacyPersistedStateV1 {
  if (!isRecord(value)) return false;
  return value.version === 1 && isRecord(value.threads) && Array.isArray(value.seenEvents);
}

export class StateStore {
  private state: PersistedState = freshState();
  private database: DatabaseSync | null = null;

  constructor(
    private readonly databaseFile: string,
    private readonly maxSeenEvents: number,
    private readonly legacyStateFile?: string,
  ) {}

  async load(): Promise<void> {
    if (this.database) return;
    await ensurePrivateDatabasePath(this.databaseFile);
    const database = new DatabaseSync(this.databaseFile);
    this.database = database;
    let migrationBackup: RuntimeBackup | undefined;
    try {
      database.exec("PRAGMA journal_mode = WAL");
      database.exec("PRAGMA synchronous = FULL");
      database.exec("PRAGMA busy_timeout = 5000");
      const sqliteUserVersion = databaseUserVersion(database);
      if (sqliteUserVersion > STATE_SCHEMA_VERSION) {
        throw new Error(
          `database schema ${sqliteUserVersion} is newer than supported ${STATE_SCHEMA_VERSION}`,
        );
      }
      const existingSchema = databaseObjectCount(database) > 0;
      const storedStateVersion = databaseStateVersion(database);
      const migrationReasons = [
        ...(sqliteUserVersion < STATE_SCHEMA_VERSION
          ? [`schema-${sqliteUserVersion}-to-${STATE_SCHEMA_VERSION}`]
          : []),
        ...(storedStateVersion !== undefined && storedStateVersion !== PERSISTED_STATE_VERSION
          ? [`state-${storedStateVersion}-to-${PERSISTED_STATE_VERSION}`]
          : []),
      ];
      if (existingSchema && migrationReasons.length > 0) {
        migrationBackup = await createRuntimeBackupFromDatabase(database, this.databaseFile, {
          reason: migrationReasons.join("_"),
        });
      }

      database.exec("BEGIN IMMEDIATE");
      try {
        database.exec(`
        CREATE TABLE IF NOT EXISTS bridge_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          version INTEGER NOT NULL,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS outbox (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          payload TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          next_attempt_at TEXT NOT NULL,
          last_error TEXT
        );
        CREATE INDEX IF NOT EXISTS outbox_due_idx ON outbox(next_attempt_at, created_at);
        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          occurred_at TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          action TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          outcome TEXT NOT NULL,
          detail TEXT
        );
        CREATE INDEX IF NOT EXISTS audit_log_time_idx ON audit_log(occurred_at DESC);
        CREATE TABLE IF NOT EXISTS thread_access (
          thread_id TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          conversation_key TEXT NOT NULL,
          project_path TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (thread_id, owner_id)
        );
        CREATE INDEX IF NOT EXISTS thread_access_owner_project_idx
          ON thread_access(owner_id, project_path, updated_at DESC);
        CREATE TABLE IF NOT EXISTS onboarding_state (
          conversation_key TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          status TEXT NOT NULL,
          step INTEGER NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS permission_leases (
          conversation_key TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          project_path TEXT NOT NULL,
          scope TEXT NOT NULL,
          thread_id TEXT,
          remaining_uses INTEGER NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS permission_leases_expiry_idx
          ON permission_leases(expires_at);
        CREATE TABLE IF NOT EXISTS device_cards (
          message_id TEXT PRIMARY KEY,
          card_id TEXT NOT NULL,
          conversation_key TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS device_cards_created_idx
          ON device_cards(created_at DESC);
        CREATE TABLE IF NOT EXISTS device_recovery_notice (
          conversation_key TEXT PRIMARY KEY,
          notified_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS project_usage (
          owner_id TEXT NOT NULL,
          project_path TEXT NOT NULL,
          favorite INTEGER NOT NULL DEFAULT 0,
          last_used_at TEXT,
          use_count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (owner_id, project_path)
        );
        CREATE INDEX IF NOT EXISTS project_usage_recent_idx
          ON project_usage(owner_id, favorite DESC, last_used_at DESC);
        CREATE TABLE IF NOT EXISTS project_chats (
          chat_id TEXT PRIMARY KEY,
          project_path TEXT NOT NULL UNIQUE,
          owner_id TEXT NOT NULL,
          name TEXT NOT NULL,
          origin TEXT NOT NULL DEFAULT 'existing',
          members_status TEXT NOT NULL DEFAULT 'unknown',
          members_fingerprint TEXT,
          workspace_status TEXT NOT NULL DEFAULT 'unknown',
          pin_status TEXT NOT NULL DEFAULT 'unknown',
          message_status TEXT NOT NULL DEFAULT 'unknown',
          workspace_card_id TEXT,
          workspace_message_id TEXT,
          last_error_step TEXT,
          last_error TEXT,
          last_attempt_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS project_chats_owner_idx
          ON project_chats(owner_id, updated_at DESC);
        `);
        const permissionLeaseColumns = database
          .prepare("PRAGMA table_info(permission_leases)")
          .all() as Array<{ name: string }>;
        if (!permissionLeaseColumns.some((column) => column.name === "project_path")) {
          // Leases are deliberately ephemeral. An old lease is retained only as an
          // invalid row and will be revoked on its next lookup instead of guessing
          // which project it belonged to.
          database.exec(
            "ALTER TABLE permission_leases ADD COLUMN project_path TEXT NOT NULL DEFAULT ''",
          );
        }
        const projectChatColumns = new Set(
          (database.prepare("PRAGMA table_info(project_chats)").all() as Array<{ name: string }>).map(
            (column) => column.name,
          ),
        );
        const projectChatMigrations = [
          ["origin", "TEXT NOT NULL DEFAULT 'existing'"],
          ["members_status", "TEXT NOT NULL DEFAULT 'unknown'"],
          ["members_fingerprint", "TEXT"],
          ["workspace_status", "TEXT NOT NULL DEFAULT 'unknown'"],
          ["pin_status", "TEXT NOT NULL DEFAULT 'unknown'"],
          ["message_status", "TEXT NOT NULL DEFAULT 'unknown'"],
          ["workspace_card_id", "TEXT"],
          ["workspace_message_id", "TEXT"],
          ["last_error_step", "TEXT"],
          ["last_error", "TEXT"],
          ["last_attempt_at", "TEXT"],
        ] as const;
        for (const [column, definition] of projectChatMigrations) {
          if (!projectChatColumns.has(column)) {
            database.exec(`ALTER TABLE project_chats ADD COLUMN ${column} ${definition}`);
          }
        }
        database.exec(`PRAGMA user_version = ${STATE_SCHEMA_VERSION}`);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      const integrity = database.prepare("PRAGMA quick_check").get() as
        | { quick_check?: string }
        | undefined;
      if (integrity?.quick_check !== "ok") {
        throw new Error(`database integrity check failed: ${integrity?.quick_check ?? "unknown"}`);
      }
      await secureSqliteFiles(this.databaseFile);

      const row = database
        .prepare("SELECT payload FROM bridge_state WHERE id = 1")
        .get() as { payload?: string } | undefined;
      if (row?.payload) {
        this.state = migrateState(JSON.parse(row.payload) as unknown);
        await this.persist();
        return;
      }

      if (this.legacyStateFile) {
        try {
          const raw = await readFile(this.legacyStateFile, "utf8");
          this.state = migrateState(JSON.parse(raw) as unknown);
          await writeFile(this.legacyStateFile, `${JSON.stringify(this.state, null, 2)}\n`, {
            encoding: "utf8",
            mode: 0o600,
          });
          await chmod(this.legacyStateFile, 0o600);
          console.info(`[state] migrated legacy JSON state into SQLite: ${this.legacyStateFile}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw new Error(`Unable to migrate legacy bridge state: ${(error as Error).message}`);
          }
        }
      }
      await this.persist();
    } catch (error) {
      database.close();
      this.database = null;
      if (migrationBackup) {
        try {
          await restoreRuntimeBackupFile(migrationBackup.databaseFile, this.databaseFile);
        } catch (rollbackError) {
          throw new Error(
            `Unable to load bridge state: ${(error as Error).message}; automatic rollback failed: ${(rollbackError as Error).message}`,
          );
        }
      }
      throw new Error(`Unable to load bridge state: ${(error as Error).message}`);
    }
  }

  getThread(conversationKey: string): string | undefined {
    return this.state.threads[conversationKey]?.threadId;
  }

  get threadCount(): number {
    return Object.keys(this.state.threads).length;
  }

  getProject(conversationKey: string): string | undefined {
    return this.state.projects[conversationKey]?.path;
  }

  getChatType(conversationKey: string): "p2p" | "group" | undefined {
    return this.state.chats[conversationKey]?.type;
  }

  getRemoteReady(): boolean {
    return this.state.device.remoteReadyEnabled;
  }

  async setRemoteReady(enabled: boolean): Promise<void> {
    if (this.state.device.remoteReadyEnabled === enabled) return;
    this.state.device = { remoteReadyEnabled: enabled, updatedAt: new Date().toISOString() };
    await this.persist();
  }

  async setChatType(conversationKey: string, type: "p2p" | "group"): Promise<void> {
    if (this.state.chats[conversationKey]?.type === type) return;
    this.state.chats[conversationKey] = { type, updatedAt: new Date().toISOString() };
    await this.persist();
  }

  async setProject(
    conversationKey: string,
    projectPath: string,
  ): Promise<{ changed: boolean; threadReset: boolean }> {
    const previous = this.state.projects[conversationKey]?.path;
    if (previous === projectPath) return { changed: false, threadReset: false };
    const threadReset = conversationKey in this.state.threads;
    this.state.projects[conversationKey] = {
      path: projectPath,
      updatedAt: new Date().toISOString(),
    };
    delete this.state.threads[conversationKey];
    this.revokePermissionLease(conversationKey);
    await this.persist();
    return { changed: true, threadReset };
  }

  async setThread(conversationKey: string, threadId: string): Promise<void> {
    const previous = this.state.threads[conversationKey]?.threadId;
    if (previous && previous !== threadId) this.revokeSessionPermissionLease(conversationKey);
    this.state.threads[conversationKey] = {
      threadId,
      updatedAt: new Date().toISOString(),
    };
    await this.persist();
  }

  async registerThreadAccess(
    threadId: string,
    conversationKey: string,
    ownerId: string,
    projectPath: string,
  ): Promise<void> {
    this.requireDatabase()
      .prepare(
        `INSERT INTO thread_access
          (thread_id, owner_id, conversation_key, project_path, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, owner_id) DO UPDATE SET
           conversation_key = excluded.conversation_key,
           project_path = excluded.project_path,
           updated_at = excluded.updated_at`,
      )
      .run(threadId, ownerId, conversationKey, projectPath, new Date().toISOString());
  }

  listOwnedThreadIds(ownerId: string, projectPath: string): Set<string> {
    const rows = this.requireDatabase()
      .prepare(
        `SELECT thread_id FROM thread_access
         WHERE owner_id = ? AND project_path = ?
         ORDER BY updated_at DESC`,
      )
      .all(ownerId, projectPath) as Array<{ thread_id: string }>;
    return new Set(rows.map((row) => row.thread_id));
  }

  getOnboarding(conversationKey: string): OnboardingState | undefined {
    const row = this.requireDatabase()
      .prepare(
        `SELECT owner_id, status, step, updated_at
         FROM onboarding_state WHERE conversation_key = ?`,
      )
      .get(conversationKey) as
      | { owner_id: string; status: string; step: number; updated_at: string }
      | undefined;
    if (!row || !["active", "completed", "dismissed"].includes(row.status)) return undefined;
    const step = row.step === 2 ? 2 : row.step === 3 ? 3 : row.step === 4 ? 4 : 1;
    return {
      ownerId: row.owner_id,
      status: row.status as OnboardingState["status"],
      step,
      updatedAt: row.updated_at,
    };
  }

  async setOnboarding(
    conversationKey: string,
    ownerId: string,
    status: OnboardingState["status"],
    step: OnboardingState["step"],
  ): Promise<OnboardingState> {
    const updatedAt = new Date().toISOString();
    this.requireDatabase()
      .prepare(
        `INSERT INTO onboarding_state
          (conversation_key, owner_id, status, step, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(conversation_key) DO UPDATE SET
           owner_id = excluded.owner_id,
           status = excluded.status,
           step = excluded.step,
           updated_at = excluded.updated_at`,
      )
      .run(conversationKey, ownerId, status, step, updatedAt);
    return { ownerId, status, step, updatedAt };
  }

  async resetThread(conversationKey: string): Promise<boolean> {
    const existed = conversationKey in this.state.threads;
    delete this.state.threads[conversationKey];
    this.revokeSessionPermissionLease(conversationKey);
    if (existed) await this.persist();
    return existed;
  }

  getPreferences(conversationKey: string): ConversationPreferences | undefined {
    const preferences = this.state.preferences[conversationKey];
    return preferences ? structuredClone(preferences) : undefined;
  }

  async setPreferences(
    conversationKey: string,
    preferences: Omit<ConversationPreferences, "updatedAt">,
  ): Promise<ConversationPreferences> {
    const saved: ConversationPreferences = {
      ...preferences,
      updatedAt: new Date().toISOString(),
    };
    this.state.preferences[conversationKey] = saved;
    await this.persist();
    return structuredClone(saved);
  }

  getPermissionLease(
    conversationKey: string,
    ownerId: string,
    now = Date.now(),
  ): PermissionLease | undefined {
    const row = this.requireDatabase()
      .prepare(
        `SELECT conversation_key, owner_id, project_path, scope, thread_id, remaining_uses,
                expires_at, created_at, updated_at
         FROM permission_leases WHERE conversation_key = ?`,
      )
      .get(conversationKey) as PermissionLeaseRow | undefined;
    if (!row) return undefined;
    if (
      row.owner_id !== ownerId ||
      !isPermissionLeaseScope(row.scope) ||
      row.remaining_uses <= 0 ||
      Date.parse(row.expires_at) <= now
    ) {
      this.requireDatabase()
        .prepare("DELETE FROM permission_leases WHERE conversation_key = ?")
        .run(conversationKey);
      return undefined;
    }
    return permissionLeaseFromRow(row);
  }

  async setPermissionLease(
    lease: Omit<PermissionLease, "createdAt" | "updatedAt">,
  ): Promise<PermissionLease> {
    const now = new Date().toISOString();
    const saved: PermissionLease = {
      ...lease,
      createdAt: now,
      updatedAt: now,
    };
    this.requireDatabase()
      .prepare(
        `INSERT INTO permission_leases
          (conversation_key, owner_id, project_path, scope, thread_id, remaining_uses,
           expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(conversation_key) DO UPDATE SET
           owner_id = excluded.owner_id,
           project_path = excluded.project_path,
           scope = excluded.scope,
           thread_id = excluded.thread_id,
           remaining_uses = excluded.remaining_uses,
           expires_at = excluded.expires_at,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        saved.conversationKey,
        saved.ownerId,
        saved.projectPath,
        saved.scope,
        saved.threadId ?? null,
        saved.remainingUses,
        saved.expiresAt,
        saved.createdAt,
        saved.updatedAt,
      );
    return saved;
  }

  consumePermissionLease(
    conversationKey: string,
    ownerId: string,
    projectPath: string,
    threadId: string | undefined,
    now = Date.now(),
  ): PermissionLease | undefined {
    const lease = this.getPermissionLease(conversationKey, ownerId, now);
    if (!lease) return undefined;
    if (lease.projectPath !== projectPath) {
      this.revokePermissionLease(conversationKey);
      return undefined;
    }
    if (lease.scope === "session" && (!threadId || lease.threadId !== threadId)) {
      this.revokePermissionLease(conversationKey);
      return undefined;
    }
    if (lease.scope === "next-task") {
      this.revokePermissionLease(conversationKey);
    }
    return lease;
  }

  revokePermissionLease(conversationKey: string): boolean {
    const result = this.requireDatabase()
      .prepare("DELETE FROM permission_leases WHERE conversation_key = ?")
      .run(conversationKey);
    return Number(result.changes) > 0;
  }

  private revokeSessionPermissionLease(conversationKey: string): void {
    this.requireDatabase()
      .prepare(
        "DELETE FROM permission_leases WHERE conversation_key = ? AND scope = 'session'",
      )
      .run(conversationKey);
  }

  async markEventIfNew(eventId: string): Promise<boolean> {
    if (this.state.seenEvents.some((event) => event.id === eventId)) return false;
    this.state.seenEvents.push({ id: eventId, seenAt: new Date().toISOString() });
    if (this.state.seenEvents.length > this.maxSeenEvents) {
      this.state.seenEvents.splice(0, this.state.seenEvents.length - this.maxSeenEvents);
    }
    await this.persist();
    return true;
  }

  hasSeenEvent(eventId: string): boolean {
    return this.state.seenEvents.some((event) => event.id === eventId);
  }

  listTasks(): PersistedTaskState[] {
    return Object.values(this.state.tasks).map((task) => structuredClone(task));
  }

  async upsertTask(task: PersistedTaskState): Promise<void> {
    this.state.tasks[task.id] = structuredClone(task);
    const completed = Object.values(this.state.tasks)
      .filter((candidate) => candidate.status !== "queued" && candidate.status !== "running")
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    while (Object.keys(this.state.tasks).length > 100 && completed.length > 0) {
      const oldest = completed.shift();
      if (oldest) delete this.state.tasks[oldest.id];
    }
    await this.persist();
  }

  async removeTask(taskId: string): Promise<void> {
    if (!(taskId in this.state.tasks)) return;
    delete this.state.tasks[taskId];
    await this.persist();
  }

  listProjectCards(): PersistedProjectCardState[] {
    return Object.values(this.state.projectCards).map((card) => structuredClone(card));
  }

  async upsertProjectCard(card: PersistedProjectCardState): Promise<void> {
    this.state.projectCards[card.messageId] = structuredClone(card);
    const cards = Object.values(this.state.projectCards).sort(
      (left, right) => left.createdAt - right.createdAt,
    );
    while (cards.length > 50) {
      const oldest = cards.shift();
      if (oldest) delete this.state.projectCards[oldest.messageId];
    }
    await this.persist();
  }

  async removeProjectCard(messageId: string): Promise<void> {
    if (!(messageId in this.state.projectCards)) return;
    delete this.state.projectCards[messageId];
    await this.persist();
  }

  listDeviceCards(): PersistedDeviceCardState[] {
    const rows = this.requireDatabase()
      .prepare(
        `SELECT message_id, card_id, conversation_key, owner_id, sequence, created_at
         FROM device_cards ORDER BY created_at DESC`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      messageId: String(row.message_id),
      cardId: String(row.card_id),
      conversationKey: String(row.conversation_key),
      ownerId: String(row.owner_id),
      sequence: Number(row.sequence),
      createdAt: Number(row.created_at),
    }));
  }

  async upsertDeviceCard(card: PersistedDeviceCardState): Promise<void> {
    this.requireDatabase()
      .prepare(
        `INSERT INTO device_cards
          (message_id, card_id, conversation_key, owner_id, sequence, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(message_id) DO UPDATE SET
           card_id = excluded.card_id,
           conversation_key = excluded.conversation_key,
           owner_id = excluded.owner_id,
           sequence = excluded.sequence,
           created_at = excluded.created_at`,
      )
      .run(
        card.messageId,
        card.cardId,
        card.conversationKey,
        card.ownerId,
        card.sequence,
        card.createdAt,
      );
    const overflow = this.listDeviceCards().slice(30);
    for (const stale of overflow) await this.removeDeviceCard(stale.messageId);
  }

  async removeDeviceCard(messageId: string): Promise<void> {
    this.requireDatabase().prepare("DELETE FROM device_cards WHERE message_id = ?").run(messageId);
  }

  getLastDeviceRecoveryNotice(conversationKey: string): string | undefined {
    const row = this.requireDatabase()
      .prepare(
        "SELECT notified_at FROM device_recovery_notice WHERE conversation_key = ?",
      )
      .get(conversationKey) as { notified_at?: string } | undefined;
    return row?.notified_at;
  }

  async setLastDeviceRecoveryNotice(conversationKey: string, notifiedAt: string): Promise<void> {
    this.requireDatabase()
      .prepare(
        `INSERT INTO device_recovery_notice (conversation_key, notified_at)
         VALUES (?, ?)
         ON CONFLICT(conversation_key) DO UPDATE SET notified_at = excluded.notified_at`,
      )
      .run(conversationKey, notifiedAt);
  }

  getProjectChat(chatId: string): ProjectChatBinding | undefined {
    const row = this.requireDatabase()
      .prepare(
        `SELECT chat_id, project_path, owner_id, name, origin,
                members_status, members_fingerprint, workspace_status, pin_status, message_status,
                workspace_card_id, workspace_message_id,
                last_error_step, last_error, last_attempt_at,
                created_at, updated_at
         FROM project_chats WHERE chat_id = ?`,
      )
      .get(chatId) as Record<string, unknown> | undefined;
    return row ? projectChatBindingFromRow(row) : undefined;
  }

  getProjectChatByProject(projectPath: string): ProjectChatBinding | undefined {
    const row = this.requireDatabase()
      .prepare(
        `SELECT chat_id, project_path, owner_id, name, origin,
                members_status, members_fingerprint, workspace_status, pin_status, message_status,
                workspace_card_id, workspace_message_id,
                last_error_step, last_error, last_attempt_at,
                created_at, updated_at
         FROM project_chats WHERE project_path = ?`,
      )
      .get(projectPath) as Record<string, unknown> | undefined;
    return row ? projectChatBindingFromRow(row) : undefined;
  }

  listProjectChats(): ProjectChatBinding[] {
    const rows = this.requireDatabase()
      .prepare(
        `SELECT chat_id, project_path, owner_id, name, origin,
                members_status, members_fingerprint, workspace_status, pin_status, message_status,
                workspace_card_id, workspace_message_id,
                last_error_step, last_error, last_attempt_at,
                created_at, updated_at
         FROM project_chats ORDER BY updated_at DESC`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map(projectChatBindingFromRow);
  }

  async upsertProjectChat(
    binding: Pick<ProjectChatBinding, "chatId" | "projectPath" | "ownerId" | "name"> &
      Partial<
        Pick<
          ProjectChatBinding,
          | "origin"
          | "membersStatus"
          | "membersFingerprint"
          | "workspaceStatus"
          | "pinStatus"
          | "messageStatus"
          | "workspaceCardId"
          | "workspaceMessageId"
          | "lastErrorStep"
          | "lastError"
          | "lastAttemptAt"
        >
      >,
  ): Promise<ProjectChatBinding> {
    const existingChat = this.getProjectChat(binding.chatId);
    if (existingChat && existingChat.projectPath !== binding.projectPath) {
      throw new Error(`这个群已经绑定项目，不能改绑到其他项目。`);
    }
    const existingProject = this.getProjectChatByProject(binding.projectPath);
    if (existingProject && existingProject.chatId !== binding.chatId) {
      throw new Error(`这个项目已经绑定了其他项目群。`);
    }
    const now = new Date().toISOString();
    const origin = binding.origin ?? "existing";
    const membersStatus = binding.membersStatus ?? "unknown";
    const membersFingerprint = binding.membersFingerprint ?? null;
    const workspaceStatus = binding.workspaceStatus ?? "unknown";
    const pinStatus = binding.pinStatus ?? "unknown";
    const messageStatus = binding.messageStatus ?? "unknown";
    this.requireDatabase()
      .prepare(
        `INSERT INTO project_chats
          (chat_id, project_path, owner_id, name, origin,
           members_status, members_fingerprint, workspace_status, pin_status, message_status,
           workspace_card_id, workspace_message_id,
           last_error_step, last_error, last_attempt_at,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET
           owner_id = excluded.owner_id,
           name = excluded.name,
           updated_at = excluded.updated_at`,
      )
      .run(
        binding.chatId,
        binding.projectPath,
        binding.ownerId,
        binding.name,
        origin,
        membersStatus,
        membersFingerprint,
        workspaceStatus,
        pinStatus,
        messageStatus,
        binding.workspaceCardId ?? null,
        binding.workspaceMessageId ?? null,
        binding.lastErrorStep ?? null,
        binding.lastError ?? null,
        binding.lastAttemptAt ?? null,
        now,
        now,
      );
    return this.getProjectChat(binding.chatId) ?? {
      chatId: binding.chatId,
      projectPath: binding.projectPath,
      ownerId: binding.ownerId,
      name: binding.name,
      origin,
      membersStatus,
      membersFingerprint,
      workspaceStatus,
      pinStatus,
      messageStatus,
      workspaceCardId: binding.workspaceCardId ?? null,
      workspaceMessageId: binding.workspaceMessageId ?? null,
      lastErrorStep: binding.lastErrorStep ?? null,
      lastError: binding.lastError ?? null,
      lastAttemptAt: binding.lastAttemptAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async updateProjectChatSetup(
    chatId: string,
    patch: ProjectChatSetupPatch,
  ): Promise<ProjectChatBinding> {
    const assignments: string[] = [];
    const values: Array<string | null> = [];
    const add = (column: string, value: string | null): void => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };
    if (patch.origin !== undefined) add("origin", patch.origin);
    if (patch.membersStatus !== undefined) add("members_status", patch.membersStatus);
    if (patch.membersFingerprint !== undefined) {
      add("members_fingerprint", patch.membersFingerprint);
    }
    if (patch.workspaceStatus !== undefined) add("workspace_status", patch.workspaceStatus);
    if (patch.pinStatus !== undefined) add("pin_status", patch.pinStatus);
    if (patch.messageStatus !== undefined) add("message_status", patch.messageStatus);
    if (patch.workspaceCardId !== undefined) add("workspace_card_id", patch.workspaceCardId);
    if (patch.workspaceMessageId !== undefined) {
      add("workspace_message_id", patch.workspaceMessageId);
    }
    if (patch.lastErrorStep !== undefined) add("last_error_step", patch.lastErrorStep);
    if (patch.lastError !== undefined) add("last_error", patch.lastError);
    if (patch.lastAttemptAt !== undefined) add("last_attempt_at", patch.lastAttemptAt);
    if (assignments.length === 0) {
      const current = this.getProjectChat(chatId);
      if (!current) throw new Error("项目群绑定不存在，无法更新配置状态。");
      return current;
    }
    const now = new Date().toISOString();
    assignments.push("updated_at = ?");
    values.push(now, chatId);
    const result = this.requireDatabase()
      .prepare(`UPDATE project_chats SET ${assignments.join(", ")} WHERE chat_id = ?`)
      .run(...values);
    if (result.changes !== 1) throw new Error("项目群绑定不存在，无法更新配置状态。");
    const updated = this.getProjectChat(chatId);
    if (!updated) throw new Error("项目群配置状态更新后无法读取。");
    return updated;
  }

  listProjectUsage(ownerId: string): ProjectUsageState[] {
    const rows = this.requireDatabase()
      .prepare(
        `SELECT owner_id, project_path, favorite, last_used_at, use_count
         FROM project_usage WHERE owner_id = ?
         ORDER BY favorite DESC, last_used_at DESC`,
      )
      .all(ownerId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ownerId: String(row.owner_id),
      projectPath: String(row.project_path),
      favorite: Number(row.favorite) === 1,
      ...(typeof row.last_used_at === "string" ? { lastUsedAt: row.last_used_at } : {}),
      useCount: Number(row.use_count),
    }));
  }

  async recordProjectUse(
    ownerId: string,
    projectPath: string,
    usedAt = new Date().toISOString(),
  ): Promise<void> {
    this.requireDatabase()
      .prepare(
        `INSERT INTO project_usage
          (owner_id, project_path, favorite, last_used_at, use_count)
         VALUES (?, ?, 0, ?, 1)
         ON CONFLICT(owner_id, project_path) DO UPDATE SET
           last_used_at = excluded.last_used_at,
           use_count = project_usage.use_count + 1`,
      )
      .run(ownerId, projectPath, usedAt);
  }

  async toggleProjectFavorite(ownerId: string, projectPath: string): Promise<boolean> {
    this.requireDatabase()
      .prepare(
        `INSERT INTO project_usage
          (owner_id, project_path, favorite, last_used_at, use_count)
         VALUES (?, ?, 1, NULL, 0)
         ON CONFLICT(owner_id, project_path) DO UPDATE SET
           favorite = CASE project_usage.favorite WHEN 1 THEN 0 ELSE 1 END`,
      )
      .run(ownerId, projectPath);
    const row = this.requireDatabase()
      .prepare(
        "SELECT favorite FROM project_usage WHERE owner_id = ? AND project_path = ?",
      )
      .get(ownerId, projectPath) as { favorite?: number } | undefined;
    return row?.favorite === 1;
  }

  listConfirmations(): PersistedConfirmationState[] {
    return Object.values(this.state.confirmations).map((confirmation) =>
      structuredClone(confirmation),
    );
  }

  async upsertConfirmation(confirmation: PersistedConfirmationState): Promise<void> {
    this.state.confirmations[confirmation.id] = structuredClone(confirmation);
    await this.persist();
  }

  async removeConfirmation(confirmationId: string): Promise<void> {
    if (!(confirmationId in this.state.confirmations)) return;
    delete this.state.confirmations[confirmationId];
    await this.persist();
  }

  async enqueueOutbox(item: PersistedOutboxItem): Promise<void> {
    this.requireDatabase()
      .prepare(
        `INSERT OR IGNORE INTO outbox
          (id, kind, payload, attempts, created_at, next_attempt_at, last_error)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        item.kind,
        JSON.stringify(item.payload),
        item.attempts,
        item.createdAt,
        item.nextAttemptAt,
        item.lastError ?? null,
      );
  }

  listDueOutbox(now = new Date().toISOString(), limit = 50): PersistedOutboxItem[] {
    const rows = this.requireDatabase()
      .prepare(
        `SELECT id, kind, payload, attempts, created_at, next_attempt_at, last_error
         FROM outbox WHERE next_attempt_at <= ? ORDER BY created_at LIMIT ?`,
      )
      .all(now, limit) as Array<Record<string, unknown>>;
    return rows.flatMap((row) => {
      if (row.kind !== "reply_text" || typeof row.payload !== "string") return [];
      try {
        const payload = JSON.parse(row.payload) as PersistedOutboxItem["payload"];
        return [
          {
            id: String(row.id),
            kind: "reply_text" as const,
            payload,
            attempts: Number(row.attempts),
            createdAt: String(row.created_at),
            nextAttemptAt: String(row.next_attempt_at),
            ...(typeof row.last_error === "string" ? { lastError: row.last_error } : {}),
          },
        ];
      } catch {
        return [];
      }
    });
  }

  async markOutboxSent(id: string): Promise<void> {
    this.requireDatabase().prepare("DELETE FROM outbox WHERE id = ?").run(id);
  }

  async markOutboxFailed(id: string, error: string): Promise<void> {
    const row = this.requireDatabase()
      .prepare("SELECT attempts FROM outbox WHERE id = ?")
      .get(id) as { attempts?: number } | undefined;
    if (!row) return;
    const attempts = (row.attempts ?? 0) + 1;
    const delayMs = Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6));
    this.requireDatabase()
      .prepare(
        "UPDATE outbox SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?",
      )
      .run(attempts, new Date(Date.now() + delayMs).toISOString(), error.slice(0, 1_000), id);
  }

  async appendAudit(event: AuditEvent): Promise<void> {
    this.requireDatabase()
      .prepare(
        `INSERT INTO audit_log
          (occurred_at, actor_id, action, resource_type, resource_id, outcome, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.occurredAt,
        event.actorId,
        event.action.slice(0, 120),
        event.resourceType,
        event.resourceId.slice(0, 500),
        event.outcome,
        event.detail?.slice(0, 2_000) ?? null,
      );
    this.requireDatabase().exec(
      "DELETE FROM audit_log WHERE id NOT IN (SELECT id FROM audit_log ORDER BY id DESC LIMIT 5000)",
    );
  }

  listAudit(limit = 20, actorId?: string): AuditEvent[] {
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    const rows = actorId
      ? this.requireDatabase()
          .prepare(
            `SELECT id, occurred_at, actor_id, action, resource_type, resource_id, outcome, detail
             FROM audit_log WHERE actor_id = ? ORDER BY id DESC LIMIT ?`,
          )
          .all(actorId, safeLimit)
      : this.requireDatabase()
          .prepare(
            `SELECT id, occurred_at, actor_id, action, resource_type, resource_id, outcome, detail
             FROM audit_log ORDER BY id DESC LIMIT ?`,
          )
          .all(safeLimit);
    return (rows as Array<Record<string, unknown>>).map((row) => ({
      id: Number(row.id),
      occurredAt: String(row.occurred_at),
      actorId: String(row.actor_id),
      action: String(row.action),
      resourceType: String(row.resource_type) as AuditEvent["resourceType"],
      resourceId: String(row.resource_id),
      outcome: String(row.outcome) as AuditEvent["outcome"],
      ...(typeof row.detail === "string" ? { detail: row.detail } : {}),
    }));
  }

  async flush(): Promise<void> {
    if (!this.database) return;
    this.database.exec("PRAGMA wal_checkpoint(PASSIVE)");
  }

  close(): void {
    if (!this.database) return;
    this.database.close();
    this.database = null;
  }

  private async persist(): Promise<void> {
    const database = this.requireDatabase();
    database.exec("BEGIN IMMEDIATE");
    try {
      database
        .prepare(
          `INSERT INTO bridge_state (id, version, payload, updated_at)
           VALUES (1, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             version = excluded.version,
             payload = excluded.payload,
             updated_at = excluded.updated_at`,
        )
        .run(this.state.version, JSON.stringify(this.state), new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  private requireDatabase(): DatabaseSync {
    if (!this.database) throw new Error("StateStore.load() must be called first");
    return this.database;
  }
}

async function ensurePrivateDatabasePath(databaseFile: string): Promise<void> {
  if (databaseFile === ":memory:") return;
  const directory = path.dirname(databaseFile);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const handle = await open(databaseFile, "a", 0o600);
  await handle.close();
  await chmod(databaseFile, 0o600);
}

async function secureSqliteFiles(databaseFile: string): Promise<void> {
  if (databaseFile === ":memory:") return;
  await Promise.all(
    [databaseFile, `${databaseFile}-wal`, `${databaseFile}-shm`].map(async (file) => {
      try {
        await chmod(file, 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }),
  );
}

function databaseUserVersion(database: DatabaseSync): number {
  const row = database.prepare("PRAGMA user_version").get() as
    | { user_version?: number }
    | undefined;
  return Number(row?.user_version ?? 0);
}

function databaseObjectCount(database: DatabaseSync): number {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
    .get() as { count?: number } | undefined;
  return Number(row?.count ?? 0);
}

function databaseStateVersion(database: DatabaseSync): number | undefined {
  try {
    const row = database.prepare("SELECT version FROM bridge_state WHERE id = 1").get() as
      | { version?: number }
      | undefined;
    return typeof row?.version === "number" ? row.version : undefined;
  } catch {
    return undefined;
  }
}

function migrateState(value: unknown): PersistedState {
  if (isPersistedState(value)) {
    return {
      ...value,
      tasks: sanitizeTasks(value.tasks),
      projectCards: sanitizeProjectCards(value.projectCards),
      confirmations: sanitizeConfirmations(value.confirmations),
    };
  }
  if (isLegacyV5State(value)) {
    return {
      version: 6,
      threads: value.threads,
      projects: value.projects,
      chats: value.chats,
      seenEvents: value.seenEvents,
      tasks: sanitizeTasks(value.tasks),
      projectCards: sanitizeProjectCards(value.projectCards),
      confirmations: sanitizeConfirmations(value.confirmations),
      preferences: {},
      device: value.device,
    };
  }
  if (isLegacyV4State(value)) {
    return {
      version: 6,
      threads: value.threads,
      projects: value.projects,
      chats: value.chats ?? {},
      seenEvents: value.seenEvents,
      tasks: sanitizeTasks(value.tasks),
      projectCards: sanitizeProjectCards(value.projectCards),
      confirmations: sanitizeConfirmations(value.confirmations ?? {}),
      preferences: {},
      device: { remoteReadyEnabled: false, updatedAt: new Date().toISOString() },
    };
  }
  if (isLegacyV3State(value)) {
    return {
      version: 6,
      threads: value.threads,
      projects: value.projects,
      chats: value.chats ?? {},
      seenEvents: value.seenEvents,
      tasks: sanitizeTasks(value.tasks),
      projectCards: sanitizeProjectCards(value.projectCards),
      confirmations: {},
      preferences: {},
      device: { remoteReadyEnabled: false, updatedAt: new Date().toISOString() },
    };
  }
  if (isLegacyV2State(value)) {
    return {
      ...freshState(),
      threads: value.threads,
      projects: value.projects,
      seenEvents: value.seenEvents,
    };
  }
  if (isLegacyV1State(value)) {
    return { ...freshState(), threads: value.threads, seenEvents: value.seenEvents };
  }
  throw new Error("unsupported state shape");
}

function sanitizeTasks(
  tasks: Record<string, PersistedTaskState | LegacyTaskState>,
): Record<string, PersistedTaskState> {
  return Object.fromEntries(
    Object.entries(tasks).map(([id, task]) => [
      id,
      {
        ...task,
        ownerId: task.ownerId || "legacy",
        controllerId: task.controllerId || task.ownerId || "legacy",
        settings: task.settings ?? { sandboxMode: "workspace-write" },
        attachments: task.attachments.map((attachment) => ({
          kind: attachment.kind,
          path: attachment.path,
          name: attachment.name,
          sizeBytes: attachment.sizeBytes,
        })),
      },
    ]),
  );
}

function sanitizeProjectCards(
  cards: Record<string, PersistedProjectCardState | LegacyProjectCardState>,
): Record<string, PersistedProjectCardState> {
  return Object.fromEntries(
    Object.entries(cards).map(([id, card]) => [id, { ...card, ownerId: card.ownerId || "legacy" }]),
  );
}

function sanitizeConfirmations(
  confirmations: Record<string, PersistedConfirmationState | LegacyConfirmationState>,
): Record<string, PersistedConfirmationState> {
  return Object.fromEntries(
    Object.entries(confirmations).map(([id, confirmation]) => [
      id,
      { ...confirmation, ownerId: confirmation.ownerId || "legacy" },
    ]),
  );
}

function projectChatBindingFromRow(row: Record<string, unknown>): ProjectChatBinding {
  return {
    chatId: String(row.chat_id),
    projectPath: String(row.project_path),
    ownerId: String(row.owner_id),
    name: String(row.name),
    origin: row.origin === "created" ? "created" : "existing",
    membersStatus: projectChatStepStatus(row.members_status),
    membersFingerprint:
      typeof row.members_fingerprint === "string" ? row.members_fingerprint : null,
    workspaceStatus: projectChatStepStatus(row.workspace_status),
    pinStatus: projectChatStepStatus(row.pin_status),
    messageStatus: projectChatStepStatus(row.message_status),
    workspaceCardId: typeof row.workspace_card_id === "string" ? row.workspace_card_id : null,
    workspaceMessageId:
      typeof row.workspace_message_id === "string" ? row.workspace_message_id : null,
    lastErrorStep: isProjectChatSetupStep(row.last_error_step)
      ? row.last_error_step
      : null,
    lastError: typeof row.last_error === "string" ? row.last_error : null,
    lastAttemptAt: typeof row.last_attempt_at === "string" ? row.last_attempt_at : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function projectChatStepStatus(value: unknown): ProjectChatStepStatus {
  return value === "pending" || value === "succeeded" || value === "failed"
    ? value
    : "unknown";
}

function isProjectChatSetupStep(
  value: unknown,
): value is NonNullable<ProjectChatBinding["lastErrorStep"]> {
  return (
    value === "binding" ||
    value === "members" ||
    value === "workspace" ||
    value === "pin" ||
    value === "messages"
  );
}

interface PermissionLeaseRow {
  conversation_key: string;
  owner_id: string;
  project_path: string;
  scope: string;
  thread_id: string | null;
  remaining_uses: number;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

function isPermissionLeaseScope(value: string): value is PermissionLeaseScope {
  return value === "next-task" || value === "timed" || value === "session";
}

function permissionLeaseFromRow(row: PermissionLeaseRow): PermissionLease {
  return {
    conversationKey: row.conversation_key,
    ownerId: row.owner_id,
    projectPath: row.project_path,
    scope: row.scope as PermissionLeaseScope,
    remainingUses: row.remaining_uses,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.thread_id ? { threadId: row.thread_id } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
