import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const INSTALL_STEPS = Object.freeze([
  "environment_ready",
  "feishu_bound",
  "capabilities_verified",
  "identity_discovered",
  "preferences_confirmed",
  "config_written",
  "service_running",
  "test_card_delivered",
  "completed",
]);

export function installStatePath(configFile) {
  return configFile.endsWith(".env")
    ? `${configFile.slice(0, -4)}.install-state.json`
    : `${configFile}.install-state.json`;
}

export async function loadInstallState(configFile) {
  const file = installStatePath(configFile);
  try {
    const details = await lstat(file);
    if (!details.isFile() || details.isSymbolicLink()) throw new Error(`Unsafe install state: ${file}`);
    const value = JSON.parse(await readFile(file, "utf8"));
    if (value?.version !== 1 || !Array.isArray(value.completedSteps)) {
      throw new Error(`Unsupported install state format: ${file}`);
    }
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function recordInstallStep(configFile, previous, step, details = {}) {
  if (!INSTALL_STEPS.includes(step)) throw new Error(`Unknown install step: ${step}`);
  const completedSteps = [...new Set([...(previous?.completedSteps ?? []), step])]
    .sort((left, right) => INSTALL_STEPS.indexOf(left) - INSTALL_STEPS.indexOf(right));
  const previousIndex = INSTALL_STEPS.indexOf(previous?.status);
  const stepIndex = INSTALL_STEPS.indexOf(step);
  const status = previousIndex > stepIndex ? previous.status : step;
  const state = {
    version: 1,
    status,
    completedSteps,
    configFile: path.resolve(configFile),
    updatedAt: new Date().toISOString(),
    ...safeDetails(previous ?? {}),
    ...safeDetails(details),
  };
  await writeInstallState(configFile, state);
  return state;
}

export async function recordInstallError(configFile, previous, error) {
  const state = {
    version: 1,
    status: previous?.status ?? "not_started",
    completedSteps: previous?.completedSteps ?? [],
    configFile: path.resolve(configFile),
    updatedAt: new Date().toISOString(),
    ...safeDetails(previous ?? {}),
    lastError: String(error instanceof Error ? error.message : error).slice(0, 500),
  };
  await writeInstallState(configFile, state);
  return state;
}

async function writeInstallState(configFile, state) {
  const file = installStatePath(configFile);
  const directory = path.dirname(file);
  let created = false;
  try {
    const details = await lstat(directory);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error(`Unsafe install state directory: ${directory}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    created = true;
  }
  if (created) await chmod(directory, 0o700);
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, file);
    await chmod(file, 0o600);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function safeDetails(details) {
  const allowed = ["instanceId", "preset", "chatType", "serviceInstalled", "testCardDisabled"];
  return Object.fromEntries(
    Object.entries(details).filter(([key, value]) => allowed.includes(key) && value !== undefined),
  );
}
