import "dotenv/config";

import { spawnSync } from "node:child_process";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const instanceId = safeInstanceId(process.env.BRIDGE_INSTANCE_ID);
const configFile = process.env.DOTENV_CONFIG_PATH?.trim();
const unitName = `feishu-codex-bridge-${instanceId}.service`;
const unitDir = path.join(homedir(), ".config", "systemd", "user");
const unitPath = path.join(unitDir, unitName);
const action = process.argv[2] ?? "status";

if (process.platform !== "linux") {
  console.error("systemd user service 仅支持 Linux。");
  process.exit(1);
}

if (action === "install") await install();
else if (action === "uninstall") await uninstall();
else if (action === "status") process.exitCode = systemctl(["status", unitName], true).status ?? 1;
else if (action === "stop") process.exitCode = systemctl(["stop", unitName], true).status ?? 1;
else if (action === "restart") process.exitCode = systemctl(["restart", unitName], true).status ?? 1;
else {
  console.error("用法：node scripts/systemd.mjs install|uninstall|status|stop|restart");
  process.exitCode = 2;
}

async function install() {
  await mkdir(unitDir, { recursive: true, mode: 0o700 });
  await chmod(unitDir, 0o700);
  await writeFile(unitPath, unit(), { encoding: "utf8", mode: 0o600 });
  systemctl(["daemon-reload"], true);
  const result = systemctl(["enable", "--now", unitName], true);
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`已安装并启动 ${unitName}`);
  console.log(`查看日志：journalctl --user -u ${unitName} -f`);
}

async function uninstall() {
  systemctl(["disable", "--now", unitName], false);
  await rm(unitPath, { force: true });
  systemctl(["daemon-reload"], false);
  console.log(`已卸载 ${unitName}`);
}

function systemctl(args, inherit) {
  return spawnSync("systemctl", ["--user", ...args], {
    cwd: projectDir,
    env: process.env,
    encoding: "utf8",
    stdio: inherit ? "inherit" : "ignore",
  });
}

function unit() {
  const environmentPath = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
  const configEnvironment = configFile
    ? `Environment=${systemdQuote(`DOTENV_CONFIG_PATH=${path.resolve(configFile)}`)}\n`
    : "";
  return `[Unit]
Description=Feishu Codex Bridge (${instanceId})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${systemdQuote(projectDir)}
ExecStart=${systemdQuote(process.execPath)} --disable-warning=ExperimentalWarning ${systemdQuote(path.join(projectDir, "dist", "index.js"))}
Environment=${systemdQuote(`PATH=${environmentPath}`)}
Environment=NODE_ENV=production
${configEnvironment}Restart=always
RestartSec=5
UMask=0077

[Install]
WantedBy=default.target
`;
}

function systemdQuote(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function safeInstanceId(value) {
  const normalized = (value?.trim() || "default")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (!normalized) throw new Error("BRIDGE_INSTANCE_ID must contain letters or numbers");
  return normalized;
}
