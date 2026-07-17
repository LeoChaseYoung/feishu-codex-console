import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { ReasoningEffort, SandboxMode } from "./types.js";

export type SafeSandboxMode = SandboxMode;
export type SafeWebSearchMode = "disabled" | "cached" | "live";

export interface BridgeConfig {
  configVersion: 1;
  projectDir: string;
  workdir: string;
  projectRoots: string[];
  projectScanDepth: number;
  maxProjects: number;
  syncSavedProjects: boolean;
  codexProjectStateFile: string;
  databaseFile: string;
  stateFile: string;
  dataDir: string;
  instanceId: string;
  serviceLabel: string;
  larkCliPath: string;
  codexCliPath?: string;
  allowedSenderIds: Set<string>;
  adminSenderIds: Set<string>;
  viewerSenderIds: Set<string>;
  allowedChatIds: Set<string>;
  groupSessionScope: "member" | "chat";
  projectAcl: Map<string, Set<string>>;
  memberLabels: Map<string, string>;
  botMentionNames: string[];
  sandboxMode: SafeSandboxMode;
  operatorSandboxMode: SafeSandboxMode;
  skipGitRepoCheck: boolean;
  networkAccessEnabled: boolean;
  webSearchMode: SafeWebSearchMode;
  multiAgentEnabled: boolean;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  maxReplyChars: number;
  codexTimeoutMs: number;
  maxSeenEvents: number;
  maxConcurrentTasks: number;
  maxQueuedPerConversation: number;
  maxAttachmentBytes: number;
  maxTextAttachmentBytes: number;
  attachmentRetentionHours: number;
  confirmationTtlMinutes: number;
  maxLogBytes: number;
  codexAllowedEnvVars: string[];
  logMessageContent: boolean;
  completionNotifications: boolean;
  autoOnboarding: boolean;
}

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function optionalEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  name: string,
): T | undefined {
  if (!value) return undefined;
  if (!allowed.includes(value as T)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function safeInstanceId(value: string | undefined): string {
  const normalized = (value?.trim() || "default")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (!normalized) throw new Error("BRIDGE_INSTANCE_ID must contain letters or numbers");
  return normalized;
}

function projectAcl(value: string | undefined): Map<string, Set<string>> {
  if (!value?.trim()) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("FEISHU_PROJECT_ACL_JSON must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("FEISHU_PROJECT_ACL_JSON must be an object of project selectors to open_id arrays");
  }
  const result = new Map<string, Set<string>>();
  for (const [selector, actors] of Object.entries(parsed)) {
    if (!Array.isArray(actors) || actors.some((actor) => typeof actor !== "string" || !actor.trim())) {
      throw new Error(`FEISHU_PROJECT_ACL_JSON entry ${selector} must be an array of open_ids`);
    }
    result.set(selector.trim(), new Set(actors.map((actor) => actor.trim())));
  }
  return result;
}

function memberLabels(value: string | undefined): Map<string, string> {
  if (!value?.trim()) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("FEISHU_MEMBER_LABELS_JSON must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("FEISHU_MEMBER_LABELS_JSON must be an object of open_ids to display names");
  }
  const result = new Map<string, string>();
  for (const [memberId, label] of Object.entries(parsed)) {
    if (!memberId.trim() || typeof label !== "string" || !label.trim()) {
      throw new Error("FEISHU_MEMBER_LABELS_JSON keys and display names must be non-empty strings");
    }
    if (label.trim().length > 60) {
      throw new Error(`FEISHU_MEMBER_LABELS_JSON display name for ${memberId} is too long`);
    }
    result.set(memberId.trim(), label.trim());
  }
  return result;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  projectDir = process.cwd(),
): BridgeConfig {
  const configVersion = positiveInt(env.BRIDGE_CONFIG_VERSION, 1, "BRIDGE_CONFIG_VERSION");
  if (configVersion !== 1) {
    throw new Error(
      `BRIDGE_CONFIG_VERSION ${configVersion} is newer than this bridge supports (1)`,
    );
  }
  const senderIds = csv(env.ALLOWED_FEISHU_OPEN_IDS);
  if (senderIds.length === 0) {
    throw new Error(
      "ALLOWED_FEISHU_OPEN_IDS is required. Refusing to start an unrestricted remote coding bot.",
    );
  }

  const requestedWorkdir = path.resolve(env.CODEX_WORKDIR || projectDir);
  if (!existsSync(requestedWorkdir)) {
    throw new Error(`CODEX_WORKDIR does not exist: ${requestedWorkdir}`);
  }
  const workdir = realpathSync(requestedWorkdir);
  const configuredRoots = csv(env.CODEX_PROJECT_ROOTS);
  const projectRoots = [
    ...new Set(
      (configuredRoots.length > 0 ? configuredRoots : [workdir]).map((root) => {
        const resolved = path.resolve(root);
        if (!existsSync(resolved)) {
          throw new Error(`CODEX_PROJECT_ROOTS entry does not exist: ${resolved}`);
        }
        return realpathSync(resolved);
      }),
    ),
  ];
  if (!projectRoots.some((root) => isWithin(root, workdir))) projectRoots.push(workdir);

  const sandboxMode = optionalEnum(
    env.CODEX_SANDBOX_MODE || "workspace-write",
    ["read-only", "workspace-write", "danger-full-access"] as const,
    "CODEX_SANDBOX_MODE",
  );
  if (!sandboxMode) throw new Error("CODEX_SANDBOX_MODE is required");
  const operatorSandboxMode = optionalEnum(
    env.CODEX_OPERATOR_SANDBOX_MODE ||
      (sandboxMode === "danger-full-access" ? "workspace-write" : sandboxMode),
    ["read-only", "workspace-write", "danger-full-access"] as const,
    "CODEX_OPERATOR_SANDBOX_MODE",
  );
  if (!operatorSandboxMode) throw new Error("CODEX_OPERATOR_SANDBOX_MODE is required");
  const sandboxRank = { "read-only": 0, "workspace-write": 1, "danger-full-access": 2 } as const;
  if (sandboxRank[operatorSandboxMode] > sandboxRank[sandboxMode]) {
    throw new Error("CODEX_OPERATOR_SANDBOX_MODE cannot exceed CODEX_SANDBOX_MODE");
  }

  const webSearchMode = optionalEnum(
    env.CODEX_WEB_SEARCH_MODE || "disabled",
    ["disabled", "cached", "live"] as const,
    "CODEX_WEB_SEARCH_MODE",
  );
  if (!webSearchMode) throw new Error("CODEX_WEB_SEARCH_MODE is required");

  const codexHome = path.resolve(env.CODEX_HOME?.trim() || path.join(homedir(), ".codex"));
  const dataDir = path.resolve(env.BRIDGE_DATA_DIR?.trim() || path.join(projectDir, "var"));
  const instanceId = safeInstanceId(env.BRIDGE_INSTANCE_ID);
  const adminIds = csv(env.FEISHU_ADMIN_OPEN_IDS);
  const bundledLarkCli = path.join(projectDir, "node_modules", ".bin", "lark-cli");

  const reasoningEffort = optionalEnum(
    env.CODEX_REASONING_EFFORT,
    ["minimal", "low", "medium", "high", "xhigh", "ultra"] as const,
    "CODEX_REASONING_EFFORT",
  );

  const config: BridgeConfig = {
    configVersion: 1,
    projectDir: realpathSync(projectDir),
    dataDir,
    instanceId,
    serviceLabel: `com.feishu-codex-bridge.${instanceId}`,
    workdir,
    projectRoots,
    projectScanDepth: positiveInt(
      env.CODEX_PROJECT_SCAN_DEPTH,
      8,
      "CODEX_PROJECT_SCAN_DEPTH",
    ),
    maxProjects: positiveInt(env.MAX_CODEX_PROJECTS, 200, "MAX_CODEX_PROJECTS"),
    syncSavedProjects: bool(env.CODEX_SYNC_SAVED_PROJECTS, false),
    codexProjectStateFile: path.resolve(
      env.CODEX_PROJECT_STATE_FILE?.trim() || path.join(codexHome, ".codex-global-state.json"),
    ),
    databaseFile: env.BRIDGE_DATABASE_FILE
      ? path.resolve(projectDir, env.BRIDGE_DATABASE_FILE)
      : path.join(dataDir, "state.sqlite"),
    stateFile: env.BRIDGE_STATE_FILE
      ? path.resolve(projectDir, env.BRIDGE_STATE_FILE)
      : path.join(dataDir, "state.json"),
    larkCliPath:
      env.LARK_CLI_PATH || (existsSync(bundledLarkCli) ? bundledLarkCli : "lark-cli"),
    allowedSenderIds: new Set(senderIds),
    adminSenderIds: new Set(adminIds.length > 0 ? adminIds : senderIds),
    viewerSenderIds: new Set(csv(env.FEISHU_VIEWER_OPEN_IDS)),
    allowedChatIds: new Set(csv(env.ALLOWED_FEISHU_CHAT_IDS)),
    groupSessionScope:
      optionalEnum(env.FEISHU_GROUP_SESSION_SCOPE || "member", ["member", "chat"] as const, "FEISHU_GROUP_SESSION_SCOPE") ?? "member",
    projectAcl: projectAcl(env.FEISHU_PROJECT_ACL_JSON),
    memberLabels: memberLabels(env.FEISHU_MEMBER_LABELS_JSON),
    botMentionNames: csv(env.FEISHU_BOT_MENTION_NAMES),
    sandboxMode,
    operatorSandboxMode,
    skipGitRepoCheck: bool(env.CODEX_SKIP_GIT_REPO_CHECK, false),
    networkAccessEnabled: bool(env.CODEX_NETWORK_ACCESS, false),
    webSearchMode,
    multiAgentEnabled: bool(env.CODEX_MULTI_AGENT_ENABLED, false),
    maxReplyChars: positiveInt(env.MAX_REPLY_CHARS, 12_000, "MAX_REPLY_CHARS"),
    codexTimeoutMs: positiveInt(env.CODEX_TIMEOUT_MS, 20 * 60_000, "CODEX_TIMEOUT_MS"),
    maxSeenEvents: positiveInt(env.MAX_SEEN_EVENTS, 2_000, "MAX_SEEN_EVENTS"),
    maxConcurrentTasks: positiveInt(env.MAX_CONCURRENT_TASKS, 2, "MAX_CONCURRENT_TASKS"),
    maxQueuedPerConversation: positiveInt(
      env.MAX_QUEUED_PER_CONVERSATION,
      5,
      "MAX_QUEUED_PER_CONVERSATION",
    ),
    maxAttachmentBytes: positiveInt(
      env.MAX_ATTACHMENT_BYTES,
      20 * 1024 * 1024,
      "MAX_ATTACHMENT_BYTES",
    ),
    maxTextAttachmentBytes: positiveInt(
      env.MAX_TEXT_ATTACHMENT_BYTES,
      128 * 1024,
      "MAX_TEXT_ATTACHMENT_BYTES",
    ),
    attachmentRetentionHours: positiveInt(
      env.ATTACHMENT_RETENTION_HOURS,
      72,
      "ATTACHMENT_RETENTION_HOURS",
    ),
    confirmationTtlMinutes: positiveInt(
      env.EXTERNAL_CONFIRMATION_TTL_MINUTES,
      10,
      "EXTERNAL_CONFIRMATION_TTL_MINUTES",
    ),
    maxLogBytes: positiveInt(env.MAX_LOG_BYTES, 10 * 1024 * 1024, "MAX_LOG_BYTES"),
    codexAllowedEnvVars: csv(env.CODEX_ALLOWED_ENV_VARS),
    logMessageContent: bool(env.LOG_MESSAGE_CONTENT, false),
    completionNotifications: bool(env.FEISHU_COMPLETION_NOTIFICATIONS, false),
    autoOnboarding: bool(env.FEISHU_AUTO_ONBOARDING, true),
  };

  if (env.CODEX_MODEL?.trim()) config.model = env.CODEX_MODEL.trim();
  if (env.CODEX_CLI_PATH?.trim()) config.codexCliPath = path.resolve(env.CODEX_CLI_PATH.trim());
  if (reasoningEffort) config.reasoningEffort = reasoningEffort;

  return config;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
