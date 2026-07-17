import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const action = process.argv[2] ?? "status";
const script =
  process.platform === "darwin"
    ? path.join(scriptsDir, "launchd.mjs")
    : process.platform === "linux"
      ? path.join(scriptsDir, "systemd.mjs")
      : null;

if (!script) {
  console.error("后台服务安装目前支持 macOS LaunchAgent 和 Linux systemd user service。");
  process.exit(1);
}

const result = spawnSync(process.execPath, [script, action], {
  cwd: path.resolve(scriptsDir, ".."),
  env: process.env,
  stdio: "inherit",
});
process.exitCode = result.status ?? 1;
