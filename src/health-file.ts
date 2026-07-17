import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const BRIDGE_HEALTH_FILE = "bridge-health.json";

export type BridgeHealthStatus = "starting" | "ready" | "degraded" | "stopping" | "failed";

export interface BridgeConsumerHealth {
  eventKey: string;
  ready: boolean;
  restartCount: number;
  lastReadyAt?: string;
  lastExitAt?: string;
}

export interface BridgeApiHealth {
  state: "idle" | "ready" | "degraded";
  consecutiveFailures: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
}

export interface BridgeHealthSnapshot {
  version: 1;
  status: BridgeHealthStatus;
  instanceId: string;
  pid: number;
  startedAt: string;
  updatedAt: string;
  configFile: string | null;
  productVersion?: string;
  packageRoot?: string;
  activeTasks?: number;
  queuedTasks?: number;
  consumers: BridgeConsumerHealth[];
  api?: BridgeApiHealth;
}

export type BridgeHealthInput = Omit<BridgeHealthSnapshot, "version" | "updatedAt">;

export function bridgeHealthPath(dataDir: string): string {
  return path.join(dataDir, BRIDGE_HEALTH_FILE);
}

export async function writeBridgeHealth(
  dataDir: string,
  input: BridgeHealthInput,
): Promise<BridgeHealthSnapshot> {
  await ensurePrivateDirectory(dataDir);
  const target = bridgeHealthPath(dataDir);
  await assertSafeOptionalFile(target);
  const snapshot: BridgeHealthSnapshot = {
    version: 1,
    ...input,
    updatedAt: new Date().toISOString(),
  };
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await chmod(temporary, 0o600);
  await rename(temporary, target);
  await chmod(target, 0o600);
  return snapshot;
}

export async function readBridgeHealth(dataDir: string): Promise<BridgeHealthSnapshot | null> {
  const target = bridgeHealthPath(dataDir);
  try {
    const details = await lstat(target);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new Error(`Unsafe bridge health file: ${target}`);
    }
    return JSON.parse(await readFile(target, "utf8")) as BridgeHealthSnapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function removeBridgeHealth(dataDir: string, ownerPid?: number): Promise<void> {
  if (ownerPid !== undefined) {
    const current = await readBridgeHealth(dataDir);
    if (current && current.pid !== ownerPid) return;
  }
  await rm(bridgeHealthPath(dataDir), { force: true });
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  try {
    const details = await lstat(directory);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error(`Unsafe bridge data directory: ${directory}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  await chmod(directory, 0o700);
}

async function assertSafeOptionalFile(file: string): Promise<void> {
  try {
    const details = await lstat(file);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new Error(`Unsafe bridge health file: ${file}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
