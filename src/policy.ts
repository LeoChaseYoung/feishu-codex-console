import type { BridgeConfig } from "./config.js";
import type { ExternalAction, FeishuCardActionEvent, FeishuMessageEvent } from "./types.js";
import { roleForSender } from "./team-policy.js";

export type BotCommand =
  | "help"
  | "onboarding"
  | "status"
  | "quota"
  | "new"
  | "cancel"
  | "projects"
  | "project_overview"
  | "switch_project"
  | "steer"
  | "settings"
  | "sessions"
  | "tasks"
  | "team"
  | "runbooks"
  | "runbook_run"
  | "compact"
  | "audit"
  | "queue_prompt"
  | "prompt";

export type SettingsChange =
  | { kind: "model"; value: string }
  | { kind: "effort"; value: string }
  | { kind: "sandbox"; value: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseFeishuEvent(value: unknown): FeishuMessageEvent | null {
  if (!isRecord(value)) return null;
  const requiredStrings = [
    "event_id",
    "message_id",
    "chat_id",
    "chat_type",
    "sender_id",
    "message_type",
    "content",
  ] as const;
  if (requiredStrings.some((key) => typeof value[key] !== "string")) return null;
  if (value.type !== "im.message.receive_v1") return null;
  if (value.chat_type !== "p2p" && value.chat_type !== "group") return null;

  const event: FeishuMessageEvent = {
    type: "im.message.receive_v1",
    event_id: value.event_id as string,
    message_id: value.message_id as string,
    chat_id: value.chat_id as string,
    chat_type: value.chat_type,
    sender_id: value.sender_id as string,
    message_type: value.message_type as string,
    content: value.content as string,
  };
  if (typeof value.reply_to === "string") event.reply_to = value.reply_to;
  if (typeof value.root_id === "string") event.root_id = value.root_id;
  if (typeof value.thread_id === "string") event.thread_id = value.thread_id;
  if (typeof value.create_time === "string") event.create_time = value.create_time;
  if (typeof value.timestamp === "string") event.timestamp = value.timestamp;
  return event;
}

export function parseCardActionEvent(value: unknown): FeishuCardActionEvent | null {
  if (!isRecord(value) || value.type !== "card.action.trigger") return null;
  const requiredStrings = [
    "event_id",
    "operator_id",
    "chat_id",
    "message_id",
    "token",
    "action_value",
  ] as const;
  if (requiredStrings.some((key) => typeof value[key] !== "string")) return null;
  const event: FeishuCardActionEvent = {
    type: "card.action.trigger",
    event_id: value.event_id as string,
    operator_id: value.operator_id as string,
    chat_id: value.chat_id as string,
    message_id: value.message_id as string,
    token: value.token as string,
    action_value: value.action_value as string,
    card_content: typeof value.card_content === "string" ? value.card_content : "",
  };
  if (typeof value.action_tag === "string") event.action_tag = value.action_tag;
  if (typeof value.action_name === "string") event.action_name = value.action_name;
  if (typeof value.option === "string") event.option = value.option;
  if (typeof value.timestamp === "string") event.timestamp = value.timestamp;
  return event;
}

export function isAuthorizedCardAction(
  event: FeishuCardActionEvent,
  config: BridgeConfig,
): boolean {
  if (!roleForSender(config, event.operator_id)) return false;
  return config.allowedChatIds.size === 0 || config.allowedChatIds.has(event.chat_id);
}

export function isAuthorized(event: FeishuMessageEvent, config: BridgeConfig): boolean {
  if (!roleForSender(config, event.sender_id)) return false;
  if (
    config.sandboxMode === "danger-full-access" &&
    event.chat_type === "group" &&
    !config.allowedChatIds.has(event.chat_id)
  ) {
    return false;
  }
  return config.allowedChatIds.size === 0 || config.allowedChatIds.has(event.chat_id);
}

export function isTextualMessageType(messageType: string): boolean {
  return messageType === "text" || messageType === "post";
}

export function isAttachmentMessageType(messageType: string): boolean {
  return ["image", "file", "audio", "media", "video"].includes(messageType);
}

export function externalActionsForPrompt(prompt: string): ExternalAction[] {
  const actions: ExternalAction[] = [];
  const commitPrompt = prompt.replace(
    /(?:不要|无需|不用|不需要|禁止|别)\s*(?:执行\s*)?(?:git\s+commit|commit|提交代码|代码提交|git\s*提交)/gi,
    "",
  );
  const pushPrompt = prompt.replace(
    /(?:不要|无需|不用|不需要|禁止|别)\s*(?:执行\s*)?(?:git\s+push|push|推送(?:代码|远端|分支)?)/gi,
    "",
  );
  const deployPrompt = prompt.replace(
    /(?:不要|无需|不用|不需要|禁止|别)\s*(?:执行\s*)?(?:deploy|release|publish|部署|上线|发布)/gi,
    "",
  );
  const pullRequestPrompt = prompt.replace(
    /(?:不要|无需|不用|不需要|禁止|别)\s*(?:执行\s*)?(?:创建|新建|发起|合并)?\s*(?:pull\s*request|merge\s*request|pr|mr|拉取请求|合并请求)/gi,
    "",
  );
  if (/\bgit\s+commit\b|\bcommit\b|提交代码|代码提交|git\s*提交/i.test(commitPrompt)) {
    actions.push("commit");
  }
  if (
    /\bgit\s+push\b|\bpush\b|推送(?:代码|远端|分支|到|至)|推到(?:\s*github|\s*gitlab|\s*远端)/i.test(
      pushPrompt,
    )
  ) {
    actions.push("push");
  }
  if (
    /\bdeploy\b|\brelease\b|\bpublish\b|部署|上线|发布(?:版本|到|至)/i.test(deployPrompt)
  ) {
    actions.push("deploy");
  }
  if (
    /\bgh\s+pr\s+(?:create|merge)\b|\bglab\s+mr\s+(?:create|merge)\b|\b(?:open|create|merge)\s+(?:a\s+)?(?:pull\s*request|merge\s*request|pr|mr)\b|\bpull\s*request\b|\bmerge\s*request\b|(?:创建|新建|发起|合并|提(?:交|个)?)\s*(?:pr|mr|拉取请求|合并请求)/i.test(
      pullRequestPrompt,
    )
  ) {
    actions.push("pull_request");
  }
  return actions;
}

export interface CommandPolicyDecision {
  requiredActions: ExternalAction[];
  blockedReason?: string;
}

const EXTERNAL_ACTION_LABELS: Record<ExternalAction, string> = {
  commit: "提交代码",
  push: "推送远端",
  deploy: "发布或部署",
  pull_request: "创建或合并 PR",
};

export function externalActionLabel(action: ExternalAction): string {
  return EXTERNAL_ACTION_LABELS[action];
}

/**
 * Defense in depth for full-access runs. Codex is also instructed not to perform
 * these actions, but command events let the bridge stop an unexpected mutation
 * even when the original prompt did not ask for it.
 */
export function commandPolicyDecision(command: string): CommandPolicyDecision {
  const requiredActions: ExternalAction[] = [];
  for (const invocation of shellInvocations(command)) {
    const executable = invocation.executable;
    const args = invocation.args.map((argument) =>
      argument.replace(/^\(+|\)+$/g, "").toLocaleLowerCase(),
    );

    if (
      (executable === "kubectl" && hasCommand(args, "delete")) ||
      (executable === "terraform" && hasCommand(args, "destroy")) ||
      (executable === "gh" &&
        ["repo", "issue", "release"].some((name) => hasCommandPair(args, name, "delete"))) ||
      (executable === "curl" && requestsDelete(args)) ||
      (executable === "aws" &&
        (args.some((argument) => argument.startsWith("delete")) ||
          hasCommandPair(args, "s3", "rm"))) ||
      (["gcloud", "az"].includes(executable) && args.some((argument) => argument === "delete"))
    ) {
      return { requiredActions: [], blockedReason: "禁止删除外部或云端数据" };
    }

    if (
      (executable === "gh" && hasCommand(args, "auth")) ||
      (executable === "npm" && ["login", "logout", "token"].some((name) => hasCommand(args, name))) ||
      (executable === "docker" && ["login", "logout"].some((name) => hasCommand(args, name))) ||
      (executable === "aws" && hasCommand(args, "configure")) ||
      (executable === "gcloud" && hasCommand(args, "auth")) ||
      (executable === "az" && hasCommand(args, "login")) ||
      (executable === "security" &&
        ["add-generic-password", "delete-generic-password", "add-internet-password", "delete-internet-password"].includes(
          args[0] ?? "",
        ))
    ) {
      return { requiredActions: [], blockedReason: "禁止修改凭据或登录状态" };
    }

    if (
      executable === "gh" &&
      (["create", "comment", "edit"].some((name) => hasCommandPair(args, "issue", name)) ||
        ["comment", "review"].some((name) => hasCommandPair(args, "pr", name)))
    ) {
      return { requiredActions: [], blockedReason: "禁止代表用户联系他人或发布评论" };
    }

    if (executable === "git") {
      const subcommand = gitSubcommand(args);
      if (subcommand === "commit") requiredActions.push("commit");
      if (subcommand === "push") requiredActions.push("push");
    }
    if (
      (executable === "gh" &&
        ["create", "merge"].some((name) => hasCommandPair(args, "pr", name))) ||
      (executable === "glab" &&
        ["create", "merge"].some((name) => hasCommandPair(args, "mr", name)))
    ) {
      requiredActions.push("pull_request");
    }
    if (
      (["npm", "pnpm", "yarn", "cargo"].includes(executable) && hasCommand(args, "publish")) ||
      (executable === "twine" && hasCommand(args, "upload")) ||
      (executable === "docker" && hasCommand(args, "push")) ||
      (executable === "gh" && hasCommandPair(args, "release", "create")) ||
      (executable === "kubectl" && ["apply", "rollout"].some((name) => hasCommand(args, name))) ||
      (executable === "kubectl" && hasCommandPair(args, "set", "image")) ||
      (executable === "helm" && ["install", "upgrade"].some((name) => hasCommand(args, name))) ||
      (executable === "terraform" && hasCommand(args, "apply")) ||
      (["fly", "firebase"].includes(executable) && hasCommand(args, "deploy")) ||
      (executable === "vercel" && args.includes("--prod")) ||
      (executable === "netlify" && hasCommand(args, "deploy") && args.includes("--prod"))
    ) {
      requiredActions.push("deploy");
    }
  }
  return { requiredActions: [...new Set(requiredActions)] };
}

interface ShellInvocation {
  executable: string;
  args: string[];
}

function shellInvocations(command: string, depth = 0): ShellInvocation[] {
  if (depth > 3) return [];
  return splitShellSegments(command.replace(/\\\n/g, " ")).flatMap((segment) => {
    const tokens = shellTokens(segment);
    if (tokens.length === 0) return [];
    return unwrapInvocation(tokens, depth);
  });
}

function unwrapInvocation(tokens: string[], depth: number): ShellInvocation[] {
  let cursor = 0;
  while (cursor < tokens.length && isAssignment(tokens[cursor] ?? "")) cursor += 1;
  const executable = executableName(tokens[cursor] ?? "");

  if (executable === "env") {
    cursor += 1;
    while (cursor < tokens.length) {
      const token = tokens[cursor] ?? "";
      if (token === "-u" || token === "--unset") cursor += 2;
      else if (token.startsWith("-") || isAssignment(token)) cursor += 1;
      else break;
    }
    return unwrapInvocation(tokens.slice(cursor), depth);
  }

  if (executable === "sudo") {
    cursor += 1;
    while (cursor < tokens.length) {
      const token = tokens[cursor] ?? "";
      if (["-u", "-g", "-h", "-p", "-C", "-T"].includes(token)) cursor += 2;
      else if (token.startsWith("-")) cursor += 1;
      else break;
    }
    return unwrapInvocation(tokens.slice(cursor), depth);
  }

  if (["command", "nohup", "time"].includes(executable)) {
    cursor += 1;
    while ((tokens[cursor] ?? "").startsWith("-")) cursor += 1;
    return unwrapInvocation(tokens.slice(cursor), depth);
  }

  if (["bash", "zsh", "sh", "dash"].includes(executable)) {
    const commandIndex = tokens.findIndex(
      (token, index) => index > cursor && (/^-[a-z]*c[a-z]*$/i.test(token) || token === "--command"),
    );
    const nested = commandIndex >= 0 ? tokens[commandIndex + 1] : undefined;
    return nested ? shellInvocations(nested, depth + 1) : [];
  }

  if (!executable) return [];
  return [{ executable, args: tokens.slice(cursor + 1) }];
}

function splitShellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] ?? "";
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if ([";", "|", "&", "\n"].includes(character)) {
      if (current.trim()) segments.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

function shellTokens(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  const push = () => {
    if (current) tokens.push(current);
    current = "";
  };
  for (const character of segment.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) push();
    else current += character;
  }
  push();
  return tokens;
}

function executableName(token: string): string {
  return token.replace(/^\(+/, "").split("/").at(-1)?.toLocaleLowerCase() ?? "";
}

function isAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function gitSubcommand(args: string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? "";
    if (["-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"].includes(argument)) {
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) continue;
    return argument;
  }
  return "";
}

function hasCommand(args: string[], command: string): boolean {
  return args.some((argument) => argument === command);
}

function hasCommandPair(args: string[], first: string, second: string): boolean {
  return args.some((argument, index) => argument === first && args[index + 1] === second);
}

function requestsDelete(args: string[]): boolean {
  return args.some(
    (argument, index) =>
      argument === "--request=delete" ||
      ((argument === "-x" || argument === "--request") && args[index + 1] === "delete"),
  );
}

export function normalizePrompt(
  content: string,
  chatType: FeishuMessageEvent["chat_type"],
  botMentionNames: string[],
): string {
  let prompt = content.trim();
  if (chatType === "group") {
    for (const name of botMentionNames) {
      const prefix = `@${name}`;
      if (prompt.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
        prompt = prompt.slice(prefix.length).trimStart();
        break;
      }
    }
  }
  return prompt.trim();
}

export function classifyCommand(prompt: string): BotCommand {
  const normalized = prompt.trim().toLocaleLowerCase();
  if (["帮助", "help", "/help"].includes(normalized)) return "help";
  if (
    [
      "新手引导",
      "使用指南",
      "快速开始",
      "onboarding",
      "/onboarding",
      "/start",
    ].includes(normalized)
  ) {
    return "onboarding";
  }
  if (
    [
      "状态",
      "控制台",
      "设备",
      "status",
      "/status",
      "device",
      "/device",
    ].includes(normalized)
  ) {
    return "status";
  }
  if (
    ["额度", "配额", "用量", "usage", "/usage", "quota", "/quota"].includes(
      normalized,
    )
  ) {
    return "quota";
  }
  if (["新会话", "new", "/new", "reset", "/reset"].includes(normalized)) return "new";
  if (["会话", "历史会话", "sessions", "/sessions"].includes(normalized)) return "sessions";
  if (["任务", "任务中心", "tasks", "/tasks"].includes(normalized)) return "tasks";
  if (["团队", "团队工作台", "team", "/team"].includes(normalized)) return "team";
  if (["运行手册", "手册", "runbooks", "/runbooks"].includes(normalized)) return "runbooks";
  if (/^(?:运行手册|运行|run|\/run)\s+[a-z0-9][a-z0-9_-]*/i.test(prompt.trim())) {
    return "runbook_run";
  }
  if (["压缩", "压缩会话", "compact", "/compact"].includes(normalized)) return "compact";
  if (["审计", "审计日志", "audit", "/audit"].includes(normalized)) return "audit";
  if (
    ["设置", "模型", "推理", "权限", "settings", "/settings", "model", "/model"].includes(
      normalized,
    ) ||
    /^(?:模型|model|\/model|推理|effort|\/effort|权限|permission|\/permission)(?:\s|[:：])/i.test(
      prompt.trim(),
    )
  ) {
    return "settings";
  }
  if (
    ["取消", "停止", "cancel", "/cancel", "stop", "/stop", "interrupt", "/interrupt"].includes(
      normalized,
    )
  ) {
    return "cancel";
  }
  if (
    ["项目", "项目列表", "项目工作台", "projects", "/projects"].includes(normalized)
  ) {
    return "projects";
  }
  if (
    [
      "读取项目",
      "阅读项目",
      "项目概览",
      "项目摘要",
      "overview",
      "/overview",
    ].includes(normalized)
  ) {
    return "project_overview";
  }
  if (/^(?:确认切换|切换项目|切换到项目|切换到|切换|use|\/use)(?:\s|[:：]|$)/i.test(prompt.trim())) {
    return "switch_project";
  }
  if (/^(?:追加|补充|steer|\/steer)(?:\s|[:：]|$)/i.test(prompt.trim())) return "steer";
  if (/^(?:排队|稍后执行|queue|\/queue)(?:\s|[:：]|$)/i.test(prompt.trim())) {
    return "queue_prompt";
  }
  return "prompt";
}

export function projectSelector(prompt: string): string | null {
  const match = prompt
    .trim()
    .match(/^(?:确认切换|切换项目|切换到项目|切换到|切换|use|\/use)\s*[:：]?\s*(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function isConfirmedProjectSwitch(prompt: string): boolean {
  return /^确认切换(?:\s|[:：])/i.test(prompt.trim());
}

export function steerPrompt(prompt: string): string | null {
  const match = prompt
    .trim()
    .match(/^(?:追加|补充|steer|\/steer)(?:\s+|[:：]\s*)(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function queuedPrompt(prompt: string): string | null {
  const match = prompt
    .trim()
    .match(/^(?:排队|稍后执行|queue|\/queue)(?:\s+|[:：]\s*)(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function settingsChange(prompt: string): SettingsChange | null {
  const match = prompt
    .trim()
    .match(/^(模型|model|\/model|推理|effort|\/effort|权限|permission|\/permission)(?:\s+|[:：]\s*)(.+)$/i);
  if (!match?.[1] || !match[2]?.trim()) return null;
  const command = match[1].toLocaleLowerCase();
  if (["模型", "model", "/model"].includes(command)) {
    return { kind: "model", value: match[2].trim() };
  }
  if (["推理", "effort", "/effort"].includes(command)) {
    return { kind: "effort", value: match[2].trim() };
  }
  return { kind: "sandbox", value: match[2].trim() };
}

export const HELP_TEXT = [
  "飞书 Codex V5 已就绪。直接发送开发任务、截图或文本/代码文件即可。",
  "",
  "可用命令：",
  "- 新手引导 / /start：打开一分钟交互式上手流程",
  "- 状态 / 控制台：查看本地设备、当前项目与远程就绪开关",
  "- 额度 / /usage：查看 Codex 各独立额度窗口与重置时间",
  "- 项目 / /projects：打开项目工作台",
  "- 读取项目 / /overview：生成零 AI token 的本地项目快照",
  "- 设置 / 模型：切换模型、推理强度和后续任务权限",
  "- 会话 / /sessions：恢复或压缩本人在当前项目的历史会话",
  "- 任务 / /tasks：查看我的运行中、排队和最近任务",
  "- 团队 / /team：查看成员、项目负载与资源使用概览",
  "- 运行手册 / /runbooks：打开仓库内审核过的团队任务模板",
  "- /run <手册> 参数=值：使用显式参数运行团队模板",
  "- 审计 / /audit：查看最近的安全与操作记录",
  "- 切换 <项目> / /use <编号>：预览切换影响；有任务或会话时需确认",
  "- 追加 <要求> / /steer <要求>：把补充要求加入正在执行的任务",
  "- 排队 <任务> / /queue <任务>：当前任务运行时仍创建一个独立任务",
  "- 新会话 / new：清空当前聊天对应的 Codex 上下文",
  "- 停止 / /stop：停止正在执行的任务，并移除本聊天的排队任务",
  "- 帮助 / help：显示本说明",
  "",
  "团队模式：群聊默认按成员隔离会话；管理员可管理全局，操作者只能控制自己的任务，只读成员不能执行代码。项目 ACL 可进一步限制成员可见项目。",
  "安全限制：只能操作允许列表中的项目；提交、推送、部署和创建/合并 PR 必须先在确认卡中同意；凭据、联系人和外部数据不允许修改。完全访问模式下，未加入聊天白名单的群聊会被拒绝。",
].join("\n");
