import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

export const BRIDGE_HEALTH_FILE = "bridge-health.json";

export function serviceHealthPath(dataDir) {
  return path.join(dataDir, BRIDGE_HEALTH_FILE);
}

export async function readServiceHealth(dataDir) {
  const file = serviceHealthPath(dataDir);
  const details = await lstat(file);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`服务健康文件不安全：${file}`);
  }
  return JSON.parse(await readFile(file, "utf8"));
}

export function validateServiceHealth(
  health,
  {
    instanceId,
    configFile,
    now = Date.now(),
    maxHeartbeatAgeMs = 45_000,
    processAlive = isProcessAlive,
  },
) {
  if (!health || typeof health !== "object" || Array.isArray(health)) {
    return invalid("健康文件格式无效");
  }
  if (health.version !== 1) return invalid("健康文件版本不受支持");
  if (health.status !== "ready") {
    return invalid(`服务尚未就绪（当前状态：${String(health.status ?? "unknown")}）`);
  }
  if (health.instanceId !== instanceId) {
    return invalid(`服务实例不一致（期望 ${instanceId}，实际 ${String(health.instanceId)}）`);
  }
  if (!Number.isSafeInteger(health.pid) || health.pid <= 0 || !processAlive(health.pid)) {
    return invalid("健康文件对应的后台进程不存在");
  }
  if (typeof health.configFile !== "string" || health.configFile.length === 0) {
    return invalid("后台服务没有报告配置文件路径");
  }
  if (path.resolve(health.configFile) !== path.resolve(configFile)) {
    return invalid(
      `后台服务读取了另一份配置（期望 ${path.resolve(configFile)}，实际 ${path.resolve(health.configFile)}）`,
    );
  }
  const updatedAt = Date.parse(health.updatedAt);
  if (!Number.isFinite(updatedAt)) return invalid("健康时间戳无效");
  if (now - updatedAt > maxHeartbeatAgeMs) return invalid("后台服务健康心跳已过期");
  if (updatedAt - now > 5_000) return invalid("后台服务健康时间戳来自未来");
  if (!Array.isArray(health.consumers) || health.consumers.length < 2) {
    return invalid("飞书事件消费者尚未完整启动");
  }
  if (health.consumers.some((consumer) => !consumer || consumer.ready !== true)) {
    return invalid("至少一个飞书事件消费者尚未就绪");
  }
  return { ok: true, reason: "服务健康且配置一致" };
}

export async function waitForServiceHealth({
  dataDir,
  instanceId,
  configFile,
  timeoutMs = 30_000,
  pollIntervalMs = 250,
  processAlive,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastReason = "尚未生成健康文件";
  while (Date.now() <= deadline) {
    try {
      const health = await readServiceHealth(dataDir);
      const validation = validateServiceHealth(health, {
        instanceId,
        configFile,
        ...(processAlive ? { processAlive } : {}),
      });
      if (validation.ok) return health;
      lastReason = validation.reason;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        lastReason = error instanceof Error ? error.message : String(error);
      }
    }
    await delay(pollIntervalMs);
  }
  throw new Error(
    `后台服务在 ${Math.ceil(timeoutMs / 1_000)} 秒内未就绪：${lastReason}。请查看服务日志后重新运行安装。`,
  );
}

function invalid(reason) {
  return { ok: false, reason };
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
