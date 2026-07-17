export interface AccountQuotaWindow {
  usedPercent: number;
  remainingPercent: number;
  windowDurationMins?: number;
  resetsAt?: string;
}

export interface AccountQuotaCredits {
  hasCredits: boolean;
  unlimited: boolean;
  balance?: string;
}

export interface AccountQuotaSpendLimit {
  limit: string;
  used: string;
  remainingPercent: number;
  resetsAt?: string;
}

export interface AccountQuotaLimit {
  id: string;
  name: string;
  planType?: string;
  primary?: AccountQuotaWindow;
  secondary?: AccountQuotaWindow;
  credits?: AccountQuotaCredits;
  individualLimit?: AccountQuotaSpendLimit;
  reachedType?: string;
}

export type AccountQuotaSnapshot =
  | {
      status: "available";
      sampledAt: string;
      limits: AccountQuotaLimit[];
      resetCredits: number;
    }
  | {
      status: "unavailable";
      sampledAt: string;
      message: string;
    };

export function normalizeAccountQuotaResponse(
  value: unknown,
  sampledAt = new Date().toISOString(),
): AccountQuotaSnapshot {
  const response = asRecord(value);
  const byLimitId = asRecord(response.rateLimitsByLimitId);
  const candidates: Array<{ value: unknown; fallbackId?: string }> = [
    { value: response.rateLimits },
    ...Object.entries(byLimitId).map(([fallbackId, entry]) => ({ value: entry, fallbackId })),
  ];
  const limits = new Map<string, AccountQuotaLimit>();

  for (const candidate of candidates) {
    const limit = normalizeLimit(candidate.value, candidate.fallbackId);
    if (limit && !limits.has(limit.id)) limits.set(limit.id, limit);
  }

  return {
    status: "available",
    sampledAt,
    limits: [...limits.values()],
    resetCredits: nonNegativeInteger(asRecord(response.rateLimitResetCredits).availableCount),
  };
}

export function unavailableAccountQuota(
  sampledAt = new Date().toISOString(),
): AccountQuotaSnapshot {
  return {
    status: "unavailable",
    sampledAt,
    message: "Codex 暂未返回账户额度，请确认登录状态后刷新。",
  };
}

function normalizeLimit(value: unknown, fallbackId?: string): AccountQuotaLimit | null {
  const raw = asRecord(value);
  if (Object.keys(raw).length === 0) return null;
  const id = stringValue(raw.limitId) ?? fallbackId ?? "codex";
  const name = stringValue(raw.limitName) ?? (id === "codex" ? "Codex" : id);
  const primary = normalizeWindow(raw.primary);
  const secondary = normalizeWindow(raw.secondary);
  const credits = normalizeCredits(raw.credits);
  const individualLimit = normalizeSpendLimit(raw.individualLimit);
  const planType = stringValue(raw.planType);
  const reachedType = stringValue(raw.rateLimitReachedType);
  return {
    id,
    name,
    ...(planType ? { planType } : {}),
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
    ...(credits ? { credits } : {}),
    ...(individualLimit ? { individualLimit } : {}),
    ...(reachedType ? { reachedType } : {}),
  };
}

function normalizeWindow(value: unknown): AccountQuotaWindow | undefined {
  const raw = asRecord(value);
  const used = finiteNumber(raw.usedPercent);
  if (used === undefined) return undefined;
  const usedPercent = clamp(used, 0, 100);
  const duration = finiteNumber(raw.windowDurationMins);
  const resetsAt = timestampIso(raw.resetsAt);
  return {
    usedPercent,
    remainingPercent: clamp(100 - usedPercent, 0, 100),
    ...(duration !== undefined && duration > 0 ? { windowDurationMins: duration } : {}),
    ...(resetsAt ? { resetsAt } : {}),
  };
}

function normalizeCredits(value: unknown): AccountQuotaCredits | undefined {
  const raw = asRecord(value);
  if (Object.keys(raw).length === 0) return undefined;
  const balance = stringValue(raw.balance);
  return {
    hasCredits: raw.hasCredits === true,
    unlimited: raw.unlimited === true,
    ...(balance !== undefined ? { balance } : {}),
  };
}

function normalizeSpendLimit(value: unknown): AccountQuotaSpendLimit | undefined {
  const raw = asRecord(value);
  const limit = stringValue(raw.limit);
  const used = stringValue(raw.used);
  const remaining = finiteNumber(raw.remainingPercent);
  if (!limit || !used || remaining === undefined) return undefined;
  const resetsAt = timestampIso(raw.resetsAt);
  return {
    limit,
    used,
    remainingPercent: clamp(remaining, 0, 100),
    ...(resetsAt ? { resetsAt } : {}),
  };
}

function timestampIso(value: unknown): string | undefined {
  const timestamp = finiteNumber(value);
  if (timestamp === undefined || timestamp <= 0) return undefined;
  const date = new Date(timestamp < 1_000_000_000_000 ? timestamp * 1_000 : timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value === "bigint") return Number(value > 0n ? value : 0n);
  const parsed = finiteNumber(value);
  return parsed === undefined ? 0 : Math.max(0, Math.trunc(parsed));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
