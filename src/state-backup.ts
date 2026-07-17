import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

import { readBridgeHealth } from "./health-file.js";

export const BACKUP_FORMAT_VERSION = 1;
export const DEFAULT_BACKUP_RETENTION = 10;

export interface RuntimeBackupManifest {
  formatVersion: 1;
  id: string;
  createdAt: string;
  reason: string;
  database: {
    file: "state.sqlite";
    bytes: number;
    sha256: string;
    integrity: string;
    sqliteUserVersion: number;
    stateVersion?: number;
  };
}

export interface RuntimeBackup {
  id: string;
  directory: string;
  databaseFile: string;
  manifestFile: string;
  manifest: RuntimeBackupManifest;
}

export interface CreateRuntimeBackupOptions {
  reason?: string;
  now?: Date;
  retention?: number;
  protectedIds?: readonly string[];
}

export async function createRuntimeBackup(
  databaseFile: string,
  options: CreateRuntimeBackupOptions = {},
): Promise<RuntimeBackup> {
  await assertRegularFile(databaseFile, "状态数据库");
  const source = new DatabaseSync(databaseFile, { readOnly: true });
  try {
    return await createRuntimeBackupFromDatabase(source, databaseFile, options);
  } finally {
    source.close();
  }
}

export async function createRuntimeBackupFromDatabase(
  source: DatabaseSync,
  databaseFile: string,
  options: CreateRuntimeBackupOptions = {},
): Promise<RuntimeBackup> {
  const integrity = quickCheck(source);
  if (integrity !== "ok") throw new Error(`状态数据库完整性检查失败：${integrity}`);

  const backupRoot = runtimeBackupRoot(databaseFile);
  await ensurePrivateDirectory(backupRoot);
  const now = options.now ?? new Date();
  const reason = normalizeReason(options.reason ?? "manual");
  const id = `${timestamp(now)}-${reason}-${process.pid}`;
  const directory = path.join(backupRoot, id);
  await mkdir(directory, { mode: 0o700 });
  await chmod(directory, 0o700);
  const databaseTarget = path.join(directory, "state.sqlite");
  const manifestFile = path.join(directory, "manifest.json");

  try {
    await backup(source, databaseTarget);
    await chmod(databaseTarget, 0o600);
    const verified = inspectDatabase(databaseTarget);
    if (verified.integrity !== "ok") {
      throw new Error(`备份完整性检查失败：${verified.integrity}`);
    }
    const details = await lstat(databaseTarget);
    const manifest: RuntimeBackupManifest = {
      formatVersion: BACKUP_FORMAT_VERSION,
      id,
      createdAt: now.toISOString(),
      reason,
      database: {
        file: "state.sqlite",
        bytes: details.size,
        sha256: await sha256File(databaseTarget),
        integrity: verified.integrity,
        sqliteUserVersion: verified.sqliteUserVersion,
        ...(verified.stateVersion === undefined ? {} : { stateVersion: verified.stateVersion }),
      },
    };
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await chmod(manifestFile, 0o600);
    const result = { id, directory, databaseFile: databaseTarget, manifestFile, manifest };
    await pruneRuntimeBackups(databaseFile, options.retention ?? DEFAULT_BACKUP_RETENTION, [
      id,
      ...(options.protectedIds ?? []),
    ]);
    return result;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function listRuntimeBackups(databaseFile: string): Promise<RuntimeBackup[]> {
  const root = runtimeBackupRoot(databaseFile);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const backups = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => readRuntimeBackup(path.join(root, entry.name)).catch(() => null)),
  );
  return backups
    .filter((entry): entry is RuntimeBackup => entry !== null)
    .sort((left, right) => right.manifest.createdAt.localeCompare(left.manifest.createdAt));
}

export async function resolveRuntimeBackup(
  databaseFile: string,
  selector: string,
): Promise<RuntimeBackup> {
  if (!selector || selector.includes("/") || selector.includes("\\") || selector === "." || selector === "..") {
    throw new Error("备份标识无效");
  }
  const directory = path.join(runtimeBackupRoot(databaseFile), selector);
  const resolved = await readRuntimeBackup(directory);
  if (resolved.id !== selector) throw new Error("备份清单与目录不匹配");
  return resolved;
}

export async function restoreRuntimeBackup(
  databaseFile: string,
  dataDir: string,
  selector: string,
): Promise<{ restored: RuntimeBackup; safetyBackup?: RuntimeBackup }> {
  await assertBridgeStopped(dataDir);
  const selected = await resolveRuntimeBackup(databaseFile, selector);
  await verifyRuntimeBackup(selected);
  let safetyBackup: RuntimeBackup | undefined;
  try {
    await assertRegularFile(databaseFile, "当前状态数据库");
    safetyBackup = await createRuntimeBackup(databaseFile, {
      reason: "before-rollback",
      protectedIds: [selected.id],
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await restoreRuntimeBackupFile(selected.databaseFile, databaseFile);
  return { restored: selected, ...(safetyBackup ? { safetyBackup } : {}) };
}

export async function restoreRuntimeBackupFile(
  backupDatabaseFile: string,
  databaseFile: string,
): Promise<void> {
  await assertRegularFile(backupDatabaseFile, "备份数据库");
  const inspected = inspectDatabase(backupDatabaseFile);
  if (inspected.integrity !== "ok") {
    throw new Error(`拒绝恢复损坏的备份：${inspected.integrity}`);
  }
  await ensurePrivateDirectory(path.dirname(databaseFile));
  const staging = `${databaseFile}.restore-${process.pid}-${Date.now()}`;
  const movedSidecars: Array<{ original: string; temporary: string }> = [];
  let swapped = false;
  try {
    await copyFile(backupDatabaseFile, staging);
    await chmod(staging, 0o600);
    const staged = inspectDatabase(staging);
    if (staged.integrity !== "ok") throw new Error(`恢复暂存文件损坏：${staged.integrity}`);
    for (const suffix of ["-wal", "-shm"]) {
      const original = `${databaseFile}${suffix}`;
      try {
        const details = await lstat(original);
        if (!details.isFile() || details.isSymbolicLink()) {
          throw new Error(`SQLite 辅助文件路径不安全：${original}`);
        }
        const temporary = `${original}.before-restore-${process.pid}-${Date.now()}`;
        await rename(original, temporary);
        movedSidecars.push({ original, temporary });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await rename(staging, databaseFile);
    swapped = true;
    await chmod(databaseFile, 0o600);
  } catch (error) {
    if (!swapped) {
      for (const sidecar of movedSidecars.toReversed()) {
        await rename(sidecar.temporary, sidecar.original).catch(() => undefined);
      }
    }
    throw error;
  } finally {
    await rm(staging, { force: true });
    if (swapped) {
      await Promise.all(
        movedSidecars.map((sidecar) => rm(sidecar.temporary, { force: true })),
      );
    }
  }
}

export function runtimeBackupRoot(databaseFile: string): string {
  return path.join(path.dirname(path.resolve(databaseFile)), "backups");
}

async function readRuntimeBackup(directory: string): Promise<RuntimeBackup> {
  const details = await lstat(directory);
  if (!details.isDirectory() || details.isSymbolicLink()) throw new Error("备份目录不安全");
  const manifestFile = path.join(directory, "manifest.json");
  const databaseFile = path.join(directory, "state.sqlite");
  await assertRegularFile(manifestFile, "备份清单");
  await assertRegularFile(databaseFile, "备份数据库");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as RuntimeBackupManifest;
  if (
    manifest.formatVersion !== BACKUP_FORMAT_VERSION ||
    typeof manifest.id !== "string" ||
    typeof manifest.createdAt !== "string" ||
    typeof manifest.reason !== "string" ||
    manifest.database?.file !== "state.sqlite" ||
    typeof manifest.database.sha256 !== "string"
  ) {
    throw new Error("备份清单格式不受支持");
  }
  return { id: manifest.id, directory, databaseFile, manifestFile, manifest };
}

async function verifyRuntimeBackup(item: RuntimeBackup): Promise<void> {
  const digest = await sha256File(item.databaseFile);
  if (digest !== item.manifest.database.sha256) throw new Error("备份校验和不匹配");
  const inspected = inspectDatabase(item.databaseFile);
  if (inspected.integrity !== "ok") throw new Error(`备份数据库损坏：${inspected.integrity}`);
}

async function pruneRuntimeBackups(
  databaseFile: string,
  retention: number,
  protectedIds: readonly string[] = [],
): Promise<void> {
  const safeRetention = Math.max(1, Math.min(100, Math.trunc(retention)));
  const backups = await listRuntimeBackups(databaseFile);
  const protectedSet = new Set(protectedIds);
  const protectedBackups = backups.filter((entry) => protectedSet.has(entry.id));
  const keep = new Set([
    ...protectedBackups.map((entry) => entry.id),
    ...backups
      .filter((entry) => !protectedSet.has(entry.id))
      .slice(0, Math.max(0, safeRetention - protectedBackups.length))
      .map((entry) => entry.id),
  ]);
  for (const stale of backups.filter((entry) => !keep.has(entry.id))) {
    await rm(stale.directory, { recursive: true, force: true });
  }
}

async function assertBridgeStopped(dataDir: string): Promise<void> {
  const health = await readBridgeHealth(dataDir).catch(() => null);
  if (!health) return;
  if (processIsAlive(health.pid)) {
    throw new Error(`后台服务仍在运行（PID ${health.pid}），请先停止服务再回滚`);
  }
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  try {
    const details = await lstat(directory);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error(`目录路径不安全：${directory}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  await chmod(directory, 0o700);
}

async function assertRegularFile(file: string, label: string): Promise<void> {
  const details = await lstat(file);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error(`${label}路径不安全：${file}`);
}

function inspectDatabase(file: string): {
  integrity: string;
  sqliteUserVersion: number;
  stateVersion?: number;
} {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = quickCheck(database);
    const userVersion = database.prepare("PRAGMA user_version").get() as
      | { user_version?: number }
      | undefined;
    let stateVersion: number | undefined;
    try {
      const row = database.prepare("SELECT version FROM bridge_state WHERE id = 1").get() as
        | { version?: number }
        | undefined;
      if (typeof row?.version === "number") stateVersion = row.version;
    } catch {
      // A pre-schema database can still be backed up and restored.
    }
    return {
      integrity,
      sqliteUserVersion: Number(userVersion?.user_version ?? 0),
      ...(stateVersion === undefined ? {} : { stateVersion }),
    };
  } finally {
    database.close();
    // Opening a WAL-mode snapshot for a read-only integrity check can create
    // empty -wal/-shm helpers. They are not part of the backup format and must
    // not be mistaken for additional restore inputs.
    rmSync(`${file}-wal`, { force: true });
    rmSync(`${file}-shm`, { force: true });
  }
}

function quickCheck(database: DatabaseSync): string {
  const row = database.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
  return row?.quick_check ?? "unknown";
}

async function sha256File(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function normalizeReason(value: string): string {
  const normalized = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || "manual";
}

function timestamp(value: Date): string {
  return value.toISOString().replace(/[:.]/g, "-");
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
