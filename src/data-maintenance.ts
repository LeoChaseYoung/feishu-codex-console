import "dotenv/config";

import { loadConfig } from "./config.js";
import { safeErrorText } from "./redaction.js";
import {
  createRuntimeBackup,
  listRuntimeBackups,
  restoreRuntimeBackup,
} from "./state-backup.js";

interface Options {
  backup?: string;
  reason?: string;
  yes: boolean;
}

async function main(): Promise<void> {
  const action = process.argv[2] ?? "list";
  const options = parseOptions(process.argv.slice(3));
  const config = loadConfig();

  if (action === "backup") {
    const snapshot = await createRuntimeBackup(config.databaseFile, {
      reason: options.reason ?? "manual",
    });
    console.log("运行数据备份完成");
    console.log(`备份 ID：${snapshot.id}`);
    console.log(`位置：${snapshot.directory}`);
    console.log(`校验：SHA-256 ${snapshot.manifest.database.sha256}`);
    return;
  }

  if (action === "list") {
    const backups = await listRuntimeBackups(config.databaseFile);
    console.log(`可用运行数据备份（${backups.length}）`);
    for (const snapshot of backups) {
      console.log(
        `${snapshot.id} · ${snapshot.manifest.reason} · ${snapshot.manifest.database.bytes} bytes · schema ${snapshot.manifest.database.sqliteUserVersion}`,
      );
    }
    if (backups.length === 0) console.log("暂无备份。先运行 feishu-codex-bridge backup。");
    return;
  }

  if (action === "rollback") {
    if (!options.backup) throw new Error("rollback 需要 --backup <备份 ID>");
    if (!options.yes) {
      throw new Error("回滚会替换当前运行数据库；确认服务已停止后，添加 --yes 执行");
    }
    const result = await restoreRuntimeBackup(
      config.databaseFile,
      config.dataDir,
      options.backup,
    );
    console.log(`已恢复备份：${result.restored.id}`);
    if (result.safetyBackup) {
      console.log(`回滚前状态已另存为：${result.safetyBackup.id}`);
    }
    console.log("下一步：启动服务并运行 doctor，确认状态和连接正常。");
    return;
  }

  throw new Error(`未知数据维护命令：${action}`);
}

function parseOptions(args: string[]): Options {
  const options: Options = { yes: false };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--yes") {
      options.yes = true;
      continue;
    }
    if (value === "--backup" || value === "--reason") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`${value} 缺少值`);
      if (value === "--backup") options.backup = next;
      else options.reason = next;
      index += 1;
      continue;
    }
    throw new Error(`无法识别数据维护参数：${value}`);
  }
  return options;
}

void main().catch((error) => {
  console.error(`数据维护失败：${safeErrorText(error)}`);
  process.exitCode = 1;
});
