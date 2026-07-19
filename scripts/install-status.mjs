import { homedir } from "node:os";
import path from "node:path";

import { readEnvFile } from "./config-file.mjs";
import { detectExistingInstallation } from "./install-detection.mjs";
import { loadInstallState } from "./install-state.mjs";
import { readServiceHealth, validateServiceHealth } from "./service-health.mjs";
import { defaultSetupPaths, normalizeInstanceId } from "./setup-lib.mjs";

export async function inspectInstallStatus({
  configFile,
  instanceId = "default",
  platform = process.platform,
  homeDir = homedir(),
  uid = typeof process.getuid === "function" ? process.getuid() : 0,
  run,
  processAlive,
}) {
  const requestedInstance = normalizeInstanceId(instanceId);
  const requestedPaths = defaultSetupPaths(requestedInstance, homeDir);
  const resolvedConfigFile = path.resolve(configFile ?? requestedPaths.configFile);
  let existing = {};
  let configReadable = true;
  try {
    existing = await readEnvFile(resolvedConfigFile);
  } catch {
    configReadable = false;
  }
  const resolvedInstance = normalizeInstanceId(existing.BRIDGE_INSTANCE_ID ?? requestedInstance);
  const resolvedPaths = defaultSetupPaths(resolvedInstance, homeDir);
  const dataDir = path.resolve(existing.BRIDGE_DATA_DIR ?? resolvedPaths.dataDir);
  let installState = null;
  let installStateReadable = true;
  try {
    installState = await loadInstallState(resolvedConfigFile);
  } catch {
    installStateReadable = false;
  }
  const detected = await detectExistingInstallation({
    configFile: resolvedConfigFile,
    dataDir,
    instanceId: resolvedInstance,
    platform,
    homeDir,
    uid,
    ...(run ? { run } : {}),
  });

  let healthValidation = {
    ok: false,
    reason: detected.health.exists ? "健康文件无法读取" : "尚未生成健康文件",
  };
  let readyConsumers = 0;
  let totalConsumers = 0;
  if (detected.health.exists) {
    try {
      const health = await readServiceHealth(dataDir);
      const consumers = Array.isArray(health.consumers) ? health.consumers : [];
      totalConsumers = consumers.length;
      readyConsumers = consumers.filter((consumer) => consumer?.ready === true).length;
      healthValidation = validateServiceHealth(health, {
        instanceId: resolvedInstance,
        configFile: resolvedConfigFile,
        ...(processAlive ? { processAlive } : {}),
      });
    } catch {
      healthValidation = { ok: false, reason: "健康文件无法安全读取" };
    }
  }

  const serviceReady = configReadable
    && installStateReadable
    && !detected.config.unsafe
    && !detected.data.unsafe
    && detected.service.running
    && healthValidation.ok;
  const phase = installState?.status
    ?? (serviceReady ? "service_running" : detected.config.exists ? "config_present" : "not_started");
  const report = {
    contractVersion: 1,
    product: "feishu-codex-console",
    instanceId: resolvedInstance,
    phase,
    ready: serviceReady,
    testCardDelivered: Boolean(installState?.completedSteps?.includes("test_card_delivered")),
    hasRecordedError: Boolean(installState?.lastError),
    config: {
      path: resolvedConfigFile,
      exists: detected.config.exists,
      safe: configReadable && !detected.config.unsafe,
    },
    data: {
      path: dataDir,
      exists: detected.data.exists,
      safe: !detected.data.unsafe,
    },
    installStateReadable,
    service: {
      manager: detected.service.manager,
      name: detected.service.name,
      installed: detected.service.installed,
      running: detected.service.running,
    },
    health: {
      exists: detected.health.exists,
      status: detected.health.status ?? "missing",
      valid: healthValidation.ok,
      reason: healthValidation.reason,
      updatedAt: detected.health.updatedAt ?? null,
      readyConsumers,
      totalConsumers,
    },
  };
  return {
    ...report,
    nextAction: nextInstallAction(report),
  };
}

export function nextInstallAction(report) {
  if (!report.config.safe || !report.data.safe) {
    return {
      code: "repair_unsafe_config",
      requiresUserAction: true,
      instruction: "配置或运行数据路径不安全；停止安装并在本机修复普通文件/目录或符号链接。",
    };
  }
  if (!report.installStateReadable) {
    return {
      code: "repair_install_state",
      requiresUserAction: true,
      instruction: "安装检查点无法安全读取；停止自动恢复并在本机检查私有安装状态文件。",
    };
  }
  if (!report.config.exists) {
    return {
      code: "run_init",
      requiresUserAction: false,
      instruction: "运行交互式初始化向导。",
      command: "feishu-codex-console init",
    };
  }
  if (!report.ready) {
    const resume = !["service_running", "test_card_delivered", "completed"].includes(report.phase);
    return {
      code: resume ? "resume_init" : "repair_service",
      requiresUserAction: false,
      instruction: resume
        ? "重新运行初始化向导；它会从已保存的安全检查点继续。"
        : "先运行 doctor，根据失败项修复后重新安装后台服务。",
      command: resume
        ? "feishu-codex-console init"
        : "feishu-codex-console doctor",
    };
  }
  if (!report.testCardDelivered) {
    return {
      code: "verify_feishu",
      requiresUserAction: true,
      instruction: "本地服务已就绪；请在飞书给机器人发送“状态”，收到回复后再判定端到端通过。",
    };
  }
  return {
    code: "ready",
    requiresUserAction: false,
    instruction: "本地服务和安装测试卡均已验证。",
  };
}
