import "dotenv/config";

import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const instanceId = safeInstanceId(process.env.BRIDGE_INSTANCE_ID);
const configFile = process.env.DOTENV_CONFIG_PATH?.trim();
const label = `com.feishu-codex-bridge.${instanceId}`;
const legacyLabels = ["com.leochaseyoung.feishu-codex-bridge"];
const agentDir = path.join(homedir(), "Library", "LaunchAgents");
const plistPath = path.join(agentDir, `${label}.plist`);
const domain = `gui/${process.getuid()}`;
const service = `${domain}/${label}`;
const action = process.argv[2] ?? "status";

if (process.platform !== "darwin") {
  console.error("LaunchAgent 仅支持 macOS。");
  process.exit(1);
}

if (action === "install") {
  await install();
} else if (action === "uninstall") {
  await uninstall();
} else if (action === "status") {
  const result = launchctl(["print", service], true);
  process.exitCode = result.status === 0 ? 0 : 1;
} else if (action === "stop") {
  const result = launchctl(["bootout", service], false);
  process.exitCode = result.status === 0 ? 0 : 1;
  if (result.status === 0) console.log(`已停止 ${label}`);
} else if (action === "restart") {
  const result = launchctl(["kickstart", "-k", service], true);
  process.exitCode = result.status === 0 ? 0 : 1;
  if (result.status === 0) console.log(`已重启 ${label}`);
} else {
  console.error("用法：node scripts/launchd.mjs install|uninstall|status|stop|restart");
  process.exitCode = 2;
}

async function install() {
  const dataDir = path.resolve(process.env.BRIDGE_DATA_DIR || path.join(projectDir, "var"));
  const logDir = path.join(dataDir, "log");
  await mkdir(agentDir, { recursive: true });
  await ensurePrivateDirectory(logDir);
  await writeFile(plistPath, plist(logDir), { encoding: "utf8", mode: 0o644 });
  await chmod(plistPath, 0o644);
  launchctl(["bootout", service], false);
  for (const legacyLabel of legacyLabels) {
    const legacyService = `${domain}/${legacyLabel}`;
    launchctl(["bootout", legacyService], false);
    await rm(path.join(agentDir, `${legacyLabel}.plist`), { force: true });
  }
  await delay(750);
  let boot = launchctl(["bootstrap", domain, plistPath], true);
  for (let attempt = 1; boot.status !== 0 && attempt < 3; attempt += 1) {
    await delay(750 * (attempt + 1));
    boot = launchctl(["bootstrap", domain, plistPath], true);
  }
  if (boot.status !== 0) process.exit(boot.status ?? 1);
  launchctl(["enable", service], false);
  // Bootstrap + RunAtLoad already starts the service. A non-destructive kickstart
  // covers slower launchd versions without racing a second bridge process against
  // the first one while its Feishu subscriptions are still being registered.
  const start = launchctl(["kickstart", service], true);
  if (start.status !== 0) process.exit(start.status ?? 1);
  console.log(`已安装并启动 ${label}`);
  console.log(`日志目录：${logDir}`);
}

async function ensurePrivateDirectory(directory) {
  try {
    const details = await lstat(directory);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error(`Unsafe service directory: ${directory}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  await chmod(directory, 0o700);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function uninstall() {
  launchctl(["bootout", service], false);
  await rm(plistPath, { force: true });
  for (const legacyLabel of legacyLabels) {
    launchctl(["bootout", `${domain}/${legacyLabel}`], false);
    await rm(path.join(agentDir, `${legacyLabel}.plist`), { force: true });
  }
  console.log(`已卸载 ${label}`);
}

function launchctl(args, inherit) {
  return spawnSync("launchctl", args, {
    cwd: projectDir,
    env: process.env,
    encoding: "utf8",
    stdio: inherit ? "inherit" : "ignore",
  });
}

function plist(logDir) {
  const environmentPath = process.env.PATH ?? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
  const configEnvironment = configFile
    ? `\n    <key>DOTENV_CONFIG_PATH</key><string>${xml(path.resolve(configFile))}</string>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>--disable-warning=ExperimentalWarning</string>
    <string>${xml(path.join(projectDir, "dist", "index.js"))}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(projectDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>PATH</key><string>${xml(environmentPath)}</string>${configEnvironment}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${xml(path.join(logDir, "bridge.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logDir, "bridge.error.log"))}</string>
</dict>
</plist>
`;
}

function xml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
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
