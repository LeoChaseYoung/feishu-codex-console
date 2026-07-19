import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

import { registerApp } from "@larksuiteoapi/node-sdk";

export const FEISHU_APP_PROFILES = Object.freeze({
  core: Object.freeze({
    label: "核心聊天",
    description: "私聊、群内 @、卡片交互和附件",
    tenantScopes: Object.freeze([
      "cardkit:card:read",
      "cardkit:card:write",
      "im:message.group_at_msg:readonly",
      "im:message.p2p_msg:readonly",
      "im:message:readonly",
      "im:message:send_as_bot",
      "im:message:update",
      "im:resource",
    ]),
    events: Object.freeze(["im.message.receive_v1"]),
    callbacks: Object.freeze(["card.action.trigger"]),
  }),
  "project-chat": Object.freeze({
    label: "项目群",
    description: "自动建群、邀请成员、置顶工作台和接收群内普通消息",
    tenantScopes: Object.freeze([
      "im:chat:create",
      "im:chat.members:write_only",
      "im:chat:read",
      "im:message.group_msg",
      "im:message.pins:read",
      "im:message.pins:write_only",
    ]),
    events: Object.freeze(["im.message.receive_v1"]),
    callbacks: Object.freeze([]),
  }),
  "ordinary-group": Object.freeze({
    label: "群内普通消息",
    description: "在固定项目群中无需 @ 机器人即可发起任务",
    tenantScopes: Object.freeze(["im:message.group_msg"]),
    events: Object.freeze(["im.message.receive_v1"]),
    callbacks: Object.freeze([]),
  }),
});

export function buildFeishuAppAddons(profile = "all") {
  const selected = profile === "all"
    ? [FEISHU_APP_PROFILES.core, FEISHU_APP_PROFILES["project-chat"]]
    : [FEISHU_APP_PROFILES[profile]].filter(Boolean);
  if (selected.length === 0) {
    throw new Error(`未知飞书权限方案：${profile}。支持 all、core、project-chat、ordinary-group。`);
  }
  return {
    preset: false,
    scopes: {
      tenant: unique(selected.flatMap((item) => item.tenantScopes)),
    },
    events: {
      items: {
        tenant: unique(selected.flatMap((item) => item.events)),
      },
    },
    callbacks: {
      items: unique(selected.flatMap((item) => item.callbacks)),
    },
  };
}

export function permissionPlan(profile = "all") {
  const addons = buildFeishuAppAddons(profile);
  return {
    profile,
    label: profile === "all" ? "本产品所需最小权限" : FEISHU_APP_PROFILES[profile].label,
    scopes: addons.scopes.tenant,
    events: addons.events.items.tenant,
    callbacks: addons.callbacks.items,
  };
}

export function detectBotAppId(cliPath, cwd = process.cwd()) {
  const outcome = spawnSync(cliPath, ["whoami", "--as", "bot"], {
    cwd,
    env: quietCliEnvironment(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (outcome.status !== 0) {
    throw new Error("尚未绑定飞书应用，请先运行 npx lark-cli config init --new。");
  }
  const payload = parseJson(outcome.stdout);
  const appId = payload?.appId ?? payload?.profile;
  if (typeof appId !== "string" || !/^cli_[A-Za-z0-9]+$/.test(appId)) {
    throw new Error("无法从当前飞书 Bot 身份识别 App ID。");
  }
  return appId;
}

export async function configureFeishuApplication(options) {
  const profile = options.profile ?? "all";
  const plan = permissionPlan(profile);
  const appId = options.appId ?? detectBotAppId(options.cliPath, options.cwd);
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await registerApp({
      appId,
      addons: buildFeishuAppAddons(profile),
      source: "feishu-codex-console",
      signal: controller.signal,
      onQRCodeReady(info) {
        options.onVerificationUrl?.({ ...info, appId, plan });
        if (options.openBrowser !== false) openExternal(info.url);
      },
      onStatusChange(info) {
        options.onStatusChange?.(info);
      },
    });
    if (result.client_id !== appId) {
      throw new Error("飞书返回了不同的应用，已停止继续；当前配置没有被替换。");
    }
    return { appId, plan };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("授权链接已超时，请重新运行命令生成新链接。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function unique(values) {
  return [...new Set(values)].sort();
}

function parseJson(text) {
  try {
    const start = text.indexOf("{");
    return start >= 0 ? JSON.parse(text.slice(start)) : null;
  } catch {
    return null;
  }
}

function quietCliEnvironment() {
  return {
    ...process.env,
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
    LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
  };
}

function openExternal(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}
