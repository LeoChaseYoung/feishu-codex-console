#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SETUP_PRESETS,
  buildEnvFile,
  defaultSetupPaths,
  normalizeInstanceId,
  splitCsv,
  validateChatIds,
  validateOpenIds,
} from "./setup-lib.mjs";
import { discoverFeishuIdentity } from "./discovery-lib.mjs";
import { detectExistingInstallation } from "./install-detection.mjs";
import { inspectInstallStatus } from "./install-status.mjs";
import { probeFeishuCapabilities } from "./capability-probe.mjs";
import { readEnvFile, writeManagedConfig } from "./config-file.mjs";
import { sendInstallationCard } from "./install-card.mjs";
import { waitForServiceHealth } from "./service-health.mjs";
import { migrateLegacyInstallation } from "./migrate-legacy.mjs";
import {
  loadInstallState,
  recordInstallError,
  recordInstallStep,
} from "./install-state.mjs";
import { assessUpgradeReadiness, parseBackupId } from "./upgrade-lib.mjs";
import { initializeRunbookTemplate } from "./runbook-template.mjs";
import {
  configureFeishuApplication,
  permissionPlan,
} from "./feishu-app-setup.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const commandToken = args[0];
const shorthandCommand =
  commandToken === "--help" || commandToken === "-h"
    ? "help"
    : commandToken === "--version" || commandToken === "-v"
      ? "version"
      : undefined;
if (shorthandCommand) args.shift();
const command = shorthandCommand ?? (args[0] && !args[0].startsWith("-") ? args.shift() : "help");

try {
  const flags = parseFlags(args);
  if (flags.help) printHelp();
  else if (command === "init" || command === "onboard") await initialize(flags);
  else if (command === "migrate") await migrateLegacy(flags);
  else if (command === "discover") await discover(flags);
  else if (command === "configure-feishu" || command === "permissions") {
    await configureFeishu(flags);
  }
  else if (command === "doctor") {
    const status = runProjectCommand("doctor", flags, !flags.json);
    if (flags.json && status !== 0) process.exitCode = status;
  }
  else if (command === "install-status") await printInstallStatus(flags);
  else if (command === "backup") runDataCommand("backup", flags);
  else if (command === "backups") runDataCommand("list", flags);
  else if (command === "rollback") runDataCommand("rollback", flags);
  else if (command === "support-bundle") await generateSupportBundle(flags);
  else if (command === "version" || command === "compatibility") await printVersionInfo(flags);
  else if (command === "init-runbooks") await initializeRunbooks(flags);
  else if (command === "upgrade") await upgradeService(flags);
  else if (command === "start" || command === "install") await installService(flags);
  else if (["status", "stop", "restart"].includes(command)) runServiceCommand(command, flags);
  else if (command === "uninstall") runServiceCommand("uninstall", flags);
  else if (command === "help" || command === "--help" || command === "-h") printHelp();
  else throw new Error(`未知命令：${command}`);
} catch (error) {
  console.error(`\n操作失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function initialize(options) {
  const interactive = process.stdin.isTTY && !options.yes;
  const rl = interactive ? createInterface({ input, output }) : null;
  console.log("\nFeishu Codex Bridge 初始化\n");
  printPrerequisites();
  let configFile;
  let installState;

  try {
    const instanceId = normalizeInstanceId(
      options.instance ?? (await ask(rl, "实例名称", "default")),
    );
    const paths = defaultSetupPaths(instanceId);
    configFile = path.resolve(options.config ?? paths.configFile);
    const existing = await readEnvFile(configFile);
    installState = await loadInstallState(configFile);
    const dataDir = path.resolve(options.dataDir ?? existing.BRIDGE_DATA_DIR ?? paths.dataDir);
    const detectedInstallation = await detectExistingInstallation({
      configFile,
      dataDir,
      instanceId,
    });
    printExistingInstallation(existing, installState, configFile, detectedInstallation);
    if (detectedInstallation.data.unsafe) {
      throw new Error(`运行数据目录不是安全的普通目录：${dataDir}`);
    }
    installState = await recordInstallStep(configFile, installState, "environment_ready", {
      instanceId,
    });
    const preset = await choosePreset(options.preset, rl, inferPreset(existing));
    const workdir = path.resolve(
      options.workdir ??
        (await ask(rl, "默认项目目录", existing.CODEX_WORKDIR ?? process.cwd())),
    );
    await requireDirectory(workdir, "默认项目目录");
    const projectRoots = splitCsv(
      options.projectRoots ??
        (await ask(
          rl,
          "额外项目扫描根目录（逗号分隔，可留空）",
          existing.CODEX_PROJECT_ROOTS ?? "",
        )),
    );
    for (const root of projectRoots) await requireDirectory(path.resolve(root), "项目扫描根目录");

    let capabilityReport;
    if (botIdentityAvailable()) {
      installState = await recordInstallStep(configFile, installState, "feishu_bound");
      capabilityReport = probeFeishuCapabilities(localBinary("lark-cli"), {
        cwd: packageRoot,
      });
      printCapabilityReport(capabilityReport);
      if (!capabilityReport.ok) {
        throw new Error("飞书应用能力检查未通过，请按上方提示修复后重新运行。");
      }
      await maybeConfigureFeishuApplication(options, rl, capabilityReport.projectChatStatus);
      installState = await recordInstallStep(
        configFile,
        installState,
        "capabilities_verified",
      );
    } else if (options.skipFeishuCheck) {
      console.log("! 已显式跳过飞书能力检查；该模式只用于打包测试或离线准备配置。\n");
    } else {
      throw new Error("飞书 Bot 身份不可用，请先运行 npx lark-cli config init --new。");
    }
    const existingOperators = existing.ALLOWED_FEISHU_OPEN_IDS ?? "";
    const discovered = await maybeDiscoverIdentity(
      { ...options, openId: (options.openId ?? existingOperators) || undefined },
      rl,
    );
    const operatorInput = options.openId ?? discovered?.senderId ?? existingOperators;
    const operatorIds = validateOpenIds(
      operatorInput || (await askRequired(rl, "操作者飞书 open_id（多个用逗号分隔）")),
      "操作者 open_id",
    );
    installState = await recordInstallStep(configFile, installState, "identity_discovered", {
      ...(discovered?.chatType ? { chatType: discovered.chatType } : {}),
    });
    const adminDefault = preset === "team" ? "" : operatorIds.join(",");
    let adminInput = options.adminId ?? existing.FEISHU_ADMIN_OPEN_IDS ?? "";
    if (!adminInput) {
      adminInput = preset === "team"
        ? await askRequired(rl, "管理员 open_id（多个用逗号分隔）")
        : await ask(rl, "管理员 open_id", adminDefault);
    }
    const adminIds = validateOpenIds(adminInput || operatorIds, "管理员 open_id");
    const viewerIds = splitCsv(
      options.viewerId ??
        (await ask(rl, "只读成员 open_id（可留空）", existing.FEISHU_VIEWER_OPEN_IDS ?? "")),
    );
    if (viewerIds.length > 0) validateOpenIds(viewerIds, "只读成员 open_id");
    const discoveredGroupChat = discovered?.chatType === "group" ? discovered.chatId : "";
    const chatDefault = [...new Set([
      ...splitCsv(existing.ALLOWED_FEISHU_CHAT_IDS ?? ""),
      ...splitCsv(discoveredGroupChat),
    ])].join(",");
    const chatIds = splitCsv(
      options.chatId ??
        (await ask(rl, "允许的群聊 chat_id（可留空）", chatDefault)),
    );
    validateChatIds(chatIds, "群聊 chat_id");

    if (preset === "power" && !options.allowFullAccess) {
      if (!rl) {
        throw new Error("高级模式需要显式添加 --allow-full-access。 ");
      }
      const confirmation = await askRequired(
        rl,
        "高级模式允许管理员执行本机命令。请输入“我理解风险”继续",
      );
      if (confirmation !== "我理解风险") throw new Error("未确认高级模式风险。");
    }
    installState = await recordInstallStep(configFile, installState, "preferences_confirmed", {
      preset,
    });

    const env = buildEnvFile({
      preset,
      instanceId,
      dataDir,
      operatorIds,
      adminIds,
      viewerIds,
      memberLabelsJson: existing.FEISHU_MEMBER_LABELS_JSON ?? "",
      chatIds,
      workdir,
      projectRoots,
    });
    const writeResult = await writeManagedConfig(configFile, env, {
      forceReset: Boolean(options.forceReset || options.force),
    });
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await chmod(dataDir, 0o700);
    installState = await recordInstallStep(configFile, installState, "config_written", {
      preset,
    });

    console.log(`\n配置已写入：${configFile}`);
    if (writeResult.backupFile) console.log(`旧配置已备份：${writeResult.backupFile}`);
    console.log(`权限预设：${SETUP_PRESETS[preset].label}`);

    if (!botIdentityAvailable()) {
      console.log("\n飞书 Bot 身份尚未配置。请先运行：");
      console.log("  npx lark-cli config init --new");
      console.log("配置完成后重新运行 doctor。");
    }

    const doctorCode = runProjectCommand("doctor", { config: configFile }, false);

    const shouldInstall = doctorCode !== 0 || options.noService
      ? false
      : options.yes || (await confirm(rl, "安装并启动后台服务？", true));
    if (shouldInstall) {
      runServiceCommand("install", { config: configFile });
      const health = await waitForServiceHealth({
        dataDir,
        instanceId,
        configFile,
        timeoutMs: parseDurationMs(options.healthTimeout ?? "30s", "--health-timeout"),
      });
      console.log(`✓ 后台服务健康：PID ${health.pid}，飞书事件连接 ${health.consumers.length} 个`);
      console.log(`✓ 后台服务配置一致：${health.configFile}`);
      installState = await recordInstallStep(configFile, installState, "service_running", {
        serviceInstalled: true,
      });
      if (options.noTestCard) {
        installState = await recordInstallStep(configFile, installState, "completed", {
          serviceInstalled: true,
          testCardDisabled: true,
        });
      } else if (discovered?.messageId) {
        const allowGroupCard = discovered.chatType !== "group"
          || options.sendTestCard
          || (await confirm(rl, "向刚才的群聊发送安装成功测试卡？", false));
        if (allowGroupCard) {
          await sendInstallationCard({
            packageRoot,
            larkCliPath: localBinary("lark-cli"),
            messageId: discovered.messageId,
            ownerId: operatorIds[0],
            instanceId,
            projectName: path.basename(workdir),
            sandboxLabel: sandboxLabelForPreset(preset),
            groupChatStatus: capabilityReport?.projectChatStatus ?? "unknown",
          });
          installState = await recordInstallStep(
            configFile,
            installState,
            "test_card_delivered",
            { serviceInstalled: true },
          );
          installState = await recordInstallStep(configFile, installState, "completed", {
            serviceInstalled: true,
          });
          console.log("安装成功测试卡已发送，端到端连接验证通过。");
        } else {
          console.log("已跳过群聊测试卡；安装状态保留为 service_running。");
        }
      } else {
        console.log("未保留可回复的测试消息，本次未发送测试卡；安装状态保留为 service_running。");
      }
    }
    else if (doctorCode !== 0) {
      installState = await recordInstallError(configFile, installState, "doctor 检查未通过");
      console.log("\n自检尚未通过，已跳过后台服务安装。修复后运行：");
      console.log(`  feishu-codex-bridge doctor --config ${shellQuote(configFile)}`);
      console.log(`  feishu-codex-bridge install --config ${shellQuote(configFile)}`);
    }

    console.log("\n下一步：在飞书中给机器人发送“新手引导”。");
    console.log(`查看状态：feishu-codex-bridge status --config ${shellQuote(configFile)}`);
  } catch (error) {
    if (configFile) await recordInstallError(configFile, installState, error).catch(() => undefined);
    throw error;
  } finally {
    rl?.close();
  }
}

async function discover(options) {
  if (!botIdentityAvailable()) {
    throw new Error("飞书 Bot 身份不可用，请先运行 npx lark-cli config init --new。");
  }
  const timeout = options.timeout ?? "2m";
  console.log(`请在 ${timeout} 内给机器人发送一条消息，正在等待……`);
  const result = await discoverFeishuIdentity(localBinary("lark-cli"), {
    timeout,
    cwd: packageRoot,
  });
  if (!result) throw new Error("等待超时，没有收到用户消息。");
  printDiscoveredIdentity(result);
  console.log(JSON.stringify(result));
}

async function configureFeishu(options) {
  const profile = options.profile ?? options.feature ?? "all";
  const plan = permissionPlan(profile);
  console.log("\n飞书应用一键配置\n");
  console.log(`方案：${plan.label}`);
  console.log(`只会申请本产品需要的 ${plan.scopes.length} 项应用权限，不会开启全部飞书权限。`);
  if (profile === "ordinary-group") {
    console.log("本次只补齐：项目群内无需 @ 机器人的普通消息接收能力。");
  }
  console.log("浏览器将显示本次权限差异；确认前不会修改应用。\n");
  const result = await configureFeishuApplication({
    profile,
    appId: options.appId,
    cliPath: localBinary("lark-cli"),
    cwd: packageRoot,
    timeoutMs: parseDurationMs(options.timeout ?? "10m", "--timeout"),
    openBrowser: !options.noOpen,
    onVerificationUrl(info) {
      console.log(`请在 ${Math.max(1, Math.floor(info.expireIn / 60))} 分钟内确认：`);
      console.log(info.url);
      console.log("\n正在等待飞书确认……");
    },
  });
  console.log(`\n✓ 飞书应用 ${result.appId} 已完成配置确认。`);
  console.log("下一步：若开发者后台显示待发布版本，请完成发布；然后运行 doctor 并在项目群发送一条不 @ 机器人的普通消息。 ");
}

async function maybeConfigureFeishuApplication(options, rl, projectChatStatus) {
  if (projectChatStatus === "ready") return;
  const requested = Boolean(options.configureFeishu);
  const shouldConfigure = requested || Boolean(
    rl && await confirm(
      rl,
      projectChatStatus === "missing"
        ? "检测到项目群权限不完整，立即一键补齐本产品所需权限？"
        : "当前身份无法核验项目群权限，立即用官方确认页一键配置？",
      true,
    ),
  );
  if (!shouldConfigure) {
    console.log("! 已跳过项目群权限配置；私聊与群内 @ 机器人仍可使用。");
    console.log("  稍后修复：feishu-codex-bridge configure-feishu --profile project-chat\n");
    return;
  }
  console.log("\n正在生成飞书官方权限确认页；只申请本产品所需的最小权限……");
  await configureFeishuApplication({
    profile: "project-chat",
    cliPath: localBinary("lark-cli"),
    cwd: packageRoot,
    timeoutMs: parseDurationMs(options.permissionTimeout ?? "10m", "--permission-timeout"),
    openBrowser: !options.noOpen,
    onVerificationUrl(info) {
      console.log(`请在浏览器确认权限差异（链接约 ${Math.max(1, Math.floor(info.expireIn / 60))} 分钟内有效）：`);
      console.log(info.url);
      console.log("正在等待确认……");
    },
  });
  console.log("✓ 权限配置已确认。若飞书提示待发布版本，请完成发布后继续安装。\n");
}

async function migrateLegacy(options) {
  const interactive = process.stdin.isTTY && !options.yes;
  const rl = interactive ? createInterface({ input, output }) : null;
  try {
    const sourceDir = path.resolve(options.from ?? process.cwd());
    console.log("\n迁移旧源码安装\n");
    const result = await migrateLegacyInstallation({
      sourceDir,
      ...(options.sourceConfig ? { sourceConfig: options.sourceConfig } : {}),
      ...(options.config ? { targetConfig: options.config } : {}),
      ...(options.instance ? { instance: options.instance } : {}),
      allowExisting: Boolean(options.force),
    });
    console.log(`✓ 旧配置：${result.sourceConfig}`);
    console.log(`✓ 新配置：${result.targetConfig}`);
    if (result.backupFile) console.log(`✓ 原目标配置备份：${result.backupFile}`);
    console.log(`✓ 继续使用旧运行数据：${result.dataDir}`);
    console.log("旧源码目录和 .env 未被删除，可在新服务验证后自行归档。\n");

    let installState = await loadInstallState(result.targetConfig);
    installState = await recordInstallStep(
      result.targetConfig,
      installState,
      "environment_ready",
      { instanceId: result.instanceId },
    );
    installState = await recordInstallStep(
      result.targetConfig,
      installState,
      "config_written",
      { migration: true },
    );
    const doctorCode = runProjectCommand("doctor", { config: result.targetConfig }, false);
    if (doctorCode !== 0) {
      await recordInstallError(result.targetConfig, installState, "迁移后的 doctor 检查未通过");
      console.log("迁移配置已保留，但自检未通过；修复后重新运行 install。");
      return;
    }
    const shouldInstall = options.yes || (rl ? await confirm(rl, "切换到新后台服务？", true) : false);
    if (!shouldInstall) {
      console.log(`稍后运行：feishu-codex-bridge install --config ${shellQuote(result.targetConfig)}`);
      return;
    }
    await installService({
      config: result.targetConfig,
      healthTimeout: options.healthTimeout ?? "30s",
    });
    installState = await recordInstallStep(
      result.targetConfig,
      installState,
      "service_running",
      { serviceInstalled: true, migration: true },
    );
    await recordInstallStep(result.targetConfig, installState, "completed", {
      serviceInstalled: true,
      migration: true,
      testCardDisabled: true,
    });
    console.log("✓ 迁移完成。旧服务已由安装器替换，旧源码数据仍保留在原位置。");
  } finally {
    rl?.close();
  }
}

async function installService(options) {
  const configFile = resolveConfig(options);
  const existing = await readEnvFile(configFile);
  if (Object.keys(existing).length === 0) {
    throw new Error(`配置文件不存在或为空：${configFile}。请先运行 init。`);
  }
  const instanceId = normalizeInstanceId(existing.BRIDGE_INSTANCE_ID ?? options.instance ?? "default");
  const dataDir = path.resolve(packageRoot, existing.BRIDGE_DATA_DIR ?? "var");
  runServiceCommand("install", { config: configFile });
  const health = await waitForServiceHealth({
    dataDir,
    instanceId,
    configFile,
    timeoutMs: parseDurationMs(options.healthTimeout ?? "30s", "--health-timeout"),
  });
  console.log(`✓ 后台服务健康：PID ${health.pid}，配置 ${health.configFile}`);
  return health;
}

async function generateSupportBundle(options) {
  const configFile = resolveConfig(options);
  const existing = await readEnvFile(configFile);
  if (Object.keys(existing).length === 0) {
    throw new Error(`配置文件不存在或为空：${configFile}。请先运行 init。`);
  }
  const dataDir = path.resolve(packageRoot, existing.BRIDGE_DATA_DIR ?? "var");
  const requested = options.output
    ? path.resolve(options.output)
    : path.join(
        dataDir,
        "diagnostics",
        `support-bundle-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      );
  const status = runProjectCommand(
    "doctor",
    { config: configFile, diagnostics: requested },
    false,
  );
  const details = await stat(requested).catch(() => null);
  if (!details?.isFile()) {
    throw new Error(`诊断未能生成支持包；doctor 退出码 ${status}。`);
  }
  console.log(`✓ 脱敏支持包：${requested}`);
  if (status !== 0) {
    console.log("! 自检仍有失败项；支持包已保留，请先查看上方修复建议。");
  }
}

async function printVersionInfo(options) {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const info = {
    product: manifest.name,
    version: manifest.version,
    node: process.versions.node,
    codex: manifest.dependencies?.["@openai/codex"] ?? "unknown",
    larkCli: manifest.dependencies?.["@larksuite/cli"] ?? "unknown",
    configContract: 1,
    stateContract: 6,
    sqliteSchema: 3,
    platforms: ["macOS LaunchAgent", "Linux systemd user"],
  };
  if (options.json) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  console.log(`${info.product} ${info.version}`);
  console.log(`Node.js ${info.node} · @openai/codex ${info.codex} · @larksuite/cli ${info.larkCli}`);
  console.log(
    `配置 v${info.configContract} · 状态 v${info.stateContract} · SQLite schema v${info.sqliteSchema}`,
  );
  console.log(`平台：${info.platforms.join(" / ")}`);
}

async function printInstallStatus(options) {
  const configFile = resolveConfig(options);
  const report = await inspectInstallStatus({
    configFile,
    instanceId: options.instance ?? "default",
  });
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("Feishu Codex Console 安装状态");
    console.log(`进度：${report.phase}`);
    console.log(`配置：${report.config.exists ? "已写入" : "未创建"} · ${report.config.path}`);
    console.log(
      `服务：${report.ready ? "已就绪" : report.service.running ? "运行但未通过健康检查" : "未就绪"}`,
    );
    console.log(
      `事件连接：${report.health.readyConsumers}/${report.health.totalConsumers} · ${report.health.reason}`,
    );
    console.log(`下一步：${report.nextAction.instruction}`);
    if (report.nextAction.command) console.log(`命令：${report.nextAction.command}`);
  }
  if (!report.ready) process.exitCode = 1;
}

async function initializeRunbooks(options) {
  const projectDir = path.resolve(options.project ?? process.cwd());
  const result = await initializeRunbookTemplate({
    projectDir,
    sourceFile: path.join(packageRoot, ".feishu-codex-runbooks.example.json"),
  });
  if (!result.created) {
    console.log(`运行手册已存在，未覆盖：${result.target}`);
    console.log("请先评审现有模板；删除或改名后可重新初始化。");
    return;
  }
  console.log(`✓ 已创建运行手册：${result.target}`);
  console.log("下一步：评审 prompt 与权限，然后在飞书发送“运行手册”。");
}

async function upgradeService(options) {
  const configFile = resolveConfig(options);
  const existing = await readEnvFile(configFile);
  if (Object.keys(existing).length === 0) {
    throw new Error(`配置文件不存在或为空：${configFile}。请先运行 init。`);
  }
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const dataDir = path.resolve(packageRoot, existing.BRIDGE_DATA_DIR ?? "var");
  const databaseFile = existing.BRIDGE_DATABASE_FILE
    ? path.resolve(packageRoot, existing.BRIDGE_DATABASE_FILE)
    : path.join(dataDir, "state.sqlite");
  const health = await readJsonOptional(path.join(dataDir, "bridge-health.json"));
  const liveHealth = isLiveServiceHealth(health, configFile) ? health : null;
  const databaseActiveTasks = liveHealth ? await countRunningTasks(databaseFile) : 0;
  const readiness = assessUpgradeReadiness({
    currentVersion: health?.productVersion ?? "unknown",
    targetVersion: manifest.version,
    healthActiveTasks: liveHealth?.activeTasks ?? 0,
    databaseActiveTasks,
    allowDowngrade: Boolean(options.allowDowngrade),
    force: Boolean(options.force),
  });

  console.log("\nFeishu Codex Bridge 安全升级\n");
  console.log(`当前服务：${readiness.currentVersion}`);
  console.log(`目标版本：${readiness.targetVersion}`);
  console.log(`运行任务：${Math.max(Number(liveHealth?.activeTasks ?? 0), databaseActiveTasks)}`);
  if (Number(liveHealth?.queuedTasks ?? 0) > 0) {
    console.log(`排队任务：${liveHealth.queuedTasks}（升级后会从 SQLite 恢复）`);
  }
  for (const warning of readiness.warnings) console.log(`! ${warning}`);
  if (!readiness.allowed) {
    if (readiness.upToDate) {
      console.log(`✓ ${readiness.reason}`);
      return;
    }
    throw new Error(readiness.reason);
  }
  if (!options.yes) {
    console.log("\n升级将依次执行：一致性备份 → 新版本自检 → 停止旧服务 → 安装并验证新服务。");
    console.log("未做任何修改。确认后重新运行并添加 --yes。");
    return;
  }

  const backupOutput = runDataCommandCapture("backup", {
    config: configFile,
    reason: `upgrade-to-${manifest.version}`,
  });
  const backupId = parseBackupId(backupOutput);
  if (!backupId) throw new Error("升级备份已执行，但无法读取备份 ID；服务未停止");
  console.log(backupOutput.trim());

  const doctorCode = runProjectCommand("doctor", { config: configFile }, false);
  if (doctorCode !== 0) {
    throw new Error(`新版本自检未通过；备份 ${backupId} 已保留，旧服务未停止`);
  }

  const oldPackageRoot = await validatedPreviousPackageRoot(health);
  let serviceStopped = false;
  try {
    runServiceCommand("stop", { config: configFile });
    serviceStopped = true;
    const nextHealth = await installService({
      config: configFile,
      healthTimeout: options.healthTimeout ?? "45s",
    });
    if (nextHealth.productVersion && nextHealth.productVersion !== manifest.version) {
      throw new Error(
        `新服务报告版本 ${nextHealth.productVersion}，预期 ${manifest.version}`,
      );
    }
    console.log(`✓ 升级完成：${readiness.currentVersion} → ${manifest.version}`);
    console.log(`✓ 升级前备份：${backupId}`);
  } catch (error) {
    if (serviceStopped) {
      try {
        runServiceCommand("stop", { config: configFile });
      } catch {
        // The failed service may already be stopped.
      }
      try {
        const rollbackOutput = runDataCommandCapture("rollback", {
          config: configFile,
          backup: backupId,
          yes: true,
        });
        console.log(rollbackOutput.trim());
      } catch (rollbackError) {
        console.error(`! 自动数据回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
      try {
        if (oldPackageRoot && oldPackageRoot !== packageRoot) {
          installServiceFromPackage(oldPackageRoot, configFile);
          const restoredHealth = await waitForServiceHealth({
            dataDir,
            instanceId: normalizeInstanceId(existing.BRIDGE_INSTANCE_ID ?? "default"),
            configFile,
            timeoutMs: parseDurationMs(options.healthTimeout ?? "45s", "--health-timeout"),
          });
          if (
            readiness.currentVersion !== "unknown" &&
            restoredHealth.productVersion &&
            restoredHealth.productVersion !== readiness.currentVersion
          ) {
            throw new Error(
              `恢复服务报告版本 ${restoredHealth.productVersion}，预期 ${readiness.currentVersion}`,
            );
          }
          console.log(`✓ 已恢复并验证旧服务包：${oldPackageRoot}`);
        } else {
          await installService({
            config: configFile,
            healthTimeout: options.healthTimeout ?? "45s",
          });
          console.log("✓ 已使用当前可用包恢复并验证后台服务。");
        }
      } catch (restoreError) {
        console.error(`! 自动恢复后台服务失败：${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
      }
    }
    throw new Error(
      `升级没有完成，已尝试恢复备份 ${backupId}：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function readJsonOptional(file) {
  try {
    const details = await stat(file);
    if (!details.isFile()) return null;
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function countRunningTasks(databaseFile) {
  const details = await stat(databaseFile).catch(() => null);
  if (!details?.isFile()) return 0;
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(databaseFile, { readOnly: true });
  try {
    const row = database.prepare("SELECT payload FROM bridge_state WHERE id = 1").get();
    const state = row?.payload ? JSON.parse(row.payload) : {};
    return Object.values(state.tasks ?? {}).filter((task) => task?.status === "running").length;
  } finally {
    database.close();
  }
}

function isLiveServiceHealth(health, configFile, now = Date.now()) {
  if (!health || !Number.isSafeInteger(health.pid) || health.pid <= 0) return false;
  if (path.resolve(health.configFile ?? "") !== path.resolve(configFile)) return false;
  const updatedAt = Date.parse(health.updatedAt ?? "");
  if (!Number.isFinite(updatedAt) || Math.abs(now - updatedAt) > 45_000) return false;
  try {
    process.kill(health.pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function validatedPreviousPackageRoot(health) {
  const candidate = health?.packageRoot;
  if (!candidate || !path.isAbsolute(candidate)) return null;
  const manifestFile = path.join(candidate, "package.json");
  const serviceFile = path.join(candidate, "scripts", "service.mjs");
  const [manifestDetails, serviceDetails] = await Promise.all([
    stat(manifestFile).catch(() => null),
    stat(serviceFile).catch(() => null),
  ]);
  if (!manifestDetails?.isFile() || !serviceDetails?.isFile()) return null;
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  if (health.productVersion && manifest.version !== health.productVersion) return null;
  return path.resolve(candidate);
}

function installServiceFromPackage(root, configFile) {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts", "service.mjs"), "install"],
    {
      cwd: root,
      env: { ...process.env, DOTENV_CONFIG_PATH: configFile },
      stdio: "inherit",
    },
  );
  if (result.status !== 0) throw new Error("旧版本后台服务重新安装失败");
}

async function maybeDiscoverIdentity(options, rl) {
  if (options.openId || !rl || !botIdentityAvailable()) return null;
  if (!(await confirm(rl, "发送一条飞书消息，自动识别 open_id 和 chat_id？", true))) {
    return null;
  }
  console.log("请在 2 分钟内给机器人发送一条消息，正在等待……");
  try {
    const result = await discoverFeishuIdentity(localBinary("lark-cli"), {
      timeout: options.discoveryTimeout ?? "2m",
      cwd: packageRoot,
    });
    if (!result) {
      console.log("未收到消息，继续手工填写。");
      return null;
    }
    printDiscoveredIdentity(result);
    return result;
  } catch (error) {
    console.log(`自动识别失败：${error instanceof Error ? error.message : String(error)}`);
    console.log("继续手工填写。");
    return null;
  }
}

function printDiscoveredIdentity(result) {
  console.log(`✓ 已识别用户：${result.senderId}`);
  console.log(`✓ 会话：${result.chatId}（${result.chatType === "group" ? "群聊" : "私聊"}）`);
}

function printPrerequisites() {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  console.log(`${nodeMajor >= 22 ? "✓" : "✗"} Node.js ${process.versions.node}（需要 22+）`);
  if (nodeMajor < 22) throw new Error("Node.js 版本过低，请升级到 22 或更高版本。");
  console.log(`${commandAvailable(localBinary("codex"), ["--version"]) ? "✓" : "!"} Codex CLI`);
  console.log(`${botIdentityAvailable() ? "✓" : "!"} 飞书 Bot 身份`);
}

async function choosePreset(value, rl, fallback = "personal") {
  if (value) {
    if (!SETUP_PRESETS[value]) throw new Error("--preset 支持 personal、team 或 power。");
    return value;
  }
  if (!rl) return fallback;
  console.log("\n权限预设：");
  console.log("  1. 个人安全（推荐）：工作区写入，网络关闭");
  console.log("  2. 团队安全：成员隔离，显式管理员");
  console.log("  3. 高级模式：管理员完全访问，操作者仍为工作区写入");
  const defaultChoice = { personal: "1", team: "2", power: "3" }[fallback] ?? "1";
  const answer = await ask(rl, "选择", defaultChoice);
  return { "1": "personal", "2": "team", "3": "power" }[answer] ?? choosePreset(answer, null);
}

function inferPreset(existing) {
  if (existing.CODEX_SANDBOX_MODE === "danger-full-access") return "power";
  const operators = splitCsv(existing.ALLOWED_FEISHU_OPEN_IDS ?? "");
  const admins = splitCsv(existing.FEISHU_ADMIN_OPEN_IDS ?? "");
  const viewers = splitCsv(existing.FEISHU_VIEWER_OPEN_IDS ?? "");
  if (viewers.length > 0 || admins.some((id) => !operators.includes(id))) return "team";
  return "personal";
}

function printExistingInstallation(existing, state, configFile, detected) {
  if (Object.keys(existing).length === 0 && !state && !detected?.exists) return;
  console.log(`检测到已有安装：${configFile}`);
  if (state?.status) console.log(`上次安装进度：${state.status}`);
  if (detected?.service.installed) {
    console.log(`后台服务：${detected.service.running ? "正在运行" : "已安装但未运行"}（${detected.service.name}）`);
  }
  if (detected?.data.exists) {
    const safety = detected.data.unsafe ? "，路径不安全" : "";
    console.log(`运行数据：${detected.data.entryCount} 项${safety}（${detected.data.path}）`);
  }
  if (detected?.health.exists) {
    console.log(`最近健康状态：${detected.health.status ?? "unknown"}${detected.health.pid ? `（PID ${detected.health.pid}）` : ""}`);
  }
  console.log("已知配置会更新，未知高级配置会保留，并在写入前创建备份。\n");
}

function printCapabilityReport(report) {
  console.log("\n飞书应用能力检查：");
  for (const check of report.checks) {
    const icon = check.ok ? "✓" : check.required === false ? (check.status === "missing" ? "!" : "?") : "✗";
    console.log(`${icon} ${check.label}：${check.detail}`);
    if (!check.ok && check.remediation) console.log(`  修复：${check.remediation}`);
  }
  if (report.projectChatStatus !== "ready") {
    console.log("  说明：项目群能力不会阻止私聊安装；首次创建时会给出精确失败步骤并支持原地重试。");
  }
  console.log("");
}

function sandboxLabelForPreset(preset) {
  return preset === "power" ? "完全访问（管理员）" : "工作区写入";
}

function runProjectCommand(name, options, throwOnFailure = true) {
  const configFile = resolveConfig(options);
  const target = name === "doctor" ? path.join(packageRoot, "dist", "doctor.js") : null;
  if (!target) throw new Error(`未知项目命令：${name}`);
  const commandArgs = ["--disable-warning=ExperimentalWarning", target];
  if (name === "doctor") {
    if (options.fix) commandArgs.push("--fix");
    if (options.diagnostics) commandArgs.push("--diagnostics", path.resolve(options.diagnostics));
    if (options.json) commandArgs.push("--json");
  }
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: packageRoot,
    env: { ...process.env, DOTENV_CONFIG_PATH: configFile },
    stdio: "inherit",
  });
  if (throwOnFailure && result.status !== 0) {
    throw new Error(`${name} 检查未通过，请按上方提示修复。`);
  }
  return result.status ?? 1;
}

function runServiceCommand(action, options) {
  const configFile = resolveConfig(options);
  const result = spawnSync(process.execPath, [path.join(packageRoot, "scripts", "service.mjs"), action], {
    cwd: packageRoot,
    env: { ...process.env, DOTENV_CONFIG_PATH: configFile },
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`后台服务命令 ${action} 执行失败。`);
}

function runDataCommand(action, options) {
  const configFile = resolveConfig(options);
  const commandArgs = [path.join(packageRoot, "dist", "data-maintenance.js"), action];
  if (options.backup) commandArgs.push("--backup", options.backup);
  if (options.reason) commandArgs.push("--reason", options.reason);
  if (options.yes) commandArgs.push("--yes");
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: packageRoot,
    env: { ...process.env, DOTENV_CONFIG_PATH: configFile },
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`数据维护命令 ${action} 执行失败。`);
}

function runDataCommandCapture(action, options) {
  const configFile = resolveConfig(options);
  const commandArgs = [path.join(packageRoot, "dist", "data-maintenance.js"), action];
  if (options.backup) commandArgs.push("--backup", options.backup);
  if (options.reason) commandArgs.push("--reason", options.reason);
  if (options.yes) commandArgs.push("--yes");
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: packageRoot,
    env: { ...process.env, DOTENV_CONFIG_PATH: configFile },
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(
      `数据维护命令 ${action} 执行失败：${result.stderr || result.stdout || "未知错误"}`,
    );
  }
  return result.stdout;
}

function resolveConfig(options) {
  if (options.config) return path.resolve(options.config);
  if (process.env.DOTENV_CONFIG_PATH) return path.resolve(process.env.DOTENV_CONFIG_PATH);
  const sourceConfig = path.join(packageRoot, ".env");
  if (existsSync(sourceConfig)) return sourceConfig;
  const instance = normalizeInstanceId(options.instance ?? "default");
  return defaultSetupPaths(instance).configFile;
}

function botIdentityAvailable() {
  return commandAvailable(localBinary("lark-cli"), ["whoami", "--as", "bot"]);
}

function commandAvailable(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: packageRoot,
    env: process.env,
    stdio: "ignore",
  });
  return result.status === 0;
}

function localBinary(name) {
  return path.join(packageRoot, "node_modules", ".bin", name);
}

async function requireDirectory(directory, label) {
  const details = await stat(directory).catch(() => null);
  if (!details?.isDirectory()) throw new Error(`${label}不存在：${directory}`);
}

async function ask(rl, label, fallback) {
  if (!rl) return fallback;
  const suffix = fallback ? ` [${fallback}]` : "";
  return (await rl.question(`${label}${suffix}：`)).trim() || fallback;
}

async function askRequired(rl, label) {
  if (!rl) throw new Error(`非交互模式缺少：${label}`);
  while (true) {
    const value = (await rl.question(`${label}：`)).trim();
    if (value) return value;
    console.log("该项不能为空。");
  }
}

async function confirm(rl, label, fallback) {
  if (!rl) return fallback;
  const answer = (await rl.question(`${label} ${fallback ? "[Y/n]" : "[y/N]"}：`)).trim().toLowerCase();
  if (!answer) return fallback;
  return answer === "y" || answer === "yes";
}

function parseFlags(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (token === "-h") {
      parsed.help = true;
      continue;
    }
    if (!token?.startsWith("--")) throw new Error(`无法识别参数：${token}`);
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (["yes", "force", "forceReset", "noService", "noTestCard", "sendTestCard", "skipFeishuCheck", "allowFullAccess", "allowDowngrade", "fix", "json", "noOpen", "configureFeishu", "help"].includes(key)) {
      parsed[key] = inlineValue === undefined ? true : inlineValue !== "false";
      continue;
    }
    const value = inlineValue ?? values[++index];
    if (!value || value.startsWith("--")) throw new Error(`参数 --${rawKey} 缺少值。`);
    parsed[key] = value;
  }
  return parsed;
}

function parseDurationMs(value, label) {
  const match = String(value).trim().match(/^(\d+)(ms|s|m)?$/i);
  if (!match) throw new Error(`${label} 需要使用 500ms、30s 或 2m 格式。`);
  const amount = Number.parseInt(match[1], 10);
  const unit = (match[2] ?? "ms").toLowerCase();
  const multiplier = unit === "m" ? 60_000 : unit === "s" ? 1_000 : 1;
  const milliseconds = amount * multiplier;
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new Error(`${label} 必须大于 0。`);
  }
  return milliseconds;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function printHelp() {
  console.log(`Feishu Codex Bridge

用法：
  feishu-codex-bridge init [选项]
  feishu-codex-bridge migrate --from <旧源码目录> [选项]
  feishu-codex-bridge discover [--timeout 2m]
  feishu-codex-bridge configure-feishu [--profile all|core|project-chat|ordinary-group]
  feishu-codex-bridge doctor [--config <文件>] [--fix] [--diagnostics <JSON 文件>] [--json]
  feishu-codex-bridge install-status [--config <文件>] [--json]
  feishu-codex-bridge install|status|stop|restart|uninstall [--config <文件>]
  feishu-codex-bridge backup|backups [--config <文件>]
  feishu-codex-bridge rollback --backup <备份 ID> --yes [--config <文件>]
  feishu-codex-bridge support-bundle [--output <JSON 文件>] [--config <文件>]
  feishu-codex-bridge version [--json]
  feishu-codex-bridge init-runbooks [--project <项目目录>]
  feishu-codex-bridge upgrade [--config <文件>] [--yes] [--allow-downgrade]

初始化选项：
  --preset personal|team|power
  --open-id ou_xxx[,ou_yyy]
  --admin-id ou_xxx[,ou_yyy]
  --viewer-id ou_xxx[,ou_yyy]
  --chat-id oc_xxx[,oc_yyy]
  --workdir <项目目录>
  --project-roots <目录[,目录]>
  --instance <名称>
  --config <配置文件>
  --data-dir <运行数据目录>
  --yes --no-service --no-test-card
  --send-test-card
  --force-reset
  --allow-full-access
  --discovery-timeout 2m
  --health-timeout 30s
  --configure-feishu          初始化时打开官方页面配置项目群最小权限
  --permission-timeout 10m    等待权限确认的时间

飞书应用配置选项：
  --profile all                一键申请本产品所需的最小权限（默认）
  --profile core               只配置私聊、@消息、卡片和附件
  --profile project-chat       只配置项目群能力
  --profile ordinary-group     只补齐群内无需 @ 的普通消息
  --app-id cli_xxx             指定已有应用；默认自动识别当前 Bot
  --timeout 10m                授权链接等待时间
  --no-open                    不自动打开浏览器，只打印确认链接

迁移选项：
  --from <旧源码目录>
  --source-config <旧 .env 文件>
  --config <新配置文件>
  --instance <名称>
  --force（目标已存在时备份并合并）
  --yes（自检通过后切换后台服务）
`);
}
