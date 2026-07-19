import { createHash } from "node:crypto";

import { safeErrorText } from "./redaction.js";

import type {
  ProjectChatBinding,
  ProjectChatSetupPatch,
  ProjectChatSetupStep,
} from "./types.js";

export interface ProjectChatTarget {
  projectPath: string;
  projectName: string;
  ownerId: string;
  memberIds: string[];
  creationKey: string;
  sourceConversationKey: string;
}

export interface ProjectChatMemberSyncResult {
  added: number;
  unavailable: number;
  pendingApproval: number;
}

export interface ProjectChatWorkspaceResult {
  cardId: string;
  messageId: string;
}

export interface ProjectChatSetupIssue {
  step: ProjectChatSetupStep;
  message: string;
}

export interface ProjectChatSetupResult {
  binding: ProjectChatBinding;
  created: boolean;
  ready: boolean;
  issues: ProjectChatSetupIssue[];
}

export interface ProjectChatServiceDependencies {
  findByProject(projectPath: string): ProjectChatBinding | undefined;
  createRemoteChat(
    target: ProjectChatTarget,
  ): Promise<{ chatId: string; name: string }>;
  persistCreatedBinding(
    target: ProjectChatTarget,
    created: { chatId: string; name: string },
  ): Promise<ProjectChatBinding>;
  prepareBinding(binding: ProjectChatBinding, target: ProjectChatTarget): Promise<void>;
  syncMembers(chatId: string, memberIds: string[]): Promise<ProjectChatMemberSyncResult>;
  publishWorkspace(
    binding: ProjectChatBinding,
    target: ProjectChatTarget,
  ): Promise<ProjectChatWorkspaceResult>;
  pinMessage(messageId: string): Promise<void>;
  updateBinding(chatId: string, patch: ProjectChatSetupPatch): Promise<ProjectChatBinding>;
}

/**
 * Resumable, project-scoped provisioning for a Feishu project chat.
 *
 * The immutable binding is persisted immediately after Feishu creates the chat.
 * Every later step is independently durable, so retries never create a second
 * chat and never repeat a workspace send that already returned a message id.
 */
export class ProjectChatService {
  private readonly flights = new Map<string, Promise<ProjectChatSetupResult>>();

  constructor(private readonly dependencies: ProjectChatServiceDependencies) {}

  provision(target: ProjectChatTarget): Promise<ProjectChatSetupResult> {
    const active = this.flights.get(target.projectPath);
    if (active) return active;
    const flight = this.run(target).finally(() => {
      if (this.flights.get(target.projectPath) === flight) {
        this.flights.delete(target.projectPath);
      }
    });
    this.flights.set(target.projectPath, flight);
    return flight;
  }

  private async run(target: ProjectChatTarget): Promise<ProjectChatSetupResult> {
    let binding = this.dependencies.findByProject(target.projectPath);
    let created = false;
    if (!binding) {
      const remote = await this.dependencies.createRemoteChat(target);
      binding = await this.dependencies.persistCreatedBinding(target, remote);
      created = true;
    }

    const issues: ProjectChatSetupIssue[] = [];
    try {
      await this.dependencies.prepareBinding(binding, target);
    } catch (error) {
      const message = safeErrorText(error, 500);
      binding = await this.dependencies.updateBinding(binding.chatId, {
        lastErrorStep: "binding",
        lastError: message,
        lastAttemptAt: new Date().toISOString(),
      });
      return { binding, created, ready: false, issues: [{ step: "binding", message }] };
    }

    const membersFingerprint = projectChatMembersFingerprint(target.memberIds);
    if (
      binding.membersStatus !== "succeeded" ||
      binding.membersFingerprint !== membersFingerprint
    ) {
      if (target.memberIds.length === 0) {
        binding = await this.dependencies.updateBinding(binding.chatId, {
          membersStatus: "succeeded",
          membersFingerprint,
          lastAttemptAt: new Date().toISOString(),
        });
      } else {
        try {
          const synced = await this.dependencies.syncMembers(binding.chatId, target.memberIds);
          if (synced.unavailable > 0 || synced.pendingApproval > 0) {
            const message = memberSyncIssue(synced);
            issues.push({ step: "members", message });
            binding = await this.dependencies.updateBinding(binding.chatId, {
              membersStatus: "failed",
              lastErrorStep: "members",
              lastError: message,
              lastAttemptAt: new Date().toISOString(),
            });
          } else {
            binding = await this.dependencies.updateBinding(binding.chatId, {
              membersStatus: "succeeded",
              membersFingerprint,
              lastAttemptAt: new Date().toISOString(),
            });
          }
        } catch (error) {
          const message = safeErrorText(error, 500);
          issues.push({ step: "members", message });
          binding = await this.dependencies.updateBinding(binding.chatId, {
            membersStatus: "failed",
            lastErrorStep: "members",
            lastError: message,
            lastAttemptAt: new Date().toISOString(),
          });
        }
      }
    }

    if (binding.workspaceMessageId && binding.workspaceStatus !== "succeeded") {
      binding = await this.dependencies.updateBinding(binding.chatId, {
        workspaceStatus: "succeeded",
        lastAttemptAt: new Date().toISOString(),
      });
    }
    if (!binding.workspaceMessageId) {
      try {
        const workspace = await this.dependencies.publishWorkspace(binding, target);
        if (!workspace.cardId || !workspace.messageId) {
          throw new Error("飞书未返回项目工作台的卡片或消息标识。");
        }
        binding = await this.dependencies.updateBinding(binding.chatId, {
          workspaceStatus: "succeeded",
          workspaceCardId: workspace.cardId,
          workspaceMessageId: workspace.messageId,
          pinStatus: "pending",
          lastAttemptAt: new Date().toISOString(),
        });
      } catch (error) {
        const message = safeErrorText(error, 500);
        issues.push({ step: "workspace", message });
        binding = await this.dependencies.updateBinding(binding.chatId, {
          workspaceStatus: "failed",
          lastErrorStep: "workspace",
          lastError: message,
          lastAttemptAt: new Date().toISOString(),
        });
      }
    }

    if (binding.workspaceMessageId && binding.pinStatus !== "succeeded") {
      try {
        await this.dependencies.pinMessage(binding.workspaceMessageId);
        binding = await this.dependencies.updateBinding(binding.chatId, {
          pinStatus: "succeeded",
          lastAttemptAt: new Date().toISOString(),
        });
      } catch (error) {
        const message = safeErrorText(error, 500);
        issues.push({ step: "pin", message });
        binding = await this.dependencies.updateBinding(binding.chatId, {
          pinStatus: "failed",
          lastErrorStep: "pin",
          lastError: message,
          lastAttemptAt: new Date().toISOString(),
        });
      }
    }

    if (binding.messageStatus !== "succeeded") {
      issues.push({
        step: "messages",
        message: "尚未收到不 @ 机器人的普通群消息，群消息权限仍待验证。",
      });
    }
    const ready = isProjectChatReady(binding);
    if (ready) {
      binding = await this.dependencies.updateBinding(binding.chatId, {
        lastErrorStep: null,
        lastError: null,
        lastAttemptAt: new Date().toISOString(),
      });
    }
    return { binding, created, ready, issues };
  }
}

export function isProjectChatReady(binding: ProjectChatBinding): boolean {
  return (
    binding.membersStatus === "succeeded" &&
    binding.workspaceStatus === "succeeded" &&
    binding.pinStatus === "succeeded" &&
    binding.messageStatus === "succeeded"
  );
}

export function projectChatSetupStatusText(result: ProjectChatSetupResult): string {
  if (result.ready) {
    return result.created
      ? `项目群“${result.binding.name}”已创建并配置完成。群入口已发送到下方。`
      : `项目群“${result.binding.name}”已就绪。群入口已发送到下方。`;
  }
  const pending = [
    result.binding.membersStatus !== "succeeded" ? "成员邀请" : "",
    result.binding.workspaceStatus !== "succeeded" ? "工作台" : "",
    result.binding.pinStatus !== "succeeded" ? "置顶" : "",
    result.binding.messageStatus !== "succeeded" ? "普通消息验证" : "",
  ].filter(Boolean);
  const remediation = result.issues
    .map((issue) => projectChatIssueRemediation(issue.step))
    .concat(
      result.binding.messageStatus !== "succeeded"
        ? [projectChatIssueRemediation("messages")]
        : [],
    )
    .filter((value, index, values) => values.indexOf(value) === index)
    .join("；");
  return `项目群“${result.binding.name}”已绑定，但${pending.join("、") || "部分配置"}尚未完成。${remediation ? `修复建议：${remediation}。` : ""}再次点击“打开项目群”会自动修复，不会重复建群。`;
}

function memberSyncIssue(result: ProjectChatMemberSyncResult): string {
  const details = [
    result.unavailable > 0 ? `${result.unavailable} 人不可加入` : "",
    result.pendingApproval > 0 ? `${result.pendingApproval} 人等待审批` : "",
  ].filter(Boolean);
  return `成员同步未完全完成：${details.join("，") || "状态未知"}。`;
}

function projectChatIssueRemediation(step: ProjectChatSetupStep): string {
  switch (step) {
    case "binding":
      return "确认本地状态目录可写";
    case "members":
      return "检查 im:chat.members:write_only，并确认成员允许入群";
    case "workspace":
      return "检查 CardKit 和机器人发消息权限";
    case "pin":
      return "检查 im:message.pins:write_only";
    case "messages":
      return "在安装机运行 feishu-codex-bridge configure-feishu --profile ordinary-group，确认并发布后，在群里发送一条不 @ 机器人的普通消息";
  }
}

export function projectChatMembersFingerprint(memberIds: readonly string[]): string {
  const canonical = [...new Set(memberIds.map((memberId) => memberId.trim()).filter(Boolean))]
    .sort()
    .join("\u0000");
  return createHash("sha256").update(canonical).digest("hex");
}
