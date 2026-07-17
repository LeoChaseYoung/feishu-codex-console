import "dotenv/config";

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { loadConfig } from "./config.js";
import {
  createDiagnosticBundle,
  repairRuntime,
  type DoctorCheckResult,
} from "./diagnostics.js";
import { ProjectRegistry } from "./project-registry.js";
import {
  installConsoleRedaction,
  redactDiagnosticText,
  safeErrorText,
} from "./redaction.js";

installConsoleRedaction();

interface DoctorOptions {
  fix: boolean;
  diagnostics?: string;
}

async function main(): Promise<void> {
  const options = parseDoctorOptions(process.argv.slice(2));
  const results: DoctorCheckResult[] = [];
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
    results.push({
      label: "配置",
      status: "ok",
      detail: `${config.sandboxMode} · 并发 ${config.maxConcurrentTasks} · 附件保留 ${config.attachmentRetentionHours} 小时 · 新手引导${config.autoOnboarding ? "自动" : "手动"}`,
    });
    if (config.sandboxMode === "danger-full-access" && config.allowedChatIds.size === 0) {
      results.push({
        label: "群聊门禁",
        status: "warning",
        detail: "完全访问模式未配置聊天白名单；私聊可用，群聊将自动拒绝",
      });
    } else {
      results.push({
        label: "群聊门禁",
        status: "ok",
        detail: config.allowedChatIds.size > 0 ? "已配置聊天白名单" : "当前非完全访问模式",
      });
    }
    results.push({
      label: "团队权限",
      status: "ok",
      detail: `管理员 ${config.adminSenderIds.size} · 操作者 ${config.allowedSenderIds.size} · 只读 ${config.viewerSenderIds.size} · 友好名称 ${config.memberLabels.size} · 群聊按${config.groupSessionScope === "member" ? "成员" : "整群"}隔离`,
    });
    results.push({
      label: "项目 ACL",
      status: config.projectAcl.size > 0 ? "ok" : "warning",
      detail:
        config.projectAcl.size > 0
          ? `已配置 ${config.projectAcl.size} 条项目访问规则`
          : "未配置时，所有授权成员可看到全部已发现项目",
    });
    results.push({
      label: "权限上限",
      status: "ok",
      detail: `管理员 ${config.sandboxMode} · 普通操作者 ${config.operatorSandboxMode}`,
    });
    results.push({
      label: "环境隔离",
      status: "ok",
      detail: `敏感环境变量默认不传给 Codex；额外放行 ${config.codexAllowedEnvVars.length} 个`,
    });
  } catch (error) {
    results.push({ label: "配置", status: "failed", detail: safeErrorText(error) });
    print(results);
    process.exitCode = 1;
    return;
  }

  if (options.fix) {
    try {
      const repair = await repairRuntime(config);
      results.push({
        label: "自动修复",
        status: repair.warnings.length > 0 ? "warning" : "ok",
        detail: [
          repair.changed.length > 0 ? repair.changed.join("；") : "没有发现可自动修复的问题",
          ...repair.warnings,
        ].join("；"),
      });
    } catch (error) {
      results.push({ label: "自动修复", status: "failed", detail: safeErrorText(error) });
    }
  }

  const lark = await run(config.larkCliPath, ["whoami", "--as", "bot"]);
  results.push({
    label: "飞书 Bot",
    status: lark.code === 0 ? "ok" : "failed",
    detail: lark.code === 0 ? "应用身份可用" : "lark-cli Bot 身份不可用",
  });

  const localCodex =
    config.codexCliPath ?? path.join(config.projectDir, "node_modules", ".bin", "codex");
  const codex = await run(localCodex, ["login", "status"]);
  results.push({
    label: "Codex",
    status: codex.code === 0 ? "ok" : "failed",
    detail: codex.code === 0 ? codex.stdout.trim() || "登录态可用" : "本机 Codex 登录态不可用",
  });

  try {
    await access(path.dirname(config.databaseFile));
    results.push({
      label: "可靠状态",
      status: "ok",
      detail: `SQLite WAL · ${path.relative(config.projectDir, config.databaseFile)}`,
    });
  } catch {
    results.push({
      label: "可靠状态",
      status: "warning",
      detail: "数据库目录尚未创建，首次启动时会自动创建",
    });
  }

  if (process.platform === "darwin") {
    try {
      await access("/usr/bin/caffeinate");
      results.push({
        label: "远程就绪",
        status: "ok",
        detail: "macOS caffeinate 可用，可从飞书设备卡开启",
      });
    } catch {
      results.push({
        label: "远程就绪",
        status: "warning",
        detail: "未找到 /usr/bin/caffeinate",
      });
    }
  }

  try {
    await access(config.workdir);
    const registry = new ProjectRegistry(
      config.projectRoots,
      config.workdir,
      config.projectScanDepth,
      config.maxProjects,
      config.syncSavedProjects ? config.codexProjectStateFile : undefined,
    );
    const projects = await registry.refresh();
    results.push({
      label: "项目",
      status: projects.length > 0 ? "ok" : "failed",
      detail: `发现 ${projects.length} 个可用项目`,
    });
  } catch (error) {
    results.push({ label: "项目", status: "failed", detail: safeErrorText(error) });
  }

  if (process.platform === "darwin") {
    const service = await run("launchctl", [
      "print",
      `gui/${process.getuid?.() ?? 0}/${config.serviceLabel}`,
    ]);
    results.push({
      label: "后台守护",
      status: service.code === 0 ? "ok" : "warning",
      detail: service.code === 0 ? "LaunchAgent 正在运行" : "尚未安装，可运行 npm run service:install",
    });
  } else if (process.platform === "linux") {
    const service = await run("systemctl", [
      "--user",
      "is-active",
      `feishu-codex-bridge-${config.instanceId}.service`,
    ]);
    results.push({
      label: "后台守护",
      status: service.code === 0 ? "ok" : "warning",
      detail: service.code === 0 ? "systemd user service 正在运行" : "尚未安装，可运行 npm run service:install",
    });
  }

  if (options.diagnostics) {
    try {
      const diagnosticFile = await createDiagnosticBundle(config, results, options.diagnostics);
      results.push({
        label: "诊断包",
        status: "ok",
        detail: `已生成脱敏诊断包：${diagnosticFile}`,
      });
    } catch (error) {
      results.push({ label: "诊断包", status: "failed", detail: safeErrorText(error) });
    }
  }

  print(results);
  if (results.some((result) => result.status === "failed")) process.exitCode = 1;
}

function run(
  command: string,
  args: string[],
  timeoutMs = 15_000,
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    let settled = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve({ code, stdout });
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(null);
      }, 2_000);
      forceKillTimer.unref();
    }, timeoutMs);
    timeout.unref();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.once("error", () => finish(null));
    child.once("exit", (code) => finish(code));
  });
}

function print(results: DoctorCheckResult[]): void {
  console.log("Feishu Codex Bridge V5 自检");
  for (const result of results) {
    const marker = result.status === "ok" ? "通过" : result.status === "warning" ? "提醒" : "失败";
    console.log(
      `${marker.padEnd(4)} ${result.label}：${redactDiagnosticText(result.detail, {
        homeDirectory: homedir(),
        maxChars: 2_000,
      })}`,
    );
  }
}

function parseDoctorOptions(args: string[]): DoctorOptions {
  const options: DoctorOptions = { fix: false };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--fix") {
      options.fix = true;
      continue;
    }
    if (value === "--diagnostics") {
      const target = args[index + 1];
      if (!target || target.startsWith("--")) {
        throw new Error("--diagnostics 需要指定输出 JSON 文件");
      }
      options.diagnostics = target;
      index += 1;
      continue;
    }
    throw new Error(`无法识别 doctor 参数：${value}`);
  }
  return options;
}

void main().catch((error) => {
  console.error(`doctor 无法启动：${safeErrorText(error)}`);
  process.exitCode = 2;
});
