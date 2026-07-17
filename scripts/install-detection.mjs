import { spawnSync } from "node:child_process";
import { lstat, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { serviceHealthPath } from "./service-health.mjs";

export async function detectExistingInstallation({
  configFile,
  dataDir,
  instanceId,
  platform = process.platform,
  homeDir = homedir(),
  uid = typeof process.getuid === "function" ? process.getuid() : 0,
  run = runCommand,
}) {
  const config = await fileState(configFile);
  const data = await directoryState(dataDir);
  const health = await healthState(dataDir);
  const service = await serviceState({ instanceId, platform, homeDir, uid, run });
  return {
    exists: config.exists || data.exists || service.installed || health.exists,
    config,
    data,
    health,
    service,
  };
}

async function serviceState({ instanceId, platform, homeDir, uid, run }) {
  if (platform === "darwin") {
    const label = `com.feishu-codex-bridge.${instanceId}`;
    const definition = path.join(homeDir, "Library", "LaunchAgents", `${label}.plist`);
    const definitionState = await fileState(definition);
    const outcome = run("launchctl", ["print", `gui/${uid}/${label}`]);
    return {
      manager: "launchd",
      name: label,
      definition,
      installed: definitionState.exists || outcome.status === 0,
      running: outcome.status === 0,
    };
  }
  if (platform === "linux") {
    const name = `feishu-codex-bridge-${instanceId}.service`;
    const definition = path.join(homeDir, ".config", "systemd", "user", name);
    const definitionState = await fileState(definition);
    const outcome = run("systemctl", ["--user", "is-active", "--quiet", name]);
    return {
      manager: "systemd",
      name,
      definition,
      installed: definitionState.exists || outcome.status === 0,
      running: outcome.status === 0,
    };
  }
  return {
    manager: "unsupported",
    name: "",
    definition: "",
    installed: false,
    running: false,
  };
}

async function fileState(file) {
  try {
    const details = await lstat(file);
    return {
      path: file,
      exists: details.isFile() && !details.isSymbolicLink(),
      unsafe: !details.isFile() || details.isSymbolicLink(),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { path: file, exists: false, unsafe: false };
    throw error;
  }
}

async function directoryState(directory) {
  try {
    const details = await lstat(directory);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      return { path: directory, exists: true, unsafe: true, entryCount: 0 };
    }
    const entries = await readdir(directory);
    return {
      path: directory,
      exists: true,
      unsafe: false,
      entryCount: entries.length,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { path: directory, exists: false, unsafe: false, entryCount: 0 };
    }
    throw error;
  }
}

async function healthState(dataDir) {
  const file = serviceHealthPath(dataDir);
  const state = await fileState(file);
  if (!state.exists) return { path: file, exists: false };
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return {
      path: file,
      exists: true,
      status: typeof parsed.status === "string" ? parsed.status : "unknown",
      pid: Number.isSafeInteger(parsed.pid) ? parsed.pid : null,
      instanceId: typeof parsed.instanceId === "string" ? parsed.instanceId : null,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch {
    return { path: file, exists: true, status: "invalid", pid: null, instanceId: null, updatedAt: null };
  }
}

function runCommand(command, args) {
  const outcome = spawnSync(command, args, {
    env: process.env,
    stdio: "ignore",
  });
  return { status: outcome.status ?? 1 };
}
