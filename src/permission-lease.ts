import type { PermissionLease, SandboxMode } from "./types.js";

export const FULL_ACCESS_ONCE_TTL_MINUTES = 30;
export const FULL_ACCESS_TIMED_TTL_MINUTES = 30;
export const FULL_ACCESS_SESSION_TTL_MINUTES = 60;

export function persistentSandboxMode(
  requested: SandboxMode | undefined,
  maximum: SandboxMode,
): SandboxMode {
  const safeMaximum = maximum === "danger-full-access" ? "workspace-write" : maximum;
  if (!requested || requested === "danger-full-access") return safeMaximum;
  if (requested === "workspace-write" && safeMaximum === "read-only") return "read-only";
  return requested;
}

export function permissionLeaseIsActive(
  lease: PermissionLease,
  now = Date.now(),
): boolean {
  return Date.parse(lease.expiresAt) > now && lease.remainingUses > 0;
}

export function permissionLeaseLabel(lease: PermissionLease, now = Date.now()): string {
  const minutes = Math.max(1, Math.ceil((Date.parse(lease.expiresAt) - now) / 60_000));
  if (lease.scope === "next-task") return `下一任务 · ${minutes} 分钟内有效`;
  if (lease.scope === "session") return `当前会话 · 最长剩余 ${minutes} 分钟`;
  return `限时完全访问 · 剩余约 ${minutes} 分钟`;
}
