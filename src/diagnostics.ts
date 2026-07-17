import { chmod, lstat, mkdir, open, writeFile } from "node:fs/promises";
import { homedir, hostname, platform, release } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { BridgeConfig } from "./config.js";
import { readBridgeHealth, removeBridgeHealth } from "./health-file.js";
import { trimRuntimeLogs } from "./maintenance.js";
import { redactDiagnosticText, safeErrorText } from "./redaction.js";

export interface DoctorCheckResult {
  label: string;
  status: "ok" | "warning" | "failed";
  detail: string;
}

export interface RuntimeRepairResult {
  changed: string[];
  warnings: string[];
}

export async function repairRuntime(config: BridgeConfig): Promise<RuntimeRepairResult> {
  const changed: string[] = [];
  const warnings: string[] = [];
  await ensurePrivateDirectory(config.dataDir, changed, "运行数据目录");
  await ensurePrivateDirectory(path.join(config.dataDir, "log"), changed, "日志目录");

  for (const file of [
    config.databaseFile,
    `${config.databaseFile}-wal`,
    `${config.databaseFile}-shm`,
    config.stateFile,
    path.join(config.dataDir, "bridge-health.json"),
    path.join(config.dataDir, "log", "bridge.log"),
    path.join(config.dataDir, "log", "bridge.error.log"),
  ]) {
    await repairPrivateFile(file, changed, warnings);
  }

  try {
    const health = await readBridgeHealth(config.dataDir);
    if (health && !processIsAlive(health.pid) && Date.now() - Date.parse(health.updatedAt) > 45_000) {
      await removeBridgeHealth(config.dataDir, health.pid);
      changed.push("移除失效的服务健康标记");
    }
  } catch (error) {
    warnings.push(`健康标记未修复：${safeErrorText(error)}`);
  }

  try {
    const trimmed = await trimRuntimeLogs(path.join(config.dataDir, "log"), config.maxLogBytes);
    if (trimmed > 0) changed.push(`轮转 ${trimmed} 个超限日志`);
  } catch (error) {
    warnings.push(`日志轮转失败：${safeErrorText(error)}`);
  }
  return { changed, warnings };
}

export async function createDiagnosticBundle(
  config: BridgeConfig,
  checks: readonly DoctorCheckResult[],
  requestedFile?: string,
): Promise<string> {
  const directory = requestedFile
    ? path.dirname(path.resolve(requestedFile))
    : path.join(config.dataDir, "diagnostics");
  await ensureDiagnosticDirectory(directory);
  const file = requestedFile
    ? path.resolve(requestedFile)
    : path.join(directory, `diagnostic-${timestamp(new Date())}.json`);
  await assertSafeOptionalFile(file);

  const health = await readBridgeHealth(config.dataDir).catch((error) => ({
    unavailable: safeErrorText(error),
  }));
  const database = await databaseSummary(config.databaseFile);
  const logs = {
    stdout: await readTail(path.join(config.dataDir, "log", "bridge.log"), 32 * 1024),
    stderr: await readTail(path.join(config.dataDir, "log", "bridge.error.log"), 32 * 1024),
  };
  const report = sanitizeDiagnosticValue({
    version: 1,
    createdAt: new Date().toISOString(),
    product: "feishu-codex-console",
    runtime: {
      node: process.versions.node,
      platform: `${platform()} ${release()}`,
      hostname: hostname(),
      pid: process.pid,
    },
    config: {
      configVersion: config.configVersion,
      instanceId: config.instanceId,
      dataDir: config.dataDir,
      workdir: config.workdir,
      projectRoots: config.projectRoots,
      sandboxMaximum: config.sandboxMode,
      operatorSandboxMaximum: config.operatorSandboxMode,
      networkEnabled: config.networkAccessEnabled,
      webSearchMode: config.webSearchMode,
      administrators: config.adminSenderIds.size,
      operators: config.allowedSenderIds.size,
      viewers: config.viewerSenderIds.size,
      chatAllowlistEntries: config.allowedChatIds.size,
      projectAclEntries: config.projectAcl.size,
      maxConcurrentTasks: config.maxConcurrentTasks,
    },
    checks,
    health,
    database,
    logs,
  });
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await chmod(file, 0o600);
  return file;
}

async function databaseSummary(file: string): Promise<Record<string, unknown>> {
  try {
    const details = await lstat(file);
    if (!details.isFile() || details.isSymbolicLink()) {
      return { exists: true, error: "unsafe database path" };
    }
    const database = new DatabaseSync(file, { readOnly: true });
    try {
      const integrity = database.prepare("PRAGMA quick_check").get() as
        | { quick_check?: string }
        | undefined;
      const row = database.prepare("SELECT payload FROM bridge_state WHERE id = 1").get() as
        | { payload?: string }
        | undefined;
      const state = row?.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : {};
      const tasks = Object.values((state.tasks as Record<string, { status?: string }>) ?? {});
      const statuses: Record<string, number> = {};
      for (const task of tasks) {
        const status = task.status ?? "unknown";
        statuses[status] = (statuses[status] ?? 0) + 1;
      }
      return {
        exists: true,
        sizeBytes: details.size,
        integrity: integrity?.quick_check ?? "unknown",
        stateVersion: state.version ?? "unknown",
        taskStatuses: statuses,
      };
    } finally {
      database.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
    return { exists: true, error: safeErrorText(error) };
  }
}

async function readTail(file: string, maxBytes: number): Promise<string> {
  try {
    const details = await lstat(file);
    if (!details.isFile() || details.isSymbolicLink()) return "[unsafe log path]";
    const length = Math.min(details.size, maxBytes);
    const buffer = Buffer.alloc(length);
    const handle = await open(file, "r");
    try {
      await handle.read(buffer, 0, length, Math.max(0, details.size - length));
    } finally {
      await handle.close();
    }
    return buffer.toString("utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    return `[unavailable: ${safeErrorText(error)}]`;
  }
}

async function ensurePrivateDirectory(
  directory: string,
  changed: string[],
  label: string,
): Promise<void> {
  let created = false;
  try {
    const details = await lstat(directory);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error(`${label}不是安全的普通目录：${directory}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    created = true;
  }
  const details = await lstat(directory);
  if ((details.mode & 0o777) !== 0o700) {
    await chmod(directory, 0o700);
    changed.push(`修复 ${label} 权限为 0700`);
  } else if (created) {
    changed.push(`创建${label}`);
  }
}

async function repairPrivateFile(
  file: string,
  changed: string[],
  warnings: string[],
): Promise<void> {
  try {
    const details = await lstat(file);
    if (!details.isFile() || details.isSymbolicLink()) {
      warnings.push(`跳过不安全路径：${file}`);
      return;
    }
    if ((details.mode & 0o777) !== 0o600) {
      await chmod(file, 0o600);
      changed.push(`修复 ${path.basename(file)} 权限为 0600`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      warnings.push(`无法检查 ${path.basename(file)}：${safeErrorText(error)}`);
    }
  }
}

async function ensureDiagnosticDirectory(directory: string): Promise<void> {
  try {
    const details = await lstat(directory);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error(`诊断目录不是安全的普通目录：${directory}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  await chmod(directory, 0o700);
}

async function assertSafeOptionalFile(file: string): Promise<void> {
  try {
    const details = await lstat(file);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new Error(`诊断文件路径不安全：${file}`);
    }
    throw new Error(`诊断文件已存在，请选择新路径：${file}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function sanitizeDiagnosticValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactDiagnosticText(value, { homeDirectory: homedir(), maxChars: 64_000 });
  }
  if (Array.isArray(value)) return value.map(sanitizeDiagnosticValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        sanitizeDiagnosticValue(entry),
      ]),
    );
  }
  return value;
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

function timestamp(value: Date): string {
  return value.toISOString().replace(/[:.]/g, "-");
}
