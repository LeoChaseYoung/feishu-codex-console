import { describe, expect, it, vi } from "vitest";

import {
  ProjectChatService,
  isProjectChatReady,
  projectChatMembersFingerprint,
  projectChatSetupStatusText,
  type ProjectChatServiceDependencies,
  type ProjectChatTarget,
} from "../src/project-chat-service.js";
import type { ProjectChatBinding, ProjectChatSetupPatch } from "../src/types.js";

const target: ProjectChatTarget = {
  projectPath: "/repos/app",
  projectName: "app",
  ownerId: "ou-owner",
  memberIds: ["ou-member"],
  creationKey: "stable-key",
  sourceConversationKey: "oc-private::ou-owner",
};

describe("ProjectChatService", () => {
  it("persists the immutable binding before completing each recoverable step", async () => {
    const fixture = serviceFixture();

    const result = await fixture.service.provision(target);

    expect(result.ready).toBe(true);
    expect(result.created).toBe(true);
    expect(result.binding).toMatchObject({
      origin: "created",
      membersStatus: "succeeded",
      workspaceStatus: "succeeded",
      pinStatus: "succeeded",
      workspaceMessageId: "om-workspace",
      lastError: null,
    });
    expect(fixture.order).toEqual([
      "create",
      "persist",
      "prepare",
      "members",
      "workspace",
      "pin",
    ]);
    expect(projectChatSetupStatusText(result)).toContain("已创建并配置完成");
  });

  it("does not claim ordinary group messages are ready until delivery is observed", async () => {
    const fixture = serviceFixture({ messageStatus: "pending" });

    const result = await fixture.service.provision(target);

    expect(result.ready).toBe(false);
    expect(result.binding.messageStatus).toBe("pending");
    expect(projectChatSetupStatusText(result)).toContain("普通消息验证尚未完成");
    expect(projectChatSetupStatusText(result)).toContain(
      "feishu-codex-bridge configure-feishu --profile ordinary-group",
    );
    expect(isProjectChatReady({ ...result.binding, messageStatus: "succeeded" })).toBe(true);
  });

  it("never creates a second chat and only retries a workspace that failed", async () => {
    const fixture = serviceFixture();
    fixture.dependencies.publishWorkspace = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary send failure"))
      .mockResolvedValueOnce({ cardId: "cc-workspace", messageId: "om-workspace" });

    const failed = await fixture.service.provision(target);
    const recovered = await fixture.service.provision(target);

    expect(failed.ready).toBe(false);
    expect(failed.binding.workspaceStatus).toBe("failed");
    expect(recovered.ready).toBe(true);
    expect(fixture.dependencies.createRemoteChat).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.syncMembers).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.publishWorkspace).toHaveBeenCalledTimes(2);
    expect(fixture.dependencies.pinMessage).toHaveBeenCalledTimes(1);
  });

  it("retries only pinning when the workspace message was already saved", async () => {
    const fixture = serviceFixture();
    fixture.dependencies.pinMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("pin permission missing"))
      .mockResolvedValueOnce(undefined);

    const failed = await fixture.service.provision(target);
    const recovered = await fixture.service.provision(target);

    expect(failed.binding).toMatchObject({
      workspaceStatus: "succeeded",
      pinStatus: "failed",
      workspaceMessageId: "om-workspace",
    });
    expect(recovered.ready).toBe(true);
    expect(fixture.dependencies.createRemoteChat).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.publishWorkspace).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.pinMessage).toHaveBeenCalledTimes(2);
  });

  it("reports partial member sync without blocking the owner's workspace", async () => {
    const fixture = serviceFixture();
    fixture.dependencies.syncMembers = vi.fn().mockResolvedValue({
      added: 0,
      unavailable: 1,
      pendingApproval: 0,
    });

    const result = await fixture.service.provision(target);

    expect(result.ready).toBe(false);
    expect(result.binding).toMatchObject({
      membersStatus: "failed",
      workspaceStatus: "succeeded",
      pinStatus: "succeeded",
    });
    expect(result.issues[0]?.message).toContain("1 人不可加入");
    expect(projectChatSetupStatusText(result)).toContain("成员邀请尚未完成");
    expect(projectChatSetupStatusText(result)).toContain("im:chat.members:write_only");
  });

  it("treats a missing workspace message id as a failed send", async () => {
    const fixture = serviceFixture();
    fixture.dependencies.publishWorkspace = vi.fn().mockResolvedValue({
      cardId: "cc-workspace",
      messageId: "",
    });

    const result = await fixture.service.provision(target);

    expect(result.ready).toBe(false);
    expect(result.binding.workspaceStatus).toBe("failed");
    expect(result.binding.workspaceMessageId).toBeNull();
    expect(fixture.dependencies.pinMessage).not.toHaveBeenCalled();
  });

  it("uses one project-scoped flight for concurrent clicks", async () => {
    const fixture = serviceFixture();
    let release: (() => void) | undefined;
    fixture.dependencies.createRemoteChat = vi.fn(
      () =>
        new Promise<{ chatId: string; name: string }>((resolve) => {
          release = () => resolve({ chatId: "oc-project", name: "app · Codex" });
        }),
    );

    const first = fixture.service.provision(target);
    const second = fixture.service.provision(target);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release?.();
    const [left, right] = await Promise.all([first, second]);

    expect(left).toEqual(right);
    expect(fixture.dependencies.createRemoteChat).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.publishWorkspace).toHaveBeenCalledTimes(1);
  });

  it("resumes a saved pending step after a process restart", async () => {
    const fixture = serviceFixture();
    fixture.dependencies.pinMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("process stopped before pin finished"))
      .mockResolvedValueOnce(undefined);

    const interrupted = await fixture.service.provision(target);
    const restarted = new ProjectChatService(fixture.dependencies);
    const recovered = await restarted.provision(target);

    expect(interrupted.binding.workspaceMessageId).toBe("om-workspace");
    expect(interrupted.binding.pinStatus).toBe("failed");
    expect(recovered.ready).toBe(true);
    expect(fixture.dependencies.createRemoteChat).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.publishWorkspace).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.pinMessage).toHaveBeenCalledTimes(2);
  });

  it("reconciles members when the authorized team changes without repeating stable syncs", async () => {
    const fixture = serviceFixture();
    await fixture.service.provision({ ...target, memberIds: [] });
    await fixture.service.provision({ ...target, memberIds: ["ou-new", "ou-member"] });
    await fixture.service.provision({ ...target, memberIds: ["ou-member", "ou-new", "ou-new"] });

    expect(fixture.dependencies.syncMembers).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.syncMembers).toHaveBeenCalledWith("oc-project", [
      "ou-new",
      "ou-member",
    ]);
  });

  it("uses an order-independent member target fingerprint", () => {
    expect(projectChatMembersFingerprint(["ou-b", "ou-a", "ou-a"])).toBe(
      projectChatMembersFingerprint(["ou-a", "ou-b"]),
    );
  });
});

function serviceFixture(options: { messageStatus?: ProjectChatBinding["messageStatus"] } = {}): {
  service: ProjectChatService;
  dependencies: ProjectChatServiceDependencies;
  order: string[];
} {
  let binding: ProjectChatBinding | undefined;
  const order: string[] = [];
  const dependencies: ProjectChatServiceDependencies = {
    findByProject: vi.fn(() => binding),
    createRemoteChat: vi.fn(async () => {
      order.push("create");
      return { chatId: "oc-project", name: "app · Codex" };
    }),
    persistCreatedBinding: vi.fn(async () => {
      order.push("persist");
      binding = projectChatBinding(options.messageStatus ?? "succeeded");
      return binding;
    }),
    prepareBinding: vi.fn(async () => {
      order.push("prepare");
    }),
    syncMembers: vi.fn(async () => {
      order.push("members");
      return { added: 1, unavailable: 0, pendingApproval: 0 };
    }),
    publishWorkspace: vi.fn(async () => {
      order.push("workspace");
      return { cardId: "cc-workspace", messageId: "om-workspace" };
    }),
    pinMessage: vi.fn(async () => {
      order.push("pin");
    }),
    updateBinding: vi.fn(async (_chatId: string, patch: ProjectChatSetupPatch) => {
      if (!binding) throw new Error("binding missing");
      binding = { ...binding, ...patch, updatedAt: new Date().toISOString() };
      return binding;
    }),
  };
  return { service: new ProjectChatService(dependencies), dependencies, order };
}

function projectChatBinding(
  messageStatus: ProjectChatBinding["messageStatus"] = "succeeded",
): ProjectChatBinding {
  return {
    chatId: "oc-project",
    projectPath: target.projectPath,
    ownerId: target.ownerId,
    name: "app · Codex",
    origin: "created",
    membersStatus: "pending",
    membersFingerprint: null,
    workspaceStatus: "pending",
    pinStatus: "pending",
    messageStatus,
    workspaceCardId: null,
    workspaceMessageId: null,
    lastErrorStep: null,
    lastError: null,
    lastAttemptAt: null,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  };
}
