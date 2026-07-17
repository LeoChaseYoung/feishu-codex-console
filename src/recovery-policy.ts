import type { BridgeHealthSnapshot } from "./health-file.js";

export interface BridgeRecoveryDecision {
  blockDuplicate: boolean;
  unexpected: boolean;
  offlineForMs: number;
  notify: boolean;
  previousHeartbeatAt?: string;
}

export function assessBridgeRecovery(
  previous: BridgeHealthSnapshot | null,
  {
    currentPid,
    now = Date.now(),
    processAlive,
    liveHeartbeatMs = 45_000,
    notifyAfterMs = 30_000,
  }: {
    currentPid: number;
    now?: number;
    processAlive: (pid: number) => boolean;
    liveHeartbeatMs?: number;
    notifyAfterMs?: number;
  },
): BridgeRecoveryDecision {
  if (!previous) {
    return { blockDuplicate: false, unexpected: false, offlineForMs: 0, notify: false };
  }
  const heartbeat = Date.parse(previous.updatedAt);
  const offlineForMs = Number.isFinite(heartbeat) ? Math.max(0, now - heartbeat) : 0;
  const validPid = Number.isSafeInteger(previous.pid) && previous.pid > 0;
  const blockDuplicate = Boolean(
    validPid &&
    previous.pid !== currentPid &&
    offlineForMs < liveHeartbeatMs &&
    processAlive(previous.pid),
  );
  const unexpected = !blockDuplicate && ["ready", "degraded", "failed"].includes(previous.status);
  return {
    blockDuplicate,
    unexpected,
    offlineForMs,
    notify: unexpected && offlineForMs >= notifyAfterMs,
    previousHeartbeatAt: previous.updatedAt,
  };
}

export function shouldSendRecoveryNotice(
  lastNotice: string | undefined,
  now = Date.now(),
  minimumIntervalMs = 15 * 60_000,
): boolean {
  if (!lastNotice) return true;
  const previous = Date.parse(lastNotice);
  return !Number.isFinite(previous) || now - previous >= minimumIntervalMs;
}
