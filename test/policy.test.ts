import { describe, expect, it } from "vitest";

import {
  classifyCommand,
  commandPolicyDecision,
  externalActionsForPrompt,
  isAuthorized,
  isAttachmentMessageType,
  isTextualMessageType,
  normalizePrompt,
  parseCardActionEvent,
  parseFeishuEvent,
  projectSelector,
  isConfirmedProjectSwitch,
  queuedPrompt,
  settingsChange,
  steerPrompt,
} from "../src/policy.js";
import type { BridgeConfig } from "../src/config.js";

describe("policy", () => {
  it("parses the compact lark-cli message event", () => {
    const event = parseFeishuEvent({
      type: "im.message.receive_v1",
      event_id: "evt_1",
      message_id: "om_1",
      chat_id: "oc_1",
      chat_type: "p2p",
      sender_id: "ou_1",
      message_type: "text",
      content: "hello",
    });
    expect(event?.content).toBe("hello");
  });

  it("preserves Feishu reply and topic context", () => {
    const event = parseFeishuEvent({
      type: "im.message.receive_v1",
      event_id: "evt_2",
      message_id: "om_reply",
      chat_id: "oc_team",
      chat_type: "group",
      sender_id: "ou_1",
      message_type: "text",
      content: "continue",
      reply_to: "om_parent",
      root_id: "om_root",
      thread_id: "omt_thread",
    });
    expect(event).toMatchObject({
      reply_to: "om_parent",
      root_id: "om_root",
      thread_id: "omt_thread",
    });
  });

  it("rejects an incomplete event", () => {
    expect(parseFeishuEvent({ type: "im.message.receive_v1" })).toBeNull();
  });

  it("keeps the selected option from a Card 2.0 dropdown callback", () => {
    const event = parseCardActionEvent({
      type: "card.action.trigger",
      event_id: "evt_card",
      operator_id: "ou_1",
      chat_id: "oc_1",
      message_id: "om_card",
      token: "token_1",
      action_value: JSON.stringify({ bridge: "feishu-codex-v2", action: "select_project" }),
      action_tag: "select_static",
      action_name: "project_path",
      option: "/Users/demo/project/team-api",
      card_content: "{}",
    });

    expect(event).toMatchObject({
      action_tag: "select_static",
      action_name: "project_path",
      option: "/Users/demo/project/team-api",
    });
  });

  it("strips the configured bot mention in group chats", () => {
    expect(normalizePrompt("@Codex Bot 修复测试", "group", ["Codex Bot"])).toBe(
      "修复测试",
    );
  });

  it("recognizes commands without stealing normal prompts", () => {
    expect(classifyCommand("新手引导")).toBe("onboarding");
    expect(classifyCommand("/start")).toBe("onboarding");
    expect(classifyCommand("/onboarding")).toBe("onboarding");
    expect(classifyCommand("状态")).toBe("status");
    expect(classifyCommand("控制台")).toBe("status");
    expect(classifyCommand("额度")).toBe("quota");
    expect(classifyCommand("/usage")).toBe("quota");
    expect(classifyCommand("/cancel")).toBe("cancel");
    expect(classifyCommand("/stop")).toBe("cancel");
    expect(classifyCommand("项目")).toBe("projects");
    expect(classifyCommand("读取项目")).toBe("project_overview");
    expect(classifyCommand("/overview")).toBe("project_overview");
    expect(classifyCommand("设置")).toBe("settings");
    expect(classifyCommand("会话")).toBe("sessions");
    expect(classifyCommand("任务")).toBe("tasks");
    expect(classifyCommand("团队")).toBe("team");
    expect(classifyCommand("运行手册")).toBe("runbooks");
    expect(classifyCommand('/run verify module="auth"')).toBe("runbook_run");
    expect(classifyCommand("切换 FastGPT")).toBe("switch_project");
    expect(classifyCommand("/use 2")).toBe("switch_project");
    expect(classifyCommand("追加 把按钮改成蓝色")).toBe("steer");
    expect(classifyCommand("排队 运行完整测试")).toBe("queue_prompt");
    expect(classifyCommand("修复状态页面")).toBe("prompt");
    expect(classifyCommand("深入分析项目架构")).toBe("prompt");
    expect(classifyCommand("切换按钮的颜色")).toBe("prompt");
  });

  it("extracts steering text without treating ordinary prompts as steering", () => {
    expect(steerPrompt("追加：先运行测试")).toBe("先运行测试");
    expect(steerPrompt("/steer also update docs")).toBe("also update docs");
    expect(steerPrompt("追加")).toBeNull();
    expect(steerPrompt("追加按钮组件")).toBeNull();
  });

  it("extracts queue and native Codex setting changes", () => {
    expect(queuedPrompt("排队：运行完整测试")).toBe("运行完整测试");
    expect(settingsChange("模型 gpt-5.4")).toEqual({ kind: "model", value: "gpt-5.4" });
    expect(settingsChange("推理：high")).toEqual({ kind: "effort", value: "high" });
    expect(settingsChange("权限 只读")).toEqual({ kind: "sandbox", value: "只读" });
  });

  it("extracts project names and numeric selectors", () => {
    expect(projectSelector("切换 FastGPT")).toBe("FastGPT");
    expect(projectSelector("切换项目：agentscope")).toBe("agentscope");
    expect(projectSelector("/use 3")).toBe("3");
    expect(projectSelector("确认切换 FastGPT")).toBe("FastGPT");
    expect(projectSelector("切换")).toBeNull();
    expect(isConfirmedProjectSwitch("确认切换 FastGPT")).toBe(true);
    expect(isConfirmedProjectSwitch("切换 FastGPT")).toBe(false);
  });

  it("accepts text and pre-rendered post content as textual input", () => {
    expect(isTextualMessageType("text")).toBe(true);
    expect(isTextualMessageType("post")).toBe(true);
    expect(isTextualMessageType("image")).toBe(false);
  });

  it("recognizes supported attachments", () => {
    expect(isAttachmentMessageType("image")).toBe(true);
    expect(isAttachmentMessageType("file")).toBe(true);
    expect(isAttachmentMessageType("text")).toBe(false);
  });

  it("requires confirmation only for explicit external actions", () => {
    expect(externalActionsForPrompt("修复测试并 git commit，然后 push 到 GitHub")).toEqual([
      "commit",
      "push",
    ]);
    expect(externalActionsForPrompt("部署到测试环境")).toEqual(["deploy"]);
    expect(externalActionsForPrompt("创建 PR 并合并")).toEqual(["pull_request"]);
    expect(externalActionsForPrompt("提交这个表单组件的修复，但不要提交代码")).toEqual([]);
    expect(externalActionsForPrompt("只修改代码并运行测试")).toEqual([]);
  });

  it("detects command-time actions even when the prompt did not request them", () => {
    expect(commandPolicyDecision("git commit -am 'fix'").requiredActions).toEqual(["commit"]);
    expect(commandPolicyDecision("git -C /tmp/repo push origin main").requiredActions).toEqual([
      "push",
    ]);
    expect(commandPolicyDecision("gh pr create --fill").requiredActions).toEqual([
      "pull_request",
    ]);
    expect(
      commandPolicyDecision("/bin/zsh -lc 'git commit -am fix && git push origin main'")
        .requiredActions,
    ).toEqual(["commit", "push"]);
    expect(commandPolicyDecision("gh -R owner/repo pr create --fill").requiredActions).toEqual([
      "pull_request",
    ]);
    expect(commandPolicyDecision("npm publish").requiredActions).toEqual(["deploy"]);
    expect(commandPolicyDecision("rg -n 'git commit|gh pr create' README.md")).toEqual({
      requiredActions: [],
    });
    expect(commandPolicyDecision("echo 'git push'")).toEqual({ requiredActions: [] });
    expect(commandPolicyDecision("terraform destroy -auto-approve").blockedReason).toContain(
      "删除外部",
    );
    expect(commandPolicyDecision("curl -X DELETE https://example.com/item").blockedReason).toContain(
      "删除外部",
    );
    expect(commandPolicyDecision("gh auth login").blockedReason).toContain("凭据");
  });

  it("rejects unlisted group chats in full-access mode while keeping p2p usable", () => {
    const config = {
      allowedSenderIds: new Set(["ou_1"]),
      allowedChatIds: new Set<string>(),
      sandboxMode: "danger-full-access",
    } as BridgeConfig;
    const base = {
      type: "im.message.receive_v1" as const,
      event_id: "evt_1",
      message_id: "om_1",
      chat_id: "oc_1",
      sender_id: "ou_1",
      message_type: "text",
      content: "hello",
    };
    expect(isAuthorized({ ...base, chat_type: "p2p" }, config)).toBe(true);
    expect(isAuthorized({ ...base, chat_type: "group" }, config)).toBe(false);
  });
});
