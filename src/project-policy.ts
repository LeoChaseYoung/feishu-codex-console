import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import type { ExternalAction, SandboxMode } from "./types.js";

export const PROJECT_POLICY_FILE = ".feishu-codex-policy.json";
const MAX_POLICY_BYTES = 64 * 1024;
const EXTERNAL_ACTIONS = ["commit", "push", "pull_request", "deploy"] as const;

export interface ProjectPolicy {
  source: "default" | "repository";
  filePath?: string;
  maximumSandbox?: SandboxMode;
  allowedActions: ExternalAction[] | null;
  deniedActions: ExternalAction[];
  approvalActions: ExternalAction[];
}

export interface ProjectActionDecision {
  blockedActions: ExternalAction[];
  approvalActions: ExternalAction[];
}

export class ProjectPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectPolicyError";
  }
}

export async function loadProjectPolicy(projectPath: string): Promise<ProjectPolicy> {
  const filePath = path.join(projectPath, PROJECT_POLICY_FILE);
  let details;
  try {
    details = await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultProjectPolicy();
    throw new ProjectPolicyError(`无法读取项目策略：${safeErrorMessage(error)}`);
  }
  if (details.isSymbolicLink() || !details.isFile()) {
    throw new ProjectPolicyError(`${PROJECT_POLICY_FILE} 必须是项目根目录中的普通文件`);
  }
  if (details.size > MAX_POLICY_BYTES) {
    throw new ProjectPolicyError(`${PROJECT_POLICY_FILE} 不能超过 64 KB`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new ProjectPolicyError(`项目策略不是有效 JSON：${safeErrorMessage(error)}`);
  }
  const record = requireRecord(parsed, "项目策略");
  if (record.version !== 1) throw new ProjectPolicyError("项目策略 version 必须为 1");

  const sandbox = optionalRecord(record.sandbox, "sandbox");
  const maximumSandbox = sandbox
    ? optionalSandboxMode(sandbox.maximum, "sandbox.maximum")
    : undefined;
  const operations = optionalRecord(record.operations, "operations");
  const allowedActions = operations
    ? optionalActionList(operations.allow, "operations.allow")
    : null;
  const deniedActions = operations
    ? optionalActionList(operations.deny, "operations.deny") ?? []
    : [];
  const configuredApprovals = operations
    ? optionalActionList(operations.requireApproval, "operations.requireApproval") ?? []
    : [];

  return {
    source: "repository",
    filePath,
    ...(maximumSandbox ? { maximumSandbox } : {}),
    allowedActions,
    deniedActions,
    // External side effects always keep the bridge-level confirmation floor.
    // Repository policy can add intent, but can never remove this list.
    approvalActions: uniqueActions([...EXTERNAL_ACTIONS, ...configuredApprovals]),
  };
}

export function defaultProjectPolicy(): ProjectPolicy {
  return {
    source: "default",
    allowedActions: null,
    deniedActions: [],
    approvalActions: [...EXTERNAL_ACTIONS],
  };
}

export function applyProjectSandboxMaximum(
  requested: SandboxMode,
  policy: ProjectPolicy,
): SandboxMode {
  if (!policy.maximumSandbox) return requested;
  return sandboxRank(requested) <= sandboxRank(policy.maximumSandbox)
    ? requested
    : policy.maximumSandbox;
}

export function decideProjectActions(
  policy: ProjectPolicy,
  actions: readonly ExternalAction[],
): ProjectActionDecision {
  const allowed = policy.allowedActions ? new Set(policy.allowedActions) : null;
  const denied = new Set(policy.deniedActions);
  const blockedActions = uniqueActions(
    actions.filter((action) => denied.has(action) || (allowed !== null && !allowed.has(action))),
  );
  const approvalFloor = new Set(policy.approvalActions);
  return {
    blockedActions,
    approvalActions: uniqueActions(
      actions.filter((action) => !blockedActions.includes(action) && approvalFloor.has(action)),
    ),
  };
}

export function projectPolicySummary(policy: ProjectPolicy): string {
  if (policy.source === "default") return "主机默认策略";
  const restrictions = [
    policy.maximumSandbox ? `权限最高 ${sandboxLabel(policy.maximumSandbox)}` : "",
    policy.allowedActions ? `允许 ${policy.allowedActions.length} 类外部动作` : "",
    policy.deniedActions.length > 0 ? `拒绝 ${policy.deniedActions.length} 类外部动作` : "",
  ].filter(Boolean);
  return restrictions.length > 0 ? `仓库策略 · ${restrictions.join(" · ")}` : "仓库策略 · 使用安全默认值";
}

function optionalActionList(value: unknown, label: string): ExternalAction[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) throw new ProjectPolicyError(`${label} 必须是数组`);
  if (value.length > EXTERNAL_ACTIONS.length) {
    throw new ProjectPolicyError(`${label} 包含重复项或未知操作`);
  }
  const actions: ExternalAction[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !isExternalAction(entry)) {
      throw new ProjectPolicyError(
        `${label} 仅支持：${EXTERNAL_ACTIONS.join(", ")}`,
      );
    }
    if (actions.includes(entry)) throw new ProjectPolicyError(`${label} 不能包含重复项`);
    actions.push(entry);
  }
  return actions;
}

function optionalSandboxMode(value: unknown, label: string): SandboxMode | undefined {
  if (value === undefined) return undefined;
  if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") {
    return value;
  }
  throw new ProjectPolicyError(
    `${label} 仅支持 read-only、workspace-write 或 danger-full-access`,
  );
}

function optionalRecord(
  value: unknown,
  label: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  return requireRecord(value, label);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProjectPolicyError(`${label} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function isExternalAction(value: string): value is ExternalAction {
  return (EXTERNAL_ACTIONS as readonly string[]).includes(value);
}

function uniqueActions(actions: readonly ExternalAction[]): ExternalAction[] {
  return [...new Set(actions)];
}

function sandboxRank(mode: SandboxMode): number {
  if (mode === "read-only") return 0;
  if (mode === "workspace-write") return 1;
  return 2;
}

function sandboxLabel(mode: SandboxMode): string {
  if (mode === "read-only") return "只读";
  if (mode === "workspace-write") return "工作区写入";
  return "完全访问";
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").slice(0, 300);
}
