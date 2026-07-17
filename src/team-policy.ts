import type { BridgeConfig } from "./config.js";
import type { CodexProject } from "./project-registry.js";
import type { FeishuMessageEvent, SandboxMode, TeamRole } from "./types.js";
import { workspaceSessionForEvent } from "./workspace-session.js";

export function roleForSender(config: BridgeConfig, senderId: string): TeamRole | null {
  if (config.adminSenderIds?.has(senderId)) return "admin";
  if (config.allowedSenderIds.has(senderId)) return "operator";
  if (config.viewerSenderIds?.has(senderId)) return "viewer";
  return null;
}

export function canOperate(config: BridgeConfig, senderId: string): boolean {
  const role = roleForSender(config, senderId);
  return role === "admin" || role === "operator";
}

export function canAdminister(config: BridgeConfig, senderId: string): boolean {
  return roleForSender(config, senderId) === "admin";
}

export function canControlOwnedResource(
  config: BridgeConfig,
  senderId: string,
  ownerId: string,
): boolean {
  return canOperate(config, senderId) && (senderId === ownerId || canAdminister(config, senderId));
}

export function canViewOwnedResource(
  config: BridgeConfig,
  senderId: string,
  ownerId: string,
): boolean {
  return roleForSender(config, senderId) !== null &&
    (senderId === ownerId || canAdminister(config, senderId));
}

export function canControlTask(
  config: BridgeConfig,
  senderId: string,
  task: { ownerId: string; controllerId?: string },
): boolean {
  if (!canOperate(config, senderId)) return false;
  return senderId === (task.controllerId || task.ownerId) || canAdminister(config, senderId);
}

export function canViewTask(
  config: BridgeConfig,
  senderId: string,
  task: { ownerId: string; controllerId?: string },
): boolean {
  if (!roleForSender(config, senderId)) return false;
  return (
    senderId === task.ownerId ||
    senderId === (task.controllerId || task.ownerId) ||
    canAdminister(config, senderId)
  );
}

export function canTakeOverTask(
  config: BridgeConfig,
  senderId: string,
  task: { ownerId: string; controllerId?: string },
): boolean {
  return canOperate(config, senderId) &&
    (senderId === task.ownerId || canAdminister(config, senderId)) &&
    senderId !== (task.controllerId || task.ownerId);
}

export function conversationKeyForEvent(
  event: Pick<
    FeishuMessageEvent,
    "chat_id" | "chat_type" | "sender_id" | "message_id" | "root_id" | "thread_id"
  >,
  config: BridgeConfig,
): string {
  return workspaceSessionForEvent(event, config).conversationKey;
}

export function conversationKeyForCard(
  chatId: string,
  operatorId: string,
  chatType: "p2p" | "group" | undefined,
  config: BridgeConfig,
): string {
  if (chatType === "group" && config.groupSessionScope === "member") {
    return `${chatId}::${operatorId}`;
  }
  return chatId;
}

export function canAccessProject(
  config: BridgeConfig,
  senderId: string,
  project: Pick<CodexProject, "path" | "name" | "displayPath">,
): boolean {
  if (!roleForSender(config, senderId)) return false;
  if (canAdminister(config, senderId) || config.projectAcl.size === 0) return true;
  for (const [selector, actors] of config.projectAcl) {
    const normalized = selector.toLocaleLowerCase();
    const matches =
      selector === "*" ||
      selector === project.path ||
      selector === project.name ||
      selector === project.displayPath ||
      normalized === project.name.toLocaleLowerCase() ||
      normalized === project.displayPath.toLocaleLowerCase();
    if (!matches) continue;
    if (actors?.has("*") || actors?.has(senderId)) return true;
  }
  return false;
}

export function visibleProjects(
  config: BridgeConfig,
  senderId: string,
  projects: readonly CodexProject[],
): CodexProject[] {
  return projects.filter((project) => canAccessProject(config, senderId, project));
}

const SANDBOX_RANK: Record<SandboxMode, number> = {
  "read-only": 0,
  "workspace-write": 1,
  "danger-full-access": 2,
};

export function selectableSandboxModes(maximum: SandboxMode): SandboxMode[] {
  return (["read-only", "workspace-write", "danger-full-access"] as const).filter(
    (mode) => SANDBOX_RANK[mode] <= SANDBOX_RANK[maximum],
  );
}

export function isSandboxModeAllowed(mode: SandboxMode, maximum: SandboxMode): boolean {
  return SANDBOX_RANK[mode] <= SANDBOX_RANK[maximum];
}

export function roleLabel(role: TeamRole | null): string {
  if (role === "admin") return "管理员";
  if (role === "operator") return "操作者";
  if (role === "viewer") return "只读成员";
  return "未授权";
}
