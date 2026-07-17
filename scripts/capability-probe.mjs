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

  return { ok: checks.every((check) => check.ok), checks };
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
