import { spawnSync } from "node:child_process";

export function probeFeishuCapabilities(cliPath, options = {}) {
  const run = options.run ?? runCommand;
  const cwd = options.cwd ?? process.cwd();
  const checks = [];

  checks.push(
    result(
      "bot_identity",
      "飞书 Bot 身份",
      run(cliPath, ["whoami", "--as", "bot"], cwd),
      "请重新绑定飞书应用：npx lark-cli config init",
    ),
  );
  checks.push(
    eventResult(
      "message_event",
      "消息事件 im.message.receive_v1",
      run(cliPath, eventProbeArgs("im.message.receive_v1"), cwd),
      "请在飞书开发者后台启用 im.message.receive_v1，并确认消息读取权限已发布。",
    ),
  );
  checks.push(
    eventResult(
      "card_action_event",
      "卡片事件 card.action.trigger",
      run(cliPath, eventProbeArgs("card.action.trigger"), cwd),
      "请在飞书开发者后台启用 card.action.trigger，并确认 im:message:readonly 已发布。",
    ),
  );

  const projectChatChecks = projectChatScopeResults(
    run(cliPath, ["auth", "scopes", "--format", "json"], cwd),
  );
  checks.push(...projectChatChecks);

  const requiredChecks = checks.filter((check) => check.required !== false);
  const projectChatStatus = projectChatChecks.every((check) => check.ok)
    ? "ready"
    : projectChatChecks.some((check) => check.status === "missing")
      ? "missing"
      : "unknown";
  return {
    ok: requiredChecks.every((check) => check.ok),
    projectChatStatus,
    checks,
  };
}

export function eventProbeArgs(eventKey) {
  return [
    "event",
    "consume",
    eventKey,
    "--as",
    "bot",
    "--max-events",
    "0",
    "--timeout",
    "1s",
    "--quiet",
  ];
}

function eventResult(id, label, outcome, remediation) {
  if (outcome.status === 0) return { id, label, ok: true, detail: "事件订阅可用" };
  const text = `${outcome.stdout ?? ""}\n${outcome.stderr ?? ""}`;
  if (/another consumer .* already running|another consumer .* is already running/i.test(text)) {
    return { id, label, ok: true, detail: "已有运行中的事件消费者" };
  }
  return {
    id,
    label,
    ok: false,
    detail: extractError(text) || "事件订阅不可用",
    remediation,
  };
}

function result(id, label, outcome, remediation) {
  if (outcome.status === 0) return { id, label, ok: true, detail: "可用" };
  const text = `${outcome.stdout ?? ""}\n${outcome.stderr ?? ""}`;
  return {
    id,
    label,
    ok: false,
    detail: extractError(text) || "不可用",
    remediation,
  };
}

function projectChatScopeResults(outcome) {
  const definitions = [
    {
      id: "project_chat_create_scope",
      label: "项目群 · 自动建群",
      scope: "im:chat:create",
      remediation: "在飞书开发者后台开通 im:chat:create，发布应用版本后重试。",
    },
    {
      id: "project_chat_members_scope",
      label: "项目群 · 邀请成员",
      scope: "im:chat.members:write_only",
      remediation:
        "在飞书开发者后台开通 im:chat.members:write_only，发布应用版本后重试。",
    },
    {
      id: "project_chat_pin_scope",
      label: "项目群 · 置顶工作台",
      scope: "im:message.pins:write_only",
      remediation:
        "在飞书开发者后台开通 im:message.pins:write_only，发布应用版本后重试。",
    },
    {
      id: "project_chat_message_scope",
      label: "项目群 · 普通消息",
      scopes: ["im:message.group_msg", "im:message.group_msg:readonly"],
      remediation:
        "在安装机运行 feishu-codex-bridge configure-feishu --profile ordinary-group，按官方页面确认后发布应用版本；未完成前请在群内 @ 机器人。",
    },
  ];
  const payload = parseJsonOutput(`${outcome.stdout ?? ""}\n${outcome.stderr ?? ""}`);
  const appScopes = appScopeList(payload);
  if (outcome.status !== 0 || appScopes === null) {
    return definitions.map((definition) => ({
      id: definition.id,
      label: definition.label,
      ok: false,
      required: false,
      status: "unknown",
      detail: "当前 lark-cli 身份未返回应用级权限；首次使用项目群时会逐步验证",
    }));
  }
  return definitions.map((definition) => {
    const acceptedScopes = definition.scopes ?? [definition.scope];
    const ok = acceptedScopes.some((scope) => appScopes.has(scope));
    const scopeLabel = acceptedScopes.join(" 或 ");
    return {
      id: definition.id,
      label: definition.label,
      ok,
      required: false,
      status: ok ? "ready" : "missing",
      detail: ok ? `${scopeLabel} 已开通` : `缺少 ${scopeLabel}`,
      ...(!ok ? { remediation: definition.remediation } : {}),
    };
  });
}

function parseJsonOutput(text) {
  try {
    const start = text.indexOf("{");
    if (start < 0) return null;
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

function appScopeList(payload) {
  if (!payload || typeof payload !== "object") return null;
  for (const key of ["tenantScopes", "appScopes", "botScopes", "scopes"]) {
    if (Array.isArray(payload[key])) {
      return new Set(payload[key].filter((scope) => typeof scope === "string"));
    }
  }
  return null;
}

function runCommand(command, args, cwd) {
  const outcome = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: outcome.status, stdout: outcome.stdout, stderr: outcome.stderr };
}

function extractError(text) {
  try {
    const start = text.indexOf("{");
    const value = JSON.parse(start >= 0 ? text.slice(start) : text);
    if (typeof value?.error?.message === "string") return redact(value.error.message);
  } catch {
    // Fall back to the first useful line below.
  }
  return redact(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "",
  );
}

function redact(value) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:access|refresh)[_-]?token\s*[:=]\s*[^\s,;]+/gi, "token=[REDACTED]")
    .slice(0, 500);
}
