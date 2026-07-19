import "dotenv/config";

import { createHash } from "node:crypto";
import { arch, hostname, platform, release } from "node:os";
import { basename, extname, join } from "node:path";

import { TaskCardSession } from "./card-session.js";
import { unavailableAccountQuota } from "./account-quota.js";
import { formatAccountQuotaText } from "./account-quota-card.js";
import { ConversationTurnSession } from "./conversation-turn-session.js";
import {
  CodexCancelledError,
  CodexPolicyViolationError,
  CodexRunner,
  type CodexModel,
  type CodexThreadSummary,
} from "./codex-runner.js";
import { openCodexThreadInDesktop } from "./desktop-handoff.js";
import type {
  CodexApprovalDecision,
  CodexApprovalRequest,
  CodexQuestion,
  CodexQuestionRequest,
} from "./codex-events.js";
import { renderExternalConfirmationCard } from "./confirmation-card.js";
import { loadConfig } from "./config.js";
import {
  reasoningEffortLabel,
  renderControlCenterCard,
  type ControlCenterSnapshot,
} from "./control-card.js";
import {
  renderDeviceCard,
  type DeviceConsoleSnapshot,
} from "./device-card.js";
import { deriveDeviceAvailability } from "./device-health.js";
import { FallbackCardSession } from "./fallback-card-session.js";
import { FIRST_SUCCESS_PROMPT } from "./first-success.js";
import { eventSummary, LarkCli, logRef } from "./lark-cli.js";
import {
  readBridgeHealth,
  removeBridgeHealth,
  writeBridgeHealth,
  type BridgeHealthStatus,
} from "./health-file.js";
import {
  cleanupAttachmentCache,
  isSupportedImageFile,
  isUtf8TextFile,
  trimRuntimeLogs,
} from "./maintenance.js";
import {
  compatibleModelSettings,
  resolveModelPreference,
} from "./model-capabilities.js";
import {
  renderPrivateHomeCard,
  type PrivateHomeSnapshot,
} from "./home-card.js";
import {
  renderOnboardingCard,
  type OnboardingSnapshot,
} from "./onboarding-card.js";
import {
  FULL_ACCESS_ONCE_TTL_MINUTES,
  FULL_ACCESS_SESSION_TTL_MINUTES,
  FULL_ACCESS_TIMED_TTL_MINUTES,
  permissionLeaseLabel,
  persistentSandboxMode,
} from "./permission-lease.js";
import {
  classifyCommand,
  canReceiveUnboundGroupGuidance,
  externalActionLabel,
  externalActionsForPrompt,
  HELP_TEXT,
  hasConfiguredBotMention,
  isAttachmentMessageType,
  isAuthorized,
  isAuthorizedCardAction,
  isConfirmedProjectSwitch,
  isTextualMessageType,
  normalizePrompt,
  parseCardActionEvent,
  parseFeishuEvent,
  projectSelector,
  queuedPrompt,
  settingsChange,
  steerPrompt,
  type SettingsChange,
} from "./policy.js";
import {
  applyCodexEvent,
  attachTaskReview,
  cancelTask as cancelTaskProgress,
  createTaskProgress,
  failTask,
  interruptTask as interruptTaskProgress,
  noteSteer,
  recoverTask as recoverTaskProgress,
  startTask,
  succeedTask,
  testEvidenceState,
  updateTaskCollaboration,
  updateQueuePosition,
  type TaskProgressContext,
  type TaskProgress,
} from "./progress.js";
import { projectGroupBindingCardFailureText, renderProjectCard } from "./project-card.js";
import {
  ProjectChatService,
  isProjectChatReady,
  projectChatSetupStatusText,
  type ProjectChatSetupResult,
  type ProjectChatTarget,
} from "./project-chat-service.js";
import {
  renderProjectOverviewCard,
  renderProjectOverviewText,
} from "./project-overview-card.js";
import { readProjectOverview } from "./project-overview.js";
import {
  applyProjectSandboxMaximum,
  decideProjectActions,
  defaultProjectPolicy,
  loadProjectPolicy,
  projectPolicySummary,
  ProjectPolicyError,
} from "./project-policy.js";
import { readProjectGitStatus } from "./project-status.js";
import {
  ProjectRegistry,
  type CodexProject,
  type ProjectResolution,
} from "./project-registry.js";
import { rankProjectWorkspace, resolveProjectSelector } from "./project-workspace.js";
import { readPowerStatus, RemoteReadyController } from "./remote-ready.js";
import { renderQuotaCard } from "./quota-card.js";
import { assessBridgeRecovery, shouldSendRecoveryNotice } from "./recovery-policy.js";
import {
  installConsoleRedaction,
  redactSensitiveText,
  safeErrorText,
} from "./redaction.js";
import { renderTaskResultCard } from "./result-card.js";
import {
  renderReviewCard,
  type ReviewCardSnapshot,
} from "./review-card.js";
import {
  renderRunbookCenterCard,
  type RunbookCenterSnapshot,
} from "./runbook-card.js";
import {
  loadProjectRunbooks,
  parseRunbookInvocation,
  renderRunbookPrompt,
  type RunbookDefinition,
} from "./runbooks.js";
import { renderSessionCenterCard } from "./session-card.js";
import {
  assessSessionHandoff,
  deriveThreadActivity,
  type SessionCenterItem,
} from "./session-handoff.js";
import { sessionNameFromPrompt } from "./session-naming.js";
import { sanitizeSessionPreview } from "./session-preview.js";
import { StateStore } from "./state-store.js";
import {
  renderRuntimeApprovalCard,
  renderRuntimeQuestionCard,
  type RuntimeApprovalState,
} from "./runtime-card.js";
import { QueueCapacityError, TaskQueue } from "./task-queue.js";
import {
  captureTaskReview,
  captureTaskReviewBaseline,
  readTaskFileDiff,
} from "./task-review.js";
import { reconcilePersistedTask } from "./task-reconciliation.js";
import {
  memberLabel,
  memberSelector,
  operatingTeamMembers,
  resolveMemberSelector,
  teamMemberOptionLabel,
  teamMembers,
} from "./team-directory.js";
import {
  renderTeamDashboardCard,
  type TeamDashboardSnapshot,
  type TeamMemberMetric,
} from "./team-card.js";
import {
  renderTaskCenterCard,
  type TaskCenterSnapshot,
} from "./task-center-card.js";
import {
  inferTaskMode,
  runningActivity,
  sandboxForTaskMode,
  shouldClarifyContextualFollowUp,
  shouldStartFreshAnswerThread,
  taskModeAllowsWrites,
  taskModeCapturesReview,
  taskModeLabel,
  taskModeOf,
  type TaskMode,
} from "./task-intent.js";
import {
  canAccessProject,
  canAdminister,
  canControlOwnedResource,
  canControlTask,
  canTakeOverTask,
  canViewOwnedResource,
  canViewTask,
  canOperate,
  conversationKeyForCard,
  conversationKeyForEvent,
  isSandboxModeAllowed,
  roleForSender,
  roleLabel,
  selectableSandboxModes,
  visibleProjects,
} from "./team-policy.js";
import type {
  AuditEvent,
  ConversationPreferences,
  ExternalAction,
  FeishuCardActionEvent,
  FeishuMessageEvent,
  OnboardingState,
  PermissionLeaseScope,
  PersistedConfirmationState,
  PersistedTaskState,
  ProjectChatBinding,
  ReasoningEffort,
  SandboxMode,
  TaskAttachment,
  TaskExecutionSettings,
  TaskRecordStatus,
} from "./types.js";
import { PACKAGE_ROOT, PACKAGE_VERSION } from "./version.js";
import {
  chatIdFromConversationKey,
  isTopicConversationKey,
  workspaceSessionForEvent,
  workspaceSessionForPrompt,
  type WorkspaceSessionAddress,
} from "./workspace-session.js";

installConsoleRedaction();

const config = loadConfig();
const state = new StateStore(config.databaseFile, config.maxSeenEvents, config.stateFile);
const queue = new TaskQueue(config.maxConcurrentTasks, config.maxQueuedPerConversation);
const runner = new CodexRunner(config);
const remoteReady = new RemoteReadyController();
const projectRegistry = new ProjectRegistry(
  config.projectRoots,
  config.workdir,
  config.projectScanDepth,
  config.maxProjects,
  config.syncSavedProjects ? config.codexProjectStateFile : undefined,
);
const lark = new LarkCli({
  binary: config.larkCliPath,
  cwd: config.projectDir,
  maxReplyChars: config.maxReplyChars,
});
const projectChatService = new ProjectChatService({
  findByProject: (projectPath) => state.getProjectChatByProject(projectPath),
  createRemoteChat: async (target) =>
    lark.createProjectChat(
      projectChatName(target.projectName),
      projectChatDescription(target.projectName),
      target.ownerId,
      target.creationKey,
    ),
  persistCreatedBinding: async (target, created) =>
    state.upsertProjectChat({
      chatId: created.chatId,
      projectPath: target.projectPath,
      ownerId: target.ownerId,
      name: created.name,
      origin: "created",
      membersStatus: "pending",
      membersFingerprint: null,
      workspaceStatus: "pending",
      pinStatus: "pending",
      messageStatus: "pending",
      workspaceCardId: null,
      workspaceMessageId: null,
      lastErrorStep: null,
      lastError: null,
      lastAttemptAt: new Date().toISOString(),
    }),
  prepareBinding: prepareProjectChatBinding,
  syncMembers: async (chatId, memberIds) => {
    const result = await lark.addChatMembers(chatId, memberIds);
    return {
      added: Math.max(0, result.requested - result.unavailable - result.pendingApproval),
      unavailable: result.unavailable,
      pendingApproval: result.pendingApproval,
    };
  },
  publishWorkspace: publishProjectChatWorkspace,
  pinMessage: (messageId) => lark.pinMessage(messageId),
  updateBinding: (chatId, patch) => state.updateProjectChatSetup(chatId, patch),
});
const shutdownController = new AbortController();
const bridgeStartedAt = new Date().toISOString();
let healthTimer: NodeJS.Timeout | null = null;
let ownsHealthMarker = false;

interface TaskRecord {
  id: string;
  conversationKey: string;
  ownerId: string;
  controllerId: string;
  prompt: string;
  project: CodexProject;
  status: TaskRecordStatus;
  card: TaskCardSession | null;
  conversation: ConversationTurnSession | null;
  fallbackCard: FallbackCardSession | null;
  progress: TaskProgress;
  replyToMessageId: string;
  seed: string;
  attachments: TaskAttachment[];
  allowedExternalActions: ExternalAction[];
  settings: TaskExecutionSettings;
  allowThreadBinding: boolean;
  replyInThread: boolean;
  freshThread: boolean;
}

interface TaskLaunchOptions {
  runbook?: { id: string; name: string };
  settings?: Partial<TaskExecutionSettings>;
  replyInThread?: boolean;
  freshThread?: boolean;
}

interface TaskCardActionValue {
  bridge: "feishu-codex-v2" | "feishu-codex-v3";
  action:
    | "cancel"
    | "retry"
    | "new"
    | "changes"
    | "review"
    | "result"
    | "result_back"
    | "handoff"
    | "takeover";
  task_id: string;
}

interface ReviewCardActionValue {
  bridge: "feishu-codex-v6";
  action:
    | "review_page"
    | "review_file"
    | "review_refresh"
    | "review_back"
    | "review_diff_page"
    | "review_close";
  task_id: string;
  page?: number;
  file_index?: number;
  diff_page?: number;
}

interface RunbookCardActionValue {
  bridge: "feishu-codex-v7";
  action: "runbook_run" | "runbook_refresh" | "runbook_projects" | "runbook_team";
  runbook_id?: string;
}

interface ProjectCardActionValue {
  bridge: "feishu-codex-v2" | "feishu-codex-v3";
  action: "select_project" | "toggle_project_favorite" | "project_chat";
}

interface ConfirmationCardActionValue {
  bridge: "feishu-codex-v3";
  action: "approve_external" | "reject_external";
  request_id: string;
}

interface RuntimeCardActionValue {
  bridge: "feishu-codex-v4";
  action:
    | "approve_runtime_once"
    | "approve_runtime_session"
    | "reject_runtime"
    | "answer_runtime"
    | "cancel_runtime_question";
  request_id: string;
  question_id?: string;
  answer?: string;
}

interface DeviceCardActionValue {
  bridge: "feishu-codex-v4";
  action:
    | "device_refresh"
    | "device_quota"
    | "device_projects"
    | "device_settings"
    | "device_sessions"
    | "device_tasks"
    | "device_new_session"
    | "device_stop"
    | "device_reconnect"
    | "quota_refresh"
    | "quota_device"
    | "remote_ready_enable"
    | "remote_ready_disable";
}

interface V5CardActionValue {
  bridge: "feishu-codex-v5";
  action:
    | "select_model"
    | "select_effort"
    | "select_sandbox"
    | "settings_refresh"
    | "settings_sessions"
    | "settings_tasks"
    | "settings_new"
    | "lease_full_once"
    | "lease_full_30m"
    | "lease_full_session"
    | "lease_full_revoke"
    | "select_session"
    | "session_compact"
    | "session_new"
    | "session_settings"
    | "session_open_desktop"
    | "session_refresh"
    | "tasks_stop"
    | "tasks_cancel_one"
    | "tasks_review"
    | "tasks_new"
    | "tasks_settings"
    | "tasks_refresh"
    | "team_tasks"
    | "team_runbooks"
    | "team_projects"
    | "team_refresh"
    | "home_first_task"
    | "home_new_session"
    | "home_projects"
    | "home_sessions"
    | "home_device"
    | "home_project_chat"
    | "home_refresh"
    | "onboarding_start"
    | "onboarding_first_task"
    | "onboarding_home"
    | "onboarding_device"
    | "onboarding_dismiss"
    | "onboarding_projects"
    | "onboarding_settings"
    | "onboarding_next"
    | "onboarding_sessions"
    | "onboarding_tasks"
    | "onboarding_back"
    | "onboarding_finish"
    | "onboarding_restart";
  task_id?: string;
}

type CardActionValue =
  | TaskCardActionValue
  | ProjectCardActionValue
  | ConfirmationCardActionValue
  | RuntimeCardActionValue
  | DeviceCardActionValue
  | V5CardActionValue
  | ReviewCardActionValue
  | RunbookCardActionValue;

interface ProjectCardRecord {
  cardId: string;
  conversationKey: string;
  ownerId: string;
  sequence: number;
  createdAt: number;
}

interface DeviceCardRecord {
  cardId: string;
  conversationKey: string;
  ownerId: string;
  sequence: number;
  createdAt: number;
}

interface PendingConfirmation {
  id: string;
  seed: string;
  conversationKey: string;
  ownerId: string;
  prompt: string;
  project: CodexProject;
  actions: ExternalAction[];
  attachments: TaskAttachment[];
  cardId: string;
  messageId: string;
  sequence: number;
  replyInThread?: boolean;
  createdAt: string;
  expiresAt: string;
}

interface ControlCardRecord {
  cardId: string;
  conversationKey: string;
  ownerId: string;
  sequence: number;
  createdAt: number;
}

interface ReviewCardRecord extends ControlCardRecord {
  taskId: string;
  page: number;
  selectedFileIndex?: number;
  diffPage?: number;
  embedded?: boolean;
}

interface PendingRuntimeApproval {
  id: string;
  taskId: string;
  conversationKey: string;
  request: CodexApprovalRequest;
  projectLabel: string;
  cardId: string;
  messageId: string;
  sequence: number;
  timer: NodeJS.Timeout;
  resolve: (decision: CodexApprovalDecision) => void;
}

interface PendingRuntimeQuestion {
  id: string;
  taskId: string;
  conversationKey: string;
  question: CodexQuestion;
  position: { index: number; total: number };
  ttlMinutes: number;
  cardId: string;
  messageId: string;
  sequence: number;
  timer: NodeJS.Timeout;
  resolve: (answers: string[]) => void;
}

const tasks = new Map<string, TaskRecord>();
const projectCards = new Map<string, ProjectCardRecord>();
const projectChatCardRefreshes = new Map<string, Promise<void>>();
const deviceCards = new Map<string, DeviceCardRecord>();
const controlCards = new Map<string, ControlCardRecord>();
const sessionCards = new Map<string, ControlCardRecord>();
const taskCenterCards = new Map<string, ControlCardRecord>();
const teamCards = new Map<string, ControlCardRecord>();
const runbookCards = new Map<string, ControlCardRecord>();
const homeCards = new Map<string, ControlCardRecord>();
const onboardingCards = new Map<string, ControlCardRecord>();
const reviewCards = new Map<string, ReviewCardRecord>();
const pendingConfirmations = new Map<string, PendingConfirmation>();
const pendingRuntimeApprovals = new Map<string, PendingRuntimeApproval>();
const pendingRuntimeQuestions = new Map<string, PendingRuntimeQuestion>();
const pendingQuestionByConversation = new Map<string, string>();
const inFlightEvents = new Set<string>();
const runtimeHealth = {
  startedAt: Date.now(),
  lastCardActionAt: 0,
  completedTasks: 0,
  failedTasks: 0,
  blockedCommands: 0,
};
let maintenanceTimer: NodeJS.Timeout | null = null;
let outboxTimer: NodeJS.Timeout | null = null;
let outboxReplayPromise: Promise<void> | null = null;
const taskPersistTimers = new Map<string, NodeJS.Timeout>();

const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".csv",
  ".log",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".css",
  ".scss",
  ".html",
  ".xml",
  ".sql",
  ".sh",
]);

function key(event: FeishuMessageEvent): string {
  return conversationKeyForEvent(event, config);
}

async function preparePromptWorkspaceSession(
  event: FeishuMessageEvent,
  ownerId: string,
): Promise<WorkspaceSessionAddress> {
  const session = workspaceSessionForPrompt(event, config);
  if (
    session.conversationKey === session.baseConversationKey ||
    state.getProject(session.conversationKey)
  ) {
    return session;
  }

  const project = await currentProject(session.baseConversationKey, ownerId);
  await state.setProject(session.conversationKey, project.path);
  const preferences = state.getPreferences(session.baseConversationKey);
  if (preferences) {
    const { updatedAt: _updatedAt, ...copy } = preferences;
    await state.setPreferences(session.conversationKey, copy);
  }
  await audit(
    ownerId,
    "session.topic_create",
    "session",
    session.conversationKey,
    "allowed",
    project.name,
  );
  return session;
}

function cardKey(event: FeishuCardActionEvent): string {
  return conversationKeyForCard(
    event.chat_id,
    event.operator_id,
    state.getChatType(event.chat_id),
    config,
  );
}

function onboardingStateKey(conversationKey: string, ownerId: string): string {
  return `${conversationKey}::onboarding::${ownerId}`;
}

function makeTaskId(seed: string): string {
  const clean = seed.replace(/[^a-zA-Z0-9]/g, "").slice(-8);
  const fallback = Date.now().toString(36).slice(-8);
  let candidate = clean || fallback;
  let suffix = 1;
  while (tasks.has(candidate)) {
    candidate = `${(clean || fallback).slice(0, 6)}${suffix.toString(36).padStart(2, "0")}`;
    suffix += 1;
  }
  return candidate;
}

function replyKey(seed: string, phase: string): string {
  return `${seed}-${phase}`;
}

async function reply(event: FeishuMessageEvent, text: string, phase: string): Promise<void> {
  const session = workspaceSessionForEvent(event, config);
  const idempotencyKey = replyKey(event.event_id, phase);
  try {
    await lark.replyMarkdown(
      event.message_id,
      redactSensitiveText(text),
      idempotencyKey,
      session.replyInThread,
    );
  } catch (error) {
    console.warn(`[bridge] natural reply unavailable phase=${phase}; using text fallback`, error);
    await durableReply(event.message_id, text, `${idempotencyKey}-text-fallback`);
  }
}

async function productReply(
  messageId: string,
  text: string,
  idempotencyKey: string,
  phase: string,
): Promise<FallbackCardSession | null> {
  try {
    return await FallbackCardSession.create(
      lark,
      messageId,
      text,
      phase,
      idempotencyKey,
    );
  } catch (error) {
    console.warn(`[bridge] product reply card unavailable phase=${phase}; using text fallback`, error);
    await durableReply(messageId, text, `${idempotencyKey}-text-fallback`);
    return null;
  }
}

async function updateTaskFallbackCard(
  record: TaskRecord,
  text: string,
  phase: string,
  idempotencyKey: string,
): Promise<void> {
  if (record.fallbackCard && await record.fallbackCard.update(text, phase)) return;
  record.fallbackCard = await productReply(
    record.replyToMessageId,
    text,
    idempotencyKey,
    phase,
  );
}

function taskLiveSession(
  record: TaskRecord,
): TaskCardSession | ConversationTurnSession | null {
  return record.card ?? record.conversation;
}

async function notifyTaskFallback(
  record: TaskRecord,
  text: string,
  phase: string,
  idempotencyKey: string,
): Promise<void> {
  if (record.conversation) {
    await durableReply(record.replyToMessageId, text, idempotencyKey);
    return;
  }
  await updateTaskFallbackCard(record, text, phase, idempotencyKey);
}

async function durableReply(
  messageId: string,
  text: string,
  idempotencyKey: string,
): Promise<void> {
  const safeText = redactSensitiveText(text);
  const outboxId = createHash("sha256")
    .update(`${messageId}\u0000${idempotencyKey}`)
    .digest("hex");
  const now = new Date().toISOString();
  await state.enqueueOutbox({
    id: outboxId,
    kind: "reply_text",
    payload: { messageId, text: safeText, idempotencyKey },
    attempts: 0,
    createdAt: now,
    nextAttemptAt: now,
  });
  try {
    await deliverTextFallback(messageId, safeText, idempotencyKey);
    await state.markOutboxSent(outboxId);
  } catch (error) {
    await state.markOutboxFailed(outboxId, safeErrorText(error));
    throw error;
  }
}

// This is the only direct text-delivery gateway. Product replies must try the
// shared Card 2.0 renderer first and reach this function only as a reliability fallback.
async function deliverTextFallback(
  messageId: string,
  text: string,
  idempotencyKey: string,
): Promise<void> {
  await lark.reply(messageId, redactSensitiveText(text), idempotencyKey);
}

async function replyOnboardingCard(
  event: FeishuMessageEvent | FeishuCardActionEvent,
  onboarding: OnboardingState,
  feedback = "",
  phase = "onboarding",
  context?: { conversationKey: string; ownerId: string },
): Promise<void> {
  const ownerId = context?.ownerId ?? actorForEvent(event);
  const conversationKey = context?.conversationKey ?? conversationForEvent(event);
  const snapshot = await buildOnboardingSnapshot(onboarding, conversationKey, ownerId, feedback);
  try {
    const cardId = await lark.createCard(renderOnboardingCard(snapshot));
    const messageId = await deliverEntryCard(event, cardId, replyKey(event.event_id, phase));
    if (messageId) {
      onboardingCards.set(messageId, {
        cardId,
        conversationKey,
        ownerId,
        sequence: 0,
        createdAt: Date.now(),
      });
      pruneControlCards(onboardingCards);
    }
  } catch (error) {
    console.error("[bridge] onboarding card unavailable; falling back to text", error);
    await productReply(
      event.message_id,
      formatOnboardingSnapshot(snapshot),
      replyKey(event.event_id, `${phase}-fallback`),
      `${phase}-fallback`,
    );
  }
}

async function deliverEntryCard(
  event: FeishuMessageEvent | FeishuCardActionEvent,
  cardId: string,
  idempotencyKey: string,
): Promise<string | null> {
  const direct = event.type === "im.message.receive_v1"
    ? event.chat_type === "p2p"
    : state.getChatType(event.chat_id) === "p2p";
  return direct
    ? lark.sendCard(event.chat_id, cardId, idempotencyKey)
    : lark.replyCard(event.message_id, cardId, idempotencyKey);
}

async function buildOnboardingSnapshot(
  onboarding: OnboardingState,
  conversationKey: string,
  ownerId: string,
  feedback = "",
): Promise<OnboardingSnapshot> {
  let projectName = "尚未授权项目";
  let projectAvailable = false;
  try {
    projectName = (await currentProject(conversationKey, ownerId)).name;
    projectAvailable = true;
  } catch (error) {
    console.warn(`[bridge] onboarding project unavailable: ${(error as Error).message}`);
  }
  const settings = executionSettings(conversationKey, ownerId);
  const consumers = lark.getConsumerHealth();
  const role = roleForSender(config, ownerId) ?? "viewer";
  return {
    role,
    state: onboarding,
    projectName,
    projectAvailable,
    modelLabel: settings.model ?? "Codex 默认",
    sandboxLabel: permissionLabel(settings.sandboxMode),
    canWrite: role !== "viewer" && settings.sandboxMode !== "read-only",
    deviceOnline: consumers.length === 2 && consumers.every((consumer) => consumer.ready),
    groupChatEnabled: config.allowedChatIds.size > 0,
    ...(feedback ? { feedback } : {}),
  };
}

function formatOnboardingSnapshot(snapshot: OnboardingSnapshot): string {
  if (snapshot.state.status === "dismissed") {
    return "新手引导已暂停。需要时发送“新手引导”或 /start 即可重新打开。";
  }
  if (!snapshot.deviceOnline) {
    return "本地 Codex 正在重新连接。发送“控制台”查看连接状态，恢复后重新发送刚才的话即可。";
  }
  if (!snapshot.projectAvailable) {
    return "开始前先发送“项目”，从已授权项目中选择一个工作区。";
  }
  if (snapshot.role === "viewer") {
    return [
      "欢迎使用 Codex",
      `当前项目：${snapshot.projectName} · 只读`,
      "你可以查看项目、历史会话和任务状态；需要执行工作时请联系管理员调整角色。",
    ].join("\n");
  }
  return [
    snapshot.state.status === "completed" ? "第一次任务已完成" : "完成第一次 Codex 任务",
    `当前项目：${snapshot.projectName} · ${snapshot.sandboxLabel}`,
    snapshot.state.status === "completed"
      ? "直接发送一句完整要求；继续同一件事就回复，另一件事先开新会话。"
      : "先发送“这个项目是做什么的？”，系统会强制只读，不修改文件、不运行测试。",
  ].join("\n");
}

async function openOnboarding(
  event: FeishuMessageEvent,
  phase = "onboarding",
): Promise<void> {
  const conversationKey = key(event);
  const onboarding = await state.setOnboarding(
    onboardingStateKey(conversationKey, event.sender_id),
    event.sender_id,
    "active",
    1,
  );
  await replyOnboardingCard(event, onboarding, "", phase);
  await audit(event.sender_id, "onboarding.open", "onboarding", conversationKey, "allowed");
}

async function ensureFirstRunOnboardingState(
  event: FeishuMessageEvent,
  conversationKey: string,
  ownerId: string,
): Promise<void> {
  if (event.chat_type !== "p2p") return;
  const stateKey = onboardingStateKey(conversationKey, ownerId);
  if (!config.autoOnboarding || state.getOnboarding(stateKey)) return;
  try {
    await state.setOnboarding(stateKey, ownerId, "active", 1);
    await audit(ownerId, "onboarding.auto_start", "onboarding", conversationKey, "allowed");
  } catch (error) {
    console.error("[bridge] unable to initialize first-run onboarding", error);
  }
}

async function completeOnboardingAfterFirstSuccess(record: TaskRecord): Promise<void> {
  const stateKey = onboardingStateKey(record.conversationKey, record.ownerId);
  const onboarding = state.getOnboarding(stateKey);
  if (onboarding?.status !== "active") return;
  const completed = await state.setOnboarding(stateKey, record.ownerId, "completed", 4);
  await audit(
    record.ownerId,
    "onboarding.first_success",
    "onboarding",
    record.conversationKey,
    "allowed",
    record.id,
  );
  await refreshFirstSuccessCards(record, completed);
}

async function refreshFirstSuccessCards(
  task: TaskRecord,
  onboarding: OnboardingState,
): Promise<void> {
  const onboardingSnapshot = await buildOnboardingSnapshot(
    onboarding,
    task.conversationKey,
    task.ownerId,
    "第一次任务已完成，可以直接继续使用。",
  );
  for (const [messageId, card] of onboardingCards) {
    if (card.conversationKey !== task.conversationKey || card.ownerId !== task.ownerId) continue;
    try {
      card.sequence += 1;
      await lark.updateCard(
        card.cardId,
        renderOnboardingCard(onboardingSnapshot),
        card.sequence,
      );
    } catch (error) {
      onboardingCards.delete(messageId);
      console.warn(`[bridge] unable to complete onboarding card message=${logRef(messageId)}`, error);
    }
  }

  const homeSnapshot = await buildPrivateHomeSnapshot(
    task.conversationKey,
    task.ownerId,
    "第一次任务已完成。以后直接说目标即可。",
  );
  for (const [messageId, card] of homeCards) {
    if (card.conversationKey !== task.conversationKey || card.ownerId !== task.ownerId) continue;
    try {
      card.sequence += 1;
      await lark.updateCard(card.cardId, renderPrivateHomeCard(homeSnapshot), card.sequence);
    } catch (error) {
      homeCards.delete(messageId);
      console.warn(`[bridge] unable to complete home card message=${logRef(messageId)}`, error);
    }
  }
}

async function replyPrivateHomeCard(
  event: FeishuMessageEvent | FeishuCardActionEvent,
  feedback = "",
  phase = "home",
  context?: { conversationKey: string; ownerId: string },
): Promise<void> {
  const ownerId = context?.ownerId ?? actorForEvent(event);
  const conversationKey = context?.conversationKey ?? conversationForEvent(event);
  const snapshot = await buildPrivateHomeSnapshot(conversationKey, ownerId, feedback);
  try {
    const cardId = await lark.createCard(renderPrivateHomeCard(snapshot));
    const messageId = await deliverEntryCard(event, cardId, replyKey(event.event_id, phase));
    if (messageId) {
      homeCards.set(messageId, {
        cardId,
        conversationKey,
        ownerId,
        sequence: 0,
        createdAt: Date.now(),
      });
      pruneControlCards(homeCards);
    }
  } catch (error) {
    console.error("[bridge] private home card unavailable; falling back to text", error);
    await productReply(
      event.message_id,
      formatPrivateHomeSnapshot(snapshot),
      replyKey(event.event_id, `${phase}-fallback`),
      `${phase}-fallback`,
    );
  }
}

async function buildPrivateHomeSnapshot(
  conversationKey: string,
  ownerId: string,
  feedback = "",
): Promise<PrivateHomeSnapshot> {
  const project = await currentProject(conversationKey, ownerId);
  const appServer = runner.getHealth();
  const consumers = lark.getConsumerHealth();
  const sampledAt = new Date().toISOString();
  const lastSuccessfulTaskAt = state
    .listTasks()
    .filter((task) => task.ownerId === ownerId && task.status === "succeeded")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.updatedAt;
  const settings = executionSettings(conversationKey, ownerId);
  const role = roleForSender(config, ownerId) ?? "viewer";
  const activeTask = runner.getActiveTask(conversationKey);
  const onboarding = state.getOnboarding(onboardingStateKey(conversationKey, ownerId));
  const projectChat = state.getProjectChatByProject(project.path);
  return {
    deviceName: hostname() || "本地 Mac",
    availability: deriveDeviceAvailability({
      consumers,
      codex: appServer,
      api: lark.getApiHealth(),
      sampledAt,
      ...(lastSuccessfulTaskAt ? { lastSuccessfulTaskAt } : {}),
    }),
    project: {
      name: project.name,
      isGitRepository: project.isGitRepository,
    },
    role,
    modelLabel: settings.model ?? "Codex 默认",
    sandboxLabel: permissionLabel(settings.sandboxMode),
    hasSession: Boolean(state.getThread(conversationKey)),
    ...(activeTask ? { activeTask } : {}),
    queuedTasks: queue.queuedForConversation(conversationKey),
    canOperate: canOperate(config, ownerId),
    ...(onboarding ? { onboardingStatus: onboarding.status } : {}),
    ...(projectChat
      ? {
          projectChatName: projectChat.name,
          projectChatNeedsRepair: !isProjectChatReady(projectChat),
        }
      : {}),
    ...(feedback ? { feedback } : {}),
  };
}

function formatPrivateHomeSnapshot(snapshot: PrivateHomeSnapshot): string {
  return [
    `Codex 首页 · ${snapshot.project.name}`,
    `- 设备：${snapshot.availability.title}`,
    `- 会话：${snapshot.hasSession ? "继续当前" : "尚未开始"}`,
    `- 权限：${snapshot.sandboxLabel}`,
    `- 模型：${snapshot.modelLabel}`,
    snapshot.activeTask
      ? `- 当前任务：${snapshot.activeTask}`
      : snapshot.queuedTasks > 0
        ? `- 排队任务：${snapshot.queuedTasks}`
        : "- 当前没有运行任务",
    snapshot.onboardingStatus === "active" && snapshot.canOperate
      ? "第一次使用可发送“这个项目是做什么的？”，系统会以只读方式回答。"
      : "直接发送一句完整要求即可；另一件事先发送“新会话”。",
    ...(snapshot.feedback ? [`- 操作结果：${snapshot.feedback}`] : []),
  ].join("\n");
}

async function replyProjectCard(
  event: FeishuMessageEvent | FeishuCardActionEvent,
  current: CodexProject,
  feedback = "",
  phase = "projects",
  context?: { conversationKey: string; ownerId: string },
): Promise<void> {
  const ownerId = context?.ownerId ?? actorForEvent(event);
  const conversationKey = context?.conversationKey ?? conversationForEvent(event);
  const workspace = await buildProjectWorkspace(conversationKey, ownerId, current);
  try {
    const cardId = await lark.createCard(
      renderProjectCard(workspace.projects, current, feedback, workspace.context),
    );
    const messageId = await lark.replyCard(
      event.message_id,
      cardId,
      replyKey(event.event_id, phase),
    );
    if (messageId) {
      const record = {
        cardId,
        conversationKey,
        ownerId,
        sequence: 0,
        createdAt: Date.now(),
      };
      projectCards.set(messageId, record);
      await state.upsertProjectCard({ messageId, ...record });
      pruneProjectCards();
    }
  } catch (error) {
    console.error("[bridge] project card unavailable; falling back to text", error);
    if (phase === "project-group-bind") {
      await productReply(
        event.message_id,
        projectGroupBindingCardFailureText(),
        replyKey(event.event_id, `${phase}-fallback`),
        `${phase}-fallback`,
      );
      return;
    }
    const prefix = feedback ? `${feedback}\n\n` : "";
    await productReply(
      event.message_id,
      `${prefix}${formatProjectList(current, workspace.projects)}`,
      replyKey(event.event_id, `${phase}-fallback`),
      `${phase}-fallback`,
    );
  }
}

async function replyProjectOverview(
  event: FeishuMessageEvent | FeishuCardActionEvent,
  phase = "project-overview",
  context?: { conversationKey: string; ownerId: string },
): Promise<void> {
  const ownerId = context?.ownerId ?? actorForEvent(event);
  const conversationKey = context?.conversationKey ?? conversationForEvent(event);
  const project = await currentProject(conversationKey, ownerId);
  const snapshot = await readProjectOverview(project);
  try {
    const cardId = await lark.createCard(renderProjectOverviewCard(snapshot));
    await lark.replyCard(event.message_id, cardId, replyKey(event.event_id, phase));
  } catch (error) {
    console.error("[bridge] project overview card unavailable; falling back to text", error);
    await productReply(
      event.message_id,
      renderProjectOverviewText(snapshot),
      replyKey(event.event_id, `${phase}-fallback`),
      `${phase}-fallback`,
    );
  }
  await state.recordProjectUse(ownerId, project.path);
  await audit(ownerId, "project.overview", "project", project.path, "allowed", "local snapshot");
}

async function buildProjectWorkspace(
  conversationKey: string,
  ownerId: string,
  current: CodexProject,
) {
  const visible = visibleProjects(config, ownerId, projectRegistry.list());
  const ranked = rankProjectWorkspace(visible, state.listProjectUsage(ownerId));
  const gitStatus = current.isGitRepository
    ? await readProjectGitStatus(current.path)
    : null;
  let policyLabel: string;
  try {
    policyLabel = projectPolicySummary(await loadProjectPolicy(current.path));
  } catch (error) {
    policyLabel = `策略错误 · ${(error as Error).message}`;
  }
  const currentChatId = chatIdFromConversationKey(conversationKey);
  const boundCurrentChat = state.getProjectChat(currentChatId);
  const projectChat = state.getProjectChatByProject(current.path);
  const requiresProjectBinding =
    state.getChatType(currentChatId) === "group" && !boundCurrentChat;
  return {
    projects: ranked.projects,
    context: {
      gitStatus,
      favoritePaths: ranked.favoritePaths,
      recentPaths: ranked.recentPaths,
      policyLabel,
      canSwitch:
        requiresProjectBinding
          ? canAdminister(config, ownerId)
          : canOperate(config, ownerId) && !boundCurrentChat,
      activeTasks: runner.getActiveTask(conversationKey) ? 1 : 0,
      queuedTasks: queue.queuedForConversation(conversationKey),
      hasSavedThread: Boolean(state.getThread(conversationKey)),
      ...(projectChat
        ? {
            projectChat: {
              name: projectChat.name,
              isCurrentChat: projectChat.chatId === currentChatId,
              needsRepair: !isProjectChatReady(projectChat),
            },
          }
        : {}),
      canCreateProjectChat:
        canOperate(config, ownerId) &&
        state.getChatType(currentChatId) === "p2p" &&
        !projectChat,
      requiresProjectBinding,
    },
  };
}

async function replyDeviceCard(
  event: FeishuMessageEvent | FeishuCardActionEvent,
  feedback = "",
  phase = "device",
  context?: { conversationKey: string; ownerId: string },
): Promise<void> {
  const ownerId = context?.ownerId ?? actorForEvent(event);
  const conversationKey = context?.conversationKey ?? conversationForEvent(event);
  const snapshot = await buildDeviceSnapshot(conversationKey, ownerId, feedback);
  try {
    const cardId = await lark.createCard(renderDeviceCard(snapshot));
    const messageId = await lark.replyCard(
      event.message_id,
      cardId,
      replyKey(event.event_id, phase),
    );
    if (messageId) {
      const record = {
        cardId,
        conversationKey,
        ownerId,
        sequence: 0,
        createdAt: Date.now(),
      };
      deviceCards.set(messageId, record);
      await state.upsertDeviceCard({ messageId, ...record });
      pruneDeviceCards();
    }
  } catch (error) {
    console.error("[bridge] device card unavailable; falling back to text", error);
    await productReply(
      event.message_id,
      formatDeviceSnapshot(snapshot),
      replyKey(event.event_id, `${phase}-fallback`),
      `${phase}-fallback`,
    );
  }
}

async function replyQuotaCard(
  event: FeishuMessageEvent | FeishuCardActionEvent,
  feedback = "",
  phase = "quota",
  context?: { conversationKey: string; ownerId: string },
): Promise<void> {
  const ownerId = context?.ownerId ?? actorForEvent(event);
  const conversationKey = context?.conversationKey ?? conversationForEvent(event);
  const quota = await readAccountQuota();
  const snapshot = {
    deviceName: hostname() || "本地设备",
    quota,
    ...(feedback ? { feedback } : {}),
  };
  try {
    const cardId = await lark.createCard(renderQuotaCard(snapshot));
    const messageId = await lark.replyCard(
      event.message_id,
      cardId,
      replyKey(event.event_id, phase),
    );
    if (messageId) {
      const record = {
        cardId,
        conversationKey,
        ownerId,
        sequence: 0,
        createdAt: Date.now(),
      };
      deviceCards.set(messageId, record);
      await state.upsertDeviceCard({ messageId, ...record });
      pruneDeviceCards();
    }
  } catch (error) {
    console.error("[bridge] quota card unavailable; falling back to text", error);
    await productReply(
      event.message_id,
      ["Codex 账户额度", ...formatAccountQuotaText(quota)].join("\n"),
      replyKey(event.event_id, `${phase}-fallback`),
      `${phase}-fallback`,
    );
  }
}

async function replyControlCenter(
  event: FeishuMessageEvent | FeishuCardActionEvent,
  feedback = "",
  phase = "settings",
  context?: { conversationKey: string; ownerId: string },
): Promise<void> {
  const ownerId = context?.ownerId ?? actorForEvent(event);
  const conversationKey = context?.conversationKey ?? conversationForEvent(event);
  const snapshot = await buildControlSnapshot(conversationKey, ownerId, feedback);
  try {
    const cardId = await lark.createCard(renderControlCenterCard(snapshot));
    const messageId = await lark.replyCard(
      event.message_id,
      cardId,
      replyKey(event.event_id, phase),
    );
    if (messageId) {
      controlCards.set(messageId, {
        cardId,
        conversationKey,
        ownerId,
        sequence: 0,
        createdAt: Date.now(),
      });
      pruneControlCards(controlCards);
    }
  } catch (error) {
    console.error("[bridge] control center card unavailable", error);
    await productReply(
      event.message_id,
      `${feedback ? `${feedback}\n\n` : ""}${formatControlSnapshot(snapshot)}`,
      replyKey(event.event_id, `${phase}-fallback`),
      `${phase}-fallback`,
    );
  }
}

async function buildControlSnapshot(
  conversationKey: string,
  ownerId: string,
  feedback = "",
): Promise<ControlCenterSnapshot> {
  const [models, accountQuota] = await Promise.all([
    runner.listModels().catch((error) => {
      console.warn(`[bridge] unable to list Codex models: ${safeErrorText(error)}`);
      return [] as CodexModel[];
    }),
    readAccountQuota(),
  ]);
  const project = await currentProject(conversationKey, ownerId);
  let projectPolicy = defaultProjectPolicy();
  let policyNotice = "";
  try {
    projectPolicy = await loadProjectPolicy(project.path);
  } catch (error) {
    projectPolicy = { ...defaultProjectPolicy(), maximumSandbox: "read-only" };
    policyNotice = `仓库策略无效，任务已安全降为只读：${(error as Error).message}`;
  }
  const requestedSettings = executionSettings(conversationKey, ownerId);
  requestedSettings.sandboxMode = applyProjectSandboxMaximum(
    requestedSettings.sandboxMode,
    projectPolicy,
  );
  const compatibility = compatibleModelSettings(requestedSettings, models);
  const settings = compatibility.settings;
  const maximumSandbox = applyProjectSandboxMaximum(
    maxSandboxForActor(ownerId),
    projectPolicy,
  );
  const fullAccessLease =
    maximumSandbox === "danger-full-access"
      ? state.getPermissionLease(conversationKey, ownerId)
      : undefined;
  const selectedModel = settings.model ?? "__default__";
  const selected = compatibility.effectiveModel;
  const selectedEffort =
    settings.reasoningEffort ?? selected?.defaultReasoningEffort ?? config.reasoningEffort ?? "medium";
  return {
    projectName: project.name,
    role: roleForSender(config, ownerId) ?? "viewer",
    models,
    selectedModel,
    selectedEffort,
    selectedSandbox: settings.sandboxMode,
    sandboxModes: selectableSandboxModes(
      persistentSandboxMode(undefined, maximumSandbox),
    ),
    modelCatalogAvailable: models.length > 0,
    accountQuota,
    fullAccessMaximum: maximumSandbox === "danger-full-access",
    ...(fullAccessLease
      ? { fullAccessLeaseLabel: permissionLeaseLabel(fullAccessLease) }
      : {}),
    fullAccessSessionAvailable: Boolean(state.getThread(conversationKey)),
    ...([feedback, policyNotice, ...compatibility.notices].filter(Boolean).length > 0
      ? {
          feedback: [feedback, policyNotice, ...compatibility.notices]
            .filter(Boolean)
            .join("；"),
        }
      : {}),
  };
}

function formatControlSnapshot(snapshot: ControlCenterSnapshot): string {
  return [
    "Codex 控制中心",
    `- 项目：${snapshot.projectName}`,
    `- 身份：${roleLabel(snapshot.role)}`,
    `- 模型：${snapshot.selectedModel === "__default__" ? "Codex 默认" : snapshot.selectedModel}`,
    `- 推理：${reasoningEffortLabel(snapshot.selectedEffort)}`,
    `- 权限：${permissionLabel(snapshot.selectedSandbox)}`,
    ...(snapshot.accountQuota ? formatAccountQuotaText(snapshot.accountQuota) : []),
    ...(snapshot.fullAccessLeaseLabel
      ? [`- 临时完全访问：${snapshot.fullAccessLeaseLabel}`]
      : []),
    "发送“模型 <名称>”“推理 high”或“权限 只读”也可以直接切换。",
  ].join("\n");
}

async function replySessionCenter(
  event: FeishuMessageEvent | FeishuCardActionEvent,
  feedback = "",
  phase = "sessions",
  context?: { conversationKey: string; ownerId: string },
): Promise<void> {
  const ownerId = context?.ownerId ?? actorForEvent(event);
  const conversationKey = context?.conversationKey ?? conversationForEvent(event);
  const project = await currentProject(conversationKey, ownerId);
  const currentThreadId = state.getThread(conversationKey);
  const sessions = visibleSessions(
    ownerId,
    project.path,
    currentThreadId,
    await runner.listThreads(project.path, 50),
  ).slice(0, 50);
  const snapshot = {
    projectName: project.name,
    sessions,
    ...(currentThreadId ? { currentThreadId } : {}),
    ...(feedback ? { feedback } : {}),
  };
  try {
    const cardId = await lark.createCard(renderSessionCenterCard(snapshot));
    const messageId = await lark.replyCard(
      event.message_id,
      cardId,
      replyKey(event.event_id, phase),
    );
    if (messageId) {
      sessionCards.set(messageId, {
        cardId,
        conversationKey,
        ownerId,
        sequence: 0,
        createdAt: Date.now(),
      });
      pruneControlCards(sessionCards);
    }
  } catch (error) {
    console.error("[bridge] session center card unavailable", error);
    const lines = sessions.slice(0, 10).map((session, index) =>
      `${index + 1}. ${session.name || session.preview || session.id.slice(0, 8)} · ${session.activitySource === "feishu" ? "飞书更新" : session.activitySource === "desktop" ? "本机更新" : "来源未知"}\n   ${session.id}`,
    );
    await productReply(
      event.message_id,
      [feedback, `最近会话（${sessions.length}）`, ...lines].filter(Boolean).join("\n"),
      replyKey(event.event_id, `${phase}-fallback`),
      `${phase}-fallback`,
    );
  }
}

async function replyTaskCenter(
  event: FeishuMessageEvent | FeishuCardActionEvent,
  phase = "tasks",
  context?: { conversationKey: string; ownerId: string },
): Promise<void> {
  const ownerId = context?.ownerId ?? actorForEvent(event);
  const conversationKey = context?.conversationKey ?? conversationForEvent(event);
  const project = await currentProject(conversationKey, ownerId);
  const snapshot = buildTaskCenterSnapshot(ownerId, project);
  try {
    const cardId = await lark.createCard(renderTaskCenterCard(snapshot));
    const messageId = await lark.replyCard(event.message_id, cardId, replyKey(event.event_id, phase));
    if (messageId) {
      taskCenterCards.set(messageId, {
        cardId,
        conversationKey,
        ownerId,
        sequence: 0,
        createdAt: Date.now(),
      });
      pruneControlCards(taskCenterCards);
    }
  } catch (error) {
    console.error("[bridge] task center card unavailable", error);
    await productReply(
      event.message_id,
      [
        `任务中心 · 运行 ${snapshot.running} · 排队 ${snapshot.queued}`,
        ...snapshot.tasks
          .slice(0, 10)
          .map((task) => `- [${task.status}] ${task.project.name} · ${task.prompt.slice(0, 80)}`),
      ].join("\n"),
      replyKey(event.event_id, `${phase}-fallback`),
      `${phase}-fallback`,
    );
  }
}

async function replyTeamDashboard(
  event: FeishuMessageEvent | FeishuCardActionEvent,
  feedback = "",
  phase = "team",
  context?: { conversationKey: string; ownerId: string },
): Promise<void> {
  const ownerId = context?.ownerId ?? actorForEvent(event);
  const conversationKey = context?.conversationKey ?? conversationForEvent(event);
  const snapshot = buildTeamDashboardSnapshot(ownerId, feedback);
  try {
    const cardId = await lark.createCard(renderTeamDashboardCard(snapshot));
    const messageId = await lark.replyCard(
      event.message_id,
      cardId,
      replyKey(event.event_id, phase),
    );
    if (messageId) {
      teamCards.set(messageId, {
        cardId,
        conversationKey,
        ownerId,
        sequence: 0,
        createdAt: Date.now(),
      });
      pruneControlCards(teamCards);
    }
  } catch (error) {
    console.error("[bridge] team dashboard card unavailable", error);
    await productReply(
      event.message_id,
      [
        `团队工作台 · 活跃 ${snapshot.activeTasks} · 排队 ${snapshot.queuedTasks}`,
        `- 可见成员：${snapshot.members.length}`,
        `- 最近完成：${snapshot.completedTasks}`,
        `- 输入 / 输出：${snapshot.inputTokens} / ${snapshot.outputTokens} tokens`,
      ].join("\n"),
      replyKey(event.event_id, `${phase}-fallback`),
      "team-dashboard-fallback",
    );
  }
}

async function replyRunbookCenter(
  event: FeishuMessageEvent | FeishuCardActionEvent,
  feedback = "",
  phase = "runbooks",
  context?: { conversationKey: string; ownerId: string },
): Promise<void> {
  const ownerId = context?.ownerId ?? actorForEvent(event);
  const conversationKey = context?.conversationKey ?? conversationForEvent(event);
  const project = await currentProject(conversationKey, ownerId);
  const catalog = await loadProjectRunbooks(project.path);
  const snapshot: RunbookCenterSnapshot = {
    projectName: project.name,
    catalog,
    canOperate: canOperate(config, ownerId),
    ...(feedback ? { feedback } : {}),
  };
  try {
    const cardId = await lark.createCard(renderRunbookCenterCard(snapshot));
    const messageId = await lark.replyCard(
      event.message_id,
      cardId,
      replyKey(event.event_id, phase),
    );
    if (messageId) {
      runbookCards.set(messageId, {
        cardId,
        conversationKey,
        ownerId,
        sequence: 0,
        createdAt: Date.now(),
      });
      pruneControlCards(runbookCards);
    }
  } catch (error) {
    console.error("[bridge] runbook center card unavailable", error);
    await productReply(
      event.message_id,
      catalog.status === "ready"
        ? [
            `团队运行手册 · ${project.name}`,
            ...catalog.runbooks.map(
              (runbook) => `- ${runbook.name}：/run ${runbook.id}`,
            ),
          ].join("\n")
        : catalog.status === "missing"
          ? `当前项目还没有 ${catalog.file.split("/").at(-1)}。`
          : `运行手册配置无效：${catalog.error ?? "未知错误"}`,
      replyKey(event.event_id, `${phase}-fallback`),
      "runbook-center-fallback",
    );
  }
}

async function launchRunbook(
  replyToMessageId: string,
  conversationKey: string,
  ownerId: string,
  seed: string,
  runbook: RunbookDefinition,
  values: Record<string, string> = {},
): Promise<string> {
  const prompt = renderRunbookPrompt(runbook, values);
  if (externalActionsForPrompt(prompt).length > 0) {
    throw new Error(
      "运行手册参数产生了提交、推送、部署或 PR 动作；请把它作为普通任务发送并单独确认。",
    );
  }
  const settings: Partial<TaskExecutionSettings> = {
    ...(runbook.model ? { model: runbook.model } : {}),
    ...(runbook.reasoningEffort ? { reasoningEffort: runbook.reasoningEffort } : {}),
    ...(runbook.sandboxMode ? { sandboxMode: runbook.sandboxMode } : {}),
  };
  const taskId = await enqueuePrompt(
    replyToMessageId,
    conversationKey,
    ownerId,
    prompt,
    seed,
    [],
    [],
    {
      runbook: { id: runbook.id, name: runbook.name },
      settings,
    },
  );
  await audit(
    ownerId,
    "runbook.execute",
    "task",
    taskId,
    "allowed",
    runbook.id,
  );
  return taskId;
}

async function replyReviewCard(
  event: FeishuMessageEvent | FeishuCardActionEvent,
  task: TaskRecord,
  feedback = "",
  phase = "task-review",
  page = 0,
  selectedFileIndex?: number,
  diffPage = 0,
): Promise<void> {
  if (!task.progress.review) await refreshTaskReview(task);
  const embedded = Boolean(
    task.card &&
      task.card.messageId === event.message_id &&
      task.progress.phase !== "queued" &&
      task.progress.phase !== "running",
  );
  const snapshot = await buildReviewCardSnapshot(
    task,
    page,
    selectedFileIndex,
    feedback,
    diffPage,
    embedded,
  );
  try {
    if (embedded && task.card) {
      const updated = await task.card.showSurface(
        renderReviewCard(snapshot),
        "review-surface",
      );
      if (!updated) throw new Error("unable to update the task card review surface");
      reviewCards.set(event.message_id, {
        cardId: task.card.cardId,
        conversationKey: task.conversationKey,
        ownerId: task.ownerId,
        taskId: task.id,
        page: snapshot.page,
        ...(snapshot.selectedFileIndex === undefined
          ? {}
          : { selectedFileIndex: snapshot.selectedFileIndex }),
        ...(snapshot.diffPage === undefined ? {} : { diffPage: snapshot.diffPage }),
        sequence: task.card.sequenceNumber,
        createdAt: Date.now(),
        embedded: true,
      });
      pruneControlCards(reviewCards);
      return;
    }
    const cardId = await lark.createCard(renderReviewCard(snapshot));
    const messageId = await lark.replyCard(
      event.message_id,
      cardId,
      replyKey(event.event_id, `${phase}-${task.id}`),
    );
    if (messageId) {
      reviewCards.set(messageId, {
        cardId,
        conversationKey: task.conversationKey,
        ownerId: task.ownerId,
        taskId: task.id,
        page: snapshot.page,
        ...(snapshot.selectedFileIndex === undefined
          ? {}
          : { selectedFileIndex: snapshot.selectedFileIndex }),
        ...(snapshot.diffPage === undefined ? {} : { diffPage: snapshot.diffPage }),
        sequence: 0,
        createdAt: Date.now(),
      });
      pruneControlCards(reviewCards);
    }
  } catch (error) {
    console.error(`[bridge] review card unavailable task=${task.id}`, error);
    const review = snapshot.review;
    await productReply(
      event.message_id,
      [
        `代码审阅 · ${task.project.name}`,
        `- 文件：${review.totalFiles}`,
        `- 行数：+${review.totalAdditions} / -${review.totalDeletions}`,
        `- 归因：${review.attribution === "task" ? "任务基线清晰" : "需要回本机确认"}`,
        `- 测试：${reviewTestLabel(snapshot.commandRuns)}`,
        ...review.files.slice(0, 20).map((file) => `- ${file.kind} ${file.path}`),
      ].join("\n"),
      replyKey(event.event_id, `${phase}-${task.id}-fallback`),
      `${phase}-fallback`,
    );
  }
}

async function buildReviewCardSnapshot(
  task: TaskRecord,
  requestedPage = 0,
  selectedFileIndex?: number,
  feedback = "",
  requestedDiffPage = 0,
  embedded = false,
): Promise<ReviewCardSnapshot> {
  const review = task.progress.review ?? await captureTaskReview(
    task.project.path,
    task.progress.reviewBaseline,
    task.progress.changedFiles,
  );
  const pageSize = 5;
  const lastPage = Math.max(0, Math.ceil(review.files.length / pageSize) - 1);
  const page = Math.min(Math.max(0, requestedPage), lastPage);
  const selected = selectedFileIndex === undefined ? undefined : review.files[selectedFileIndex];
  const fileDiff = selected
    ? await readTaskFileDiff(task.project.path, task.progress.reviewBaseline, selected)
    : undefined;
  const diffPageSize = 7_000;
  const lastDiffPage = fileDiff
    ? Math.max(0, Math.ceil(fileDiff.content.length / diffPageSize) - 1)
    : 0;
  const diffPage = Math.min(Math.max(0, requestedDiffPage), lastDiffPage);
  return {
    taskId: task.id,
    projectLabel: task.project.name,
    prompt: task.prompt,
    phase: task.progress.phase,
    review,
    commandRuns: task.progress.commandRuns ?? [],
    page,
    pageSize,
    ...(selected && selectedFileIndex !== undefined ? { selectedFileIndex } : {}),
    ...(fileDiff ? { fileDiff } : {}),
    ...(fileDiff ? { diffPage, diffPageSize } : {}),
    ...(feedback ? { feedback } : {}),
    ...(embedded ? { embedded: true } : {}),
  };
}

function reviewTestLabel(commandRuns: NonNullable<TaskProgress["commandRuns"]>): string {
  const tests = commandRuns.filter((run) => run.category === "test");
  const state = testEvidenceState(tests);
  if (state === "missing") return "未检测到测试命令";
  if (state === "failed") return "存在未通过测试";
  if (state === "running") return "测试仍在运行";
  return "测试已通过";
}

function buildTaskCenterSnapshot(
  ownerId: string,
  currentProject: CodexProject,
): TaskCenterSnapshot {
  const isAdmin = canAdminister(config, ownerId);
  const persisted = new Map(state.listTasks().map((task) => [task.id, task]));
  for (const record of tasks.values()) {
    const saved = persisted.get(record.id);
    if (!saved) continue;
    persisted.set(record.id, {
      ...saved,
      controllerId: record.controllerId,
      status: record.status,
      progress: structuredClone(record.progress),
    });
  }
  const scoped = [...persisted.values()].filter((task) =>
    isAdmin
      ? task.project.path === currentProject.path
      : (task.ownerId === ownerId || task.controllerId === ownerId) &&
        canAccessProject(config, ownerId, task.project),
  );
  const sorted = scoped.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return {
    scopeLabel: isAdmin
      ? `${currentProject.name} · 团队任务`
      : "我发起或控制的授权项目任务",
    tasks: sorted.slice(0, 20),
    running: scoped.filter((task) => task.status === "running").length,
    queued: scoped.filter((task) => task.status === "queued").length,
    canOperate: canOperate(config, ownerId),
    people: Object.fromEntries(
      scoped.map((task) => [
        task.id,
        {
          initiator: memberLabel(config, task.ownerId),
          controller: memberLabel(config, task.controllerId),
        },
      ]),
    ),
  };
}

function buildTeamDashboardSnapshot(
  actorId: string,
  feedback = "",
): TeamDashboardSnapshot {
  const admin = canAdminister(config, actorId);
  const cutoff = Date.now() - 7 * 24 * 60 * 60_000;
  const persisted = new Map(state.listTasks().map((task) => [task.id, task]));
  for (const record of tasks.values()) {
    const saved = persisted.get(record.id);
    if (!saved) continue;
    persisted.set(record.id, {
      ...saved,
      controllerId: record.controllerId,
      status: record.status,
      progress: structuredClone(record.progress),
    });
  }
  const recent = [...persisted.values()].filter((task) => {
    const updatedAt = Date.parse(task.updatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt < cutoff) return false;
    if (admin) return true;
    return (
      (task.ownerId === actorId || task.controllerId === actorId) &&
      canAccessProject(config, actorId, task.project)
    );
  });
  const visibleMembers = teamMembers(config).filter((member) => admin || member.id === actorId);
  const members: TeamMemberMetric[] = visibleMembers.map((member) => {
    const initiated = recent.filter((task) => task.ownerId === member.id);
    const controlled = recent.filter((task) => task.controllerId === member.id);
    const active = recent.filter(
      (task) =>
        (task.ownerId === member.id || task.controllerId === member.id) &&
        (task.status === "running" || task.status === "queued"),
    );
    return {
      label: member.label,
      role: member.role,
      tasks: initiated.length,
      active: active.length,
      controlled: controlled.length,
      succeeded: initiated.filter((task) => task.status === "succeeded").length,
      failed: initiated.filter((task) => task.status === "failed").length,
      inputTokens: initiated.reduce(
        (total, task) => total + (task.progress.usage?.input_tokens ?? 0),
        0,
      ),
      outputTokens: initiated.reduce(
        (total, task) => total + (task.progress.usage?.output_tokens ?? 0),
        0,
      ),
    };
  });
  const projectGroups = new Map<
    string,
    { label: string; tasks: number; active: number; members: Set<string> }
  >();
  for (const task of recent) {
    const current = projectGroups.get(task.project.path) ?? {
      label: task.project.name,
      tasks: 0,
      active: 0,
      members: new Set<string>(),
    };
    current.tasks += 1;
    if (task.status === "running" || task.status === "queued") current.active += 1;
    current.members.add(task.ownerId);
    projectGroups.set(task.project.path, current);
  }
  const projects = [...projectGroups.values()]
    .map((project) => ({
      label: project.label,
      tasks: project.tasks,
      active: project.active,
      members: project.members.size,
    }))
    .sort((left, right) => right.active - left.active || right.tasks - left.tasks);
  const succeeded = recent.filter((task) => task.status === "succeeded").length;
  const failed = recent.filter((task) => task.status === "failed").length;
  const completedTasks = succeeded + failed;
  return {
    scopeLabel: admin
      ? `${config.instanceId} · 授权团队汇总`
      : `${config.instanceId} · 我的协作概览`,
    periodLabel: "最近 7 天",
    members,
    projects,
    activeTasks: recent.filter((task) => task.status === "running").length,
    queuedTasks: recent.filter((task) => task.status === "queued").length,
    completedTasks,
    ...(completedTasks > 0 ? { successRate: succeeded / completedTasks } : {}),
    inputTokens: recent.reduce(
      (total, task) => total + (task.progress.usage?.input_tokens ?? 0),
      0,
    ),
    outputTokens: recent.reduce(
      (total, task) => total + (task.progress.usage?.output_tokens ?? 0),
      0,
    ),
    canAdminister: admin,
    ...(feedback ? { feedback } : {}),
  };
}

async function buildDeviceSnapshot(
  conversationKey: string,
  ownerId: string,
  feedback = "",
): Promise<DeviceConsoleSnapshot> {
  const [project, power, accountQuota] = await Promise.all([
    currentProject(conversationKey, ownerId),
    readPowerStatus(),
    readAccountQuota(),
  ]);
  const appServer = runner.getHealth();
  const consumers = lark.getConsumerHealth();
  const listenerReady = consumers.length === 2 && consumers.every((consumer) => consumer.ready);
  const listenerRestarts = consumers.reduce(
    (total, consumer) => total + consumer.restartCount,
    0,
  );
  const remote = remoteReady.getStatus();
  const activeTask = runner.getActiveTask(conversationKey);
  const sampledAt = new Date().toISOString();
  const lastSuccessfulTaskAt = state
    .listTasks()
    .filter((task) => task.ownerId === ownerId && task.status === "succeeded")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.updatedAt;
  const codexState: DeviceConsoleSnapshot["codex"]["state"] = appServer.ready
    ? "online"
    : appServer.lastError
      ? "error"
      : "standby";

  return {
    deviceName: hostname() || "本地 Mac",
    osLabel: operatingSystemLabel(),
    uptimeLabel: formatDuration(Date.now() - runtimeHealth.startedAt),
    availability: deriveDeviceAvailability({
      consumers,
      codex: appServer,
      api: lark.getApiHealth(),
      sampledAt,
      ...(lastSuccessfulTaskAt ? { lastSuccessfulTaskAt } : {}),
    }),
    project: {
      name: project.name,
      displayPath: project.displayPath,
      isGitRepository: project.isGitRepository,
    },
    codex: {
      state: codexState,
      restartCount: appServer.restartCount,
      ...(appServer.pid !== undefined ? { pid: appServer.pid } : {}),
      ...(appServer.lastError ? { lastError: appServer.lastError } : {}),
    },
    listener: {
      ready: listenerReady,
      restartCount: listenerRestarts,
    },
    remoteReady: remote,
    powerLabel: power.label,
    ...(activeTask ? { activeTask } : {}),
    queuedForConversation: queue.queuedForConversation(conversationKey),
    activeTasks: queue.activeCount,
    queuedTasks: queue.pendingCount,
    maxConcurrentTasks: config.maxConcurrentTasks,
    threadCount: state.threadCount,
    sandboxLabel: permissionLabel(executionSettings(conversationKey, ownerId).sandboxMode),
    networkEnabled: config.networkAccessEnabled,
    accountQuota,
    ...(feedback ? { feedback } : {}),
  };
}

function actorForEvent(event: FeishuMessageEvent | FeishuCardActionEvent): string {
  return event.type === "im.message.receive_v1" ? event.sender_id : event.operator_id;
}

function conversationForEvent(event: FeishuMessageEvent | FeishuCardActionEvent): string {
  return event.type === "im.message.receive_v1" ? key(event) : cardKey(event);
}

function formatDeviceSnapshot(snapshot: DeviceConsoleSnapshot): string {
  const codex =
    snapshot.codex.state === "online"
      ? "在线"
      : snapshot.codex.state === "error"
        ? "异常"
        : "待命";
  return [
    `本地 Codex 控制台 · ${snapshot.deviceName}`,
    `- 设备状态：${snapshot.availability.title}`,
    `- 状态说明：${snapshot.availability.detail}`,
    `- 下一步：${snapshot.availability.nextAction}`,
    `- 状态采样：${new Date(snapshot.availability.sampledAt).toLocaleString("zh-CN", { hour12: false })}`,
    `- 本人最后成功任务：${snapshot.availability.lastSuccessfulTaskAt ? new Date(snapshot.availability.lastSuccessfulTaskAt).toLocaleString("zh-CN", { hour12: false }) : "暂无"}`,
    `- 飞书连接：${snapshot.listener.ready ? "在线" : "重连中"}`,
    `- Codex 引擎：${codex}`,
    `- 远程就绪：${snapshot.remoteReady.active ? "已开启" : "未开启"}`,
    `- 电源：${snapshot.powerLabel}`,
    `- 当前项目：${snapshot.project.name}`,
    `- 当前任务：${snapshot.activeTask ?? "无"}`,
    `- 当前聊天排队：${snapshot.queuedForConversation}`,
    `- 全局任务：运行 ${snapshot.activeTasks} / ${snapshot.maxConcurrentTasks} · 排队 ${snapshot.queuedTasks}`,
    `- 权限：${snapshot.sandboxLabel} · 网络${snapshot.networkEnabled ? "开启" : "关闭"}`,
    ...(snapshot.accountQuota ? formatAccountQuotaText(snapshot.accountQuota) : []),
    ...(snapshot.feedback ? [`- 操作结果：${snapshot.feedback}`] : []),
  ].join("\n");
}

async function readAccountQuota() {
  try {
    return await runner.readAccountQuota();
  } catch (error) {
    console.warn(`[bridge] unable to read Codex account quota: ${safeErrorText(error)}`);
    return unavailableAccountQuota();
  }
}

function operatingSystemLabel(): string {
  const system = platform() === "darwin" ? "macOS" : platform();
  return `${system} ${release()} · ${arch()}`;
}

function previousTaskModeForThread(
  conversationKey: string,
  ownerId: string,
  projectPath: string,
): TaskMode | undefined {
  const threadId = state.getThread(conversationKey);
  if (!threadId) return undefined;
  const previous = [...tasks.values()]
    .filter(
      (task) =>
        task.conversationKey === conversationKey &&
        task.ownerId === ownerId &&
        task.project.path === projectPath &&
        task.progress.threadId === threadId,
    )
    .sort((left, right) => right.progress.createdAt - left.progress.createdAt)[0];
  return previous ? taskModeOf(previous.progress) : undefined;
}

async function enqueuePrompt(
  replyToMessageId: string,
  conversationKey: string,
  ownerId: string,
  prompt: string,
  seed: string,
  attachments: TaskAttachment[] = [],
  allowedExternalActions: ExternalAction[] = [],
  launchOptions: TaskLaunchOptions = {},
): Promise<string> {
  const existing = [...tasks.values()].find(
    (task) => task.seed === seed && task.conversationKey === conversationKey,
  );
  if (existing) return existing.id;
  if (!queue.canEnqueue(conversationKey)) throw new QueueCapacityError(conversationKey);
  const project = await currentProject(conversationKey, ownerId);
  const projectPolicy = await loadProjectPolicy(project.path);
  const actionDecision = decideProjectActions(projectPolicy, allowedExternalActions);
  if (actionDecision.blockedActions.length > 0) {
    const blocked = actionDecision.blockedActions.map(externalActionLabel).join("、");
    await audit(
      ownerId,
      "project_policy.external_action",
      "project",
      project.path,
      "denied",
      actionDecision.blockedActions.join(","),
    );
    throw new ProjectPolicyError(`当前仓库策略禁止：${blocked}`);
  }
  await state.recordProjectUse(ownerId, project.path);
  const requestedSettings = executionSettings(conversationKey, ownerId);
  if (launchOptions.settings?.model) requestedSettings.model = launchOptions.settings.model;
  if (launchOptions.settings?.reasoningEffort) {
    requestedSettings.reasoningEffort = launchOptions.settings.reasoningEffort;
  }
  if (
    launchOptions.settings?.sandboxMode &&
    isSandboxModeAllowed(launchOptions.settings.sandboxMode, requestedSettings.sandboxMode)
  ) {
    requestedSettings.sandboxMode = launchOptions.settings.sandboxMode;
  }
  requestedSettings.sandboxMode = applyProjectSandboxMaximum(
    requestedSettings.sandboxMode,
    projectPolicy,
  );
  let availableModels: CodexModel[] = [];
  try {
    availableModels = await runner.listModels();
  } catch (error) {
    console.warn(`[bridge] unable to verify task model capabilities: ${(error as Error).message}`);
  }
  const compatibility = compatibleModelSettings(requestedSettings, availableModels);
  const settings = compatibility.settings;
  const taskMode = inferTaskMode(
    prompt,
    previousTaskModeForThread(conversationKey, ownerId, project.path),
  );
  settings.sandboxMode = sandboxForTaskMode(taskMode, settings.sandboxMode);
  if (compatibility.notices.length > 0) {
    await audit(
      ownerId,
      "settings.compatibility_fallback",
      "settings",
      conversationKey,
      "allowed",
      compatibility.notices.join("; ").slice(0, 500),
    );
  }
  const id = makeTaskId(seed);
  const estimatedPosition = queue.nextPosition(conversationKey);
  const replyInThread = launchOptions.replyInThread ?? false;
  const freshThread = launchOptions.freshThread ?? false;
  const progress = createTaskProgress(
    id,
    prompt,
    estimatedPosition,
    project.name,
    Date.now(),
    permissionLabel(settings.sandboxMode),
    {
      taskMode,
      modelLabel: compatibility.effectiveModel?.displayName ?? settings.model ?? "Codex 默认",
      reasoningLabel: settings.reasoningEffort
        ? reasoningEffortLabel(settings.reasoningEffort)
        : "默认推理",
      sessionLabel: freshThread
        ? "轻量新会话"
        : state.getThread(conversationKey)
          ? "继续当前会话"
          : "新会话",
      ...(launchOptions.runbook ? { runbookLabel: launchOptions.runbook.name } : {}),
      ...taskCollaborationContext(ownerId, ownerId, project, conversationKey),
    },
  );
  let card: TaskCardSession | null = null;
  let conversation: ConversationTurnSession | null = null;
  let fallbackCard: FallbackCardSession | null = null;
  const conversational = taskMode === "answer" || taskMode === "analyze";

  if (conversational) {
    try {
      conversation = await ConversationTurnSession.create(
        lark,
        progress,
        replyToMessageId,
        replyKey(seed, `conversation-${id}`),
        replyInThread,
      );
    } catch (error) {
      console.error(
        `[bridge] natural conversation unavailable for task=${id}; using task card`,
        error,
      );
    }
  }

  if (!conversation) {
    try {
      card = await TaskCardSession.create(
        lark,
        progress,
        replyToMessageId,
        replyKey(seed, `card-${id}`),
        replyInThread,
      );
    } catch (error) {
      console.error(`[bridge] CardKit unavailable for task=${id}; falling back to text`, error);
      fallbackCard = await productReply(
        replyToMessageId,
        `已接收任务 ${id}，当前队列位置 ${estimatedPosition}。`,
        replyKey(seed, `accepted-${id}`),
        "task-accepted",
      );
    }
  }

  const record: TaskRecord = {
    id,
    conversationKey,
    ownerId,
    controllerId: ownerId,
    prompt,
    project,
    status: "queued",
    card,
    conversation,
    fallbackCard,
    progress,
    replyToMessageId,
    seed,
    attachments,
    allowedExternalActions,
    settings,
    allowThreadBinding: true,
    replyInThread,
    freshThread,
  };
  if (card) {
    card.onSnapshot((snapshot) => {
      record.progress = snapshot.progress;
      record.status = snapshot.progress.phase;
      schedulePersistTaskRecord(record);
    });
  }
  if (conversation) {
    conversation.onSnapshot((snapshot) => {
      record.progress = snapshot.progress;
      record.status = snapshot.progress.phase;
      schedulePersistTaskRecord(record);
    });
  }
  tasks.set(id, record);
  await persistTaskRecord(record);
  await audit(
    ownerId,
    "task.enqueue",
    "task",
    id,
    "allowed",
    `${project.name}; mode=${taskMode}`,
  );
  pruneTaskRecords();

  try {
    scheduleTaskRecord(record);
  } catch (error) {
    record.status = "failed";
    const session = taskLiveSession(record);
    if (session) {
      await session.finishFailed("当前会话的任务队列已满，请稍后再试。");
      record.progress = session.progress;
    } else {
      record.progress = failTask(record.progress, "当前会话的任务队列已满，请稍后再试。");
      await updateTaskFallbackCard(
        record,
        `任务 ${record.id} 未能排队：当前会话的任务队列已满，请稍后再试。`,
        "task-queue-full",
        replyKey(record.seed, `queue-full-${record.id}`),
      );
    }
    await persistTaskRecord(record);
    throw error;
  }

  return id;
}

function scheduleTaskRecord(record: TaskRecord): void {
  queue.enqueue({
    id: record.id,
    conversationKey: record.conversationKey,
    resourceKey: record.project.path,
    onCancel: async () => {
      if (record.status !== "queued") return;
      record.status = "cancelled";
      const session = taskLiveSession(record);
      if (session) {
        await session.finishCancelled("排队期间收到停止请求");
        record.progress = session.progress;
      } else {
        record.progress = cancelTaskProgress(record.progress, "排队期间收到停止请求");
        await updateTaskFallbackCard(
          record,
          `任务 ${record.id} 已取消：排队期间收到停止请求。`,
          "task-cancelled",
          replyKey(record.seed, `cancelled-${record.id}`),
        );
      }
      await persistTaskRecord(record);
    },
    onPositionChange: async (queuePosition) => {
      if (record.status !== "queued") return;
      const session = taskLiveSession(record);
      if (session) {
        await session.updateQueuePosition(queuePosition);
        record.progress = session.progress;
      } else {
        record.progress = updateQueuePosition(record.progress, queuePosition);
        await updateTaskFallbackCard(
          record,
          `任务 ${record.id} 排队中，当前队列位置 ${queuePosition}。`,
          "task-queued",
          replyKey(record.seed, `queued-${record.id}-${queuePosition}`),
        );
      }
      await persistTaskRecord(record);
    },
    run: () => executeTaskRecord(record),
  });
}

async function executeTaskRecord(record: TaskRecord): Promise<void> {
  record.status = "running";
  try {
    const taskMode = taskModeOf(record.progress);
    const existingThreadId = record.freshThread
      ? undefined
      : state.getThread(record.conversationKey);
    const projectPolicy = await loadProjectPolicy(record.project.path);
    const actionDecision = decideProjectActions(
      projectPolicy,
      record.allowedExternalActions,
    );
    if (actionDecision.blockedActions.length > 0) {
      throw new ProjectPolicyError(
        `当前仓库策略禁止：${actionDecision.blockedActions.map(externalActionLabel).join("、")}`,
      );
    }
    const maximumSandbox = applyProjectSandboxMaximum(
      maxSandboxForActor(record.ownerId),
      projectPolicy,
    );
    record.settings.sandboxMode = persistentSandboxMode(
      record.settings.sandboxMode,
      maximumSandbox,
    );
    record.settings.sandboxMode = sandboxForTaskMode(taskMode, record.settings.sandboxMode);
    const allowsWrites = taskModeAllowsWrites(taskMode);
    const permissionLease =
      allowsWrites && maximumSandbox === "danger-full-access"
        ? state.consumePermissionLease(
            record.conversationKey,
            record.ownerId,
            record.project.path,
            existingThreadId,
          )
        : undefined;
    if (maximumSandbox !== "danger-full-access") {
      state.revokePermissionLease(record.conversationKey);
    }
    if (permissionLease) {
      record.settings.sandboxMode = "danger-full-access";
      await audit(
        record.ownerId,
        "permission_lease.consume",
        "task",
        record.id,
        "allowed",
        permissionLease.scope,
      );
    }
    const reviewBaseline = taskModeCapturesReview(taskMode)
      ? await captureTaskReviewBaseline(
          record.project.path,
          record.project.isGitRepository,
        )
      : undefined;
    const taskPermissionLabel = permissionLease
      ? "完全访问（临时）"
      : permissionLabel(record.settings.sandboxMode);
    const liveSession = taskLiveSession(record);
    if (liveSession) {
      await liveSession.markRunning(reviewBaseline, taskPermissionLabel);
      record.progress = liveSession.progress;
    } else {
      record.progress = startTask(
        record.progress,
        Date.now(),
        reviewBaseline,
        taskPermissionLabel,
      );
      await updateTaskFallbackCard(
        record,
        `${taskModeLabel(taskMode)} ${record.id} 正在进行 · ${record.project.name}\n${runningActivity(taskMode)}。`,
        "task-running",
        replyKey(record.seed, `running-${record.id}`),
      );
    }
    await persistTaskRecord(record);
    const result = await runner.run(
      record.conversationKey,
      record.id,
      record.prompt,
      record.project.path,
      record.project.isGitRepository,
      existingThreadId,
      (event) => {
        const session = taskLiveSession(record);
        if (session) session.handleCodexEvent(event);
        else record.progress = applyCodexEvent(record.progress, event);
        if (event.type === "thread.started") {
          void rememberActiveThread(record, event.thread_id).catch((error) => {
            console.error(
              `[bridge] unable to persist active thread task=${record.id}`,
              error,
            );
          });
        }
      },
      record.attachments,
      record.allowedExternalActions,
      {
        requestApproval: (request) => requestRuntimeApproval(record, request),
        requestUserInput: (request) => requestRuntimeUserInput(record, request),
      },
      record.settings,
    );
    if (!existingThreadId) {
      try {
        await runner.nameThread(
          result.threadId,
          sessionNameFromPrompt(record.prompt, record.project.name),
        );
      } catch (error) {
        console.warn(`[bridge] unable to name new thread id=${logRef(result.threadId)}`, error);
      }
    }
    await state.setThread(record.conversationKey, result.threadId);
    await state.registerThreadAccess(
      result.threadId,
      record.conversationKey,
      record.ownerId,
      record.project.path,
    );
    record.status = "succeeded";
    runtimeHealth.completedTasks += 1;
    if (record.conversation) {
      const updated = await record.conversation.finishSucceeded(
        result.finalResponse,
        result.usage,
        result.threadId,
      );
      record.progress = record.conversation.progress;
      if (!updated) {
        await durableReply(
          record.replyToMessageId,
          result.finalResponse || "Codex 已完成，但没有返回文字说明。",
          replyKey(record.seed, `conversation-completed-${record.id}`),
        );
      }
    } else if (record.card) {
      const cardUpdated = await record.card.finishSucceeded(
        result.finalResponse,
        result.usage,
        result.threadId,
      );
      record.progress = record.card.progress;
      if (!cardUpdated) {
        try {
          await updateTaskFallbackCard(
            record,
            `任务 ${record.id} 已完成 · ${record.project.name}\n\n${(result.finalResponse || "Codex 已完成").slice(0, 500)}`,
            "task-completed",
            replyKey(record.seed, `notify-completed-${record.id}`),
          );
        } catch (error) {
          console.error(`[bridge] completion notification delayed task=${record.id}`, error);
        }
      } else if (config.completionNotifications) {
        try {
          await productReply(
            record.replyToMessageId,
            `任务 ${record.id} 已完成 · ${record.project.name}\n结果已更新到原任务卡。`,
            replyKey(record.seed, `notify-completed-${record.id}`),
            "task-completed",
          );
        } catch (error) {
          console.error(`[bridge] completion notification delayed task=${record.id}`, error);
        }
      }
    } else {
      record.progress = succeedTask(
        record.progress,
        result.finalResponse,
        result.usage,
        result.threadId,
      );
      const usage = result.usage
        ? `\n\n用量：累计输入 ${result.usage.input_tokens}（新增 ${Math.max(0, result.usage.input_tokens - result.usage.cached_input_tokens)}，缓存 ${result.usage.cached_input_tokens}），输出 ${result.usage.output_tokens}${result.usage.model_calls ? `，模型调用 ${result.usage.model_calls} 次` : ""} tokens`
        : "";
      await updateTaskFallbackCard(
        record,
        `任务 ${record.id} 完成\n\n${result.finalResponse || "Codex 已完成，但没有返回文字说明。"}${usage}`,
        "task-completed",
        replyKey(record.seed, `completed-${record.id}`),
      );
    }
    await completeOnboardingAfterFirstSuccess(record).catch((error) => {
      console.warn(`[bridge] unable to complete first-success onboarding task=${record.id}`, error);
    });
    await persistTaskRecord(record);
    await audit(record.ownerId, "task.complete", "task", record.id, "allowed");
  } catch (error) {
    if (error instanceof CodexCancelledError) {
      if (error.reason === "shutdown") {
        record.status = "interrupted";
        const reason =
          "桥接服务在任务运行期间停止。为避免重复修改，这个任务没有自动重跑。";
        const session = taskLiveSession(record);
        if (session) {
          const updated = await session.finishInterrupted(reason);
          record.progress = session.progress;
          if (!updated) {
            await notifyTaskFallback(
              record,
              `任务 ${record.id} 已中断：${reason}`,
              "task-interrupted",
              replyKey(record.seed, `interrupted-${record.id}`),
            );
          }
        } else {
          record.progress = interruptTaskProgress(record.progress, reason);
          await updateTaskFallbackCard(
            record,
            `任务 ${record.id} 已中断：${reason}`,
            "task-interrupted",
            replyKey(record.seed, `interrupted-${record.id}`),
          );
        }
        await persistTaskRecord(record);
        await audit(record.ownerId, "task.interrupt", "task", record.id, "failed", "service shutdown");
        return;
      }
      if (error.reason === "timeout") {
        record.status = "failed";
        runtimeHealth.failedTasks += 1;
        const reason = `执行超时：任务超过 ${Math.ceil(config.codexTimeoutMs / 60_000)} 分钟运行时限。`;
        const session = taskLiveSession(record);
        if (session) {
          const updated = await session.finishFailed(reason);
          record.progress = session.progress;
          if (!updated) {
            await notifyTaskFallback(
              record,
              `任务 ${record.id} 执行失败：${reason}`,
              "task-timeout",
              replyKey(record.seed, `timeout-${record.id}`),
            );
          }
        } else {
          record.progress = failTask(record.progress, reason);
          await updateTaskFallbackCard(
            record,
            `任务 ${record.id} 执行失败：${reason}`,
            "task-timeout",
            replyKey(record.seed, `timeout-${record.id}`),
          );
        }
        await persistTaskRecord(record);
        await audit(record.ownerId, "task.timeout", "task", record.id, "failed", reason);
        return;
      }
      record.status = "cancelled";
      const reason = "用户取消";
      const session = taskLiveSession(record);
      if (session) {
        const updated = await session.finishCancelled(reason);
        record.progress = session.progress;
        if (!updated) {
          await notifyTaskFallback(
            record,
            `任务 ${record.id} 已取消：${reason}。`,
            "task-cancelled",
            replyKey(record.seed, `cancelled-${record.id}`),
          );
        }
      } else {
        record.progress = cancelTaskProgress(record.progress, reason);
        await updateTaskFallbackCard(
          record,
          `任务 ${record.id} 已取消：${reason}。`,
          "task-cancelled",
          replyKey(record.seed, `cancelled-${record.id}`),
        );
      }
      await persistTaskRecord(record);
      await audit(record.ownerId, "task.cancel", "task", record.id, "allowed", reason);
      return;
    }
    if (error instanceof CodexPolicyViolationError) runtimeHealth.blockedCommands += 1;
    record.status = "failed";
    runtimeHealth.failedTasks += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[bridge] task failed id=${record.id}`, error);
    const session = taskLiveSession(record);
    if (session) {
      const updated = await session.finishFailed(message.slice(0, 2_000));
      record.progress = session.progress;
      if (!updated) {
        await notifyTaskFallback(
          record,
          `任务 ${record.id} 执行失败：${message.slice(0, 800)}`,
          "task-failed",
          replyKey(record.seed, `failed-${record.id}`),
        );
      }
    } else {
      record.progress = failTask(record.progress, message.slice(0, 2_000));
      await updateTaskFallbackCard(
        record,
        `任务 ${record.id} 执行失败：${message.slice(0, 800)}`,
        "task-failed",
        replyKey(record.seed, `failed-${record.id}`),
      );
    }
    await persistTaskRecord(record);
    await audit(record.ownerId, "task.fail", "task", record.id, "failed", message.slice(0, 500));
  } finally {
    if (taskModeCapturesReview(taskModeOf(record.progress))) {
      await refreshTaskReview(record).catch((error) => {
        console.error(`[bridge] unable to finalize review task=${record.id}`, error);
      });
    }
    await closeRuntimeInteractionsForTask(record.id);
  }
}

async function refreshTaskReview(record: TaskRecord): Promise<void> {
  const review = await captureTaskReview(
    record.project.path,
    record.progress.reviewBaseline,
    record.progress.changedFiles,
  );
  if (record.card) {
    await record.card.attachReview(review);
    record.progress = record.card.progress;
  } else {
    record.progress = attachTaskReview(record.progress, review);
  }
  await persistTaskRecord(record);
}

async function rememberActiveThread(record: TaskRecord, threadId: string): Promise<void> {
  if (!record.allowThreadBinding) return;
  await state.setThread(record.conversationKey, threadId);
  await state.registerThreadAccess(
    threadId,
    record.conversationKey,
    record.ownerId,
    record.project.path,
  );
}

async function recordAcceptedSteer(conversationKey: string): Promise<string | undefined> {
  const taskId = runner.getActiveTask(conversationKey);
  if (!taskId) return undefined;
  const record = tasks.get(taskId);
  if (!record) return taskId;
  const session = taskLiveSession(record);
  if (session) {
    await session.markSteered();
    record.progress = session.progress;
  } else {
    record.progress = noteSteer(record.progress);
  }
  await persistTaskRecord(record);
  return taskId;
}

function activeTaskTarget(
  actorId: string,
  chatId: string,
  preferredConversationKey: string,
  allowChatFallback = true,
): { status: "found"; record: TaskRecord } | { status: "ambiguous" } | { status: "none" } {
  const preferredTaskId = runner.getActiveTask(preferredConversationKey);
  const preferred = preferredTaskId ? tasks.get(preferredTaskId) : undefined;
  if (preferred && canControlTask(config, actorId, preferred)) {
    return { status: "found", record: preferred };
  }
  if (!allowChatFallback) return { status: "none" };
  const controlled = [...tasks.values()].filter(
    (task) =>
      task.controllerId === actorId &&
      task.status === "running" &&
      conversationBelongsToChat(task.conversationKey, chatId) &&
      runner.getActiveTask(task.conversationKey) === task.id,
  );
  if (controlled.length === 1) return { status: "found", record: controlled[0]! };
  if (controlled.length > 1) return { status: "ambiguous" };
  return { status: "none" };
}

function explicitSteerTarget(
  actorId: string,
  chatId: string,
  addition: string,
): { record: TaskRecord; addition: string } | null | "denied" {
  const match = addition.match(/^#([A-Za-z0-9]{1,16})\s+(.+)$/s);
  if (!match?.[1] || !match[2]?.trim()) return null;
  const record = tasks.get(match[1]);
  if (
    !record ||
    record.status !== "running" ||
    !conversationBelongsToChat(record.conversationKey, chatId) ||
    !canControlTask(config, actorId, record)
  ) {
    return "denied";
  }
  return { record, addition: match[2].trim() };
}

async function handleEvent(raw: unknown): Promise<void> {
  const event = parseFeishuEvent(raw);
  if (!event) {
    console.error("[bridge] ignored event with unexpected shape");
    return;
  }
  const canStartGroupBinding =
    event.chat_type === "group" &&
    !state.getProjectChat(event.chat_id) &&
    canAdminister(config, event.sender_id);
  const canExplainUnboundGroup = canReceiveUnboundGroupGuidance(
    event,
    config,
    Boolean(state.getProjectChat(event.chat_id)),
  );
  if (!isAuthorized(event, config) && !canStartGroupBinding && !canExplainUnboundGroup) {
    console.warn(`[bridge] rejected unauthorized ${eventSummary(event)}`);
    return;
  }
  if (state.hasSeenEvent(event.event_id) || inFlightEvents.has(event.event_id)) {
    console.info(`[bridge] ignored duplicate event=${logRef(event.event_id)}`);
    return;
  }

  inFlightEvents.add(event.event_id);
  try {
    await state.setChatType(event.chat_id, event.chat_type);
    const existingProjectChat = event.chat_type === "group"
      ? state.getProjectChat(event.chat_id)
      : undefined;
    if (
      existingProjectChat &&
      existingProjectChat.messageStatus !== "succeeded" &&
      (!isTextualMessageType(event.message_type) ||
        !hasConfiguredBotMention(event.content, config.botMentionNames))
    ) {
      const verifiedProjectChat = await state.updateProjectChatSetup(event.chat_id, {
        messageStatus: "succeeded",
        lastAttemptAt: new Date().toISOString(),
        ...(existingProjectChat.lastErrorStep === "messages"
          ? { lastErrorStep: null, lastError: null }
          : {}),
      });
      await audit(
        event.sender_id,
        "project.chat.messages_verified",
        "project",
        existingProjectChat.projectPath,
        "allowed",
        "ordinary group message delivered",
      );
      void scheduleProjectChatWorkspaceRefresh(verifiedProjectChat.chatId).catch((error) => {
        console.warn(
          `[bridge] unable to refresh verified project chat workspace chat=${logRef(verifiedProjectChat.chatId)}`,
          error,
        );
      });
    }
    if (event.chat_type === "group" && !state.getProjectChat(event.chat_id)) {
      if (!canAdminister(config, event.sender_id)) {
        await productReply(
          event.message_id,
          "这个群还没有绑定项目。请让 Codex 管理员在群里发送“项目”，完成第一次也是唯一一次选择。",
          replyKey(event.event_id, "project-group-admin-required"),
          "project-group-admin-required",
        );
        await state.markEventIfNew(event.event_id);
        return;
      }
      // The group remains untrusted until the immutable binding is durably stored.
      // Before that point it may only render the administrator binding card.
      const conversationKey = key(event);
      const project = await currentProject(conversationKey, event.sender_id);
      await replyProjectCard(
        event,
        project,
        "请选择这个群唯一对应的项目。绑定完成前不会执行任何 Codex 任务。",
        "project-group-bind",
        { conversationKey, ownerId: event.sender_id },
      );
      await audit(
        event.sender_id,
        "project.chat.bind_start",
        "project",
        event.chat_id,
        "allowed",
        "administrator initiated first binding",
      );
      await state.markEventIfNew(event.event_id);
      return;
    }
    await handleAuthorizedMessage(event);
    await state.markEventIfNew(event.event_id);
  } finally {
    inFlightEvents.delete(event.event_id);
  }
}

async function handleAuthorizedMessage(event: FeishuMessageEvent): Promise<void> {
  console.info(`[bridge] accepted ${eventSummary(event)}`);
  const conversationKey = key(event);
  const actorId = event.sender_id;
  const directQuestionId = pendingQuestionByConversation.get(conversationKey);
  const directQuestion = directQuestionId
    ? pendingRuntimeQuestions.get(directQuestionId)
    : undefined;
  const directTask = directQuestion ? tasks.get(directQuestion.taskId) : undefined;
  const directAuthorized = directQuestion && directTask
    ? canControlTask(config, actorId, directTask)
    : false;
  const controlledQuestions = (isTopicConversationKey(conversationKey)
    ? []
    : [...pendingRuntimeQuestions.values()]).filter((pending) => {
    if (pending.id === directQuestion?.id) return false;
    const task = tasks.get(pending.taskId);
    return Boolean(
      task &&
      conversationBelongsToChat(pending.conversationKey, event.chat_id) &&
      canControlTask(config, actorId, task),
    );
  });
  const pendingQuestion = directAuthorized
    ? directQuestion
    : controlledQuestions.length === 1
      ? controlledQuestions[0]
      : undefined;
  const pendingQuestionId = pendingQuestion?.id;
  if (config.logMessageContent) {
    console.info(
      pendingQuestion?.question.isSecret ||
        directQuestion?.question.isSecret ||
        controlledQuestions.some((pending) => pending.question.isSecret)
        ? "[bridge] content=[redacted: pending secret question]"
        : `[bridge] content=${JSON.stringify(event.content)}`,
    );
  }
  if (
    isTextualMessageType(event.message_type) &&
    directQuestion &&
    !directAuthorized
  ) {
    await productReply(
      event.message_id,
      "这个任务已经转交给新的控制者。请从任务卡点击“接管任务”收回后再回答。",
      replyKey(event.event_id, "runtime-question-transferred"),
      "task-question-transferred",
    );
    return;
  }
  if (
    isTextualMessageType(event.message_type) &&
    !pendingQuestion &&
    controlledQuestions.length > 1
  ) {
    await productReply(
      event.message_id,
      "你当前控制的多个任务都在等待回答。为避免答错任务，请直接使用对应的问题卡。",
      replyKey(event.event_id, "runtime-question-ambiguous"),
      "task-question-ambiguous",
    );
    return;
  }
  if (pendingQuestionId && isTextualMessageType(event.message_type)) {
    const answer = normalizePrompt(event.content, event.chat_type, config.botMentionNames);
    if (pendingQuestion && answer) {
      if (pendingQuestion.question.isSecret) {
        await productReply(
          event.message_id,
          "出于安全考虑，这条内容没有转发给 Codex，也没有写入本地任务记录。请回本机完成敏感输入，或在问题卡点击“取消回答”。",
          replyKey(event.event_id, "secret-answer-blocked"),
          "security-secret-denied",
        );
        await audit(actorId, "runtime.question.secret_blocked", "task", pendingQuestion.taskId, "denied");
        return;
      }
      const cancelAnswer = ["取消", "cancel", "/cancel", "stop", "/stop"].includes(
        answer.trim().toLocaleLowerCase(),
      );
      await resolveRuntimeQuestion(
        pendingQuestion,
        cancelAnswer ? "" : answer,
        cancelAnswer ? "cancelled" : "answered",
        actorId,
      );
      return;
    }
  }
  if (isAttachmentMessageType(event.message_type)) {
    await ensureFirstRunOnboardingState(event, conversationKey, actorId);
    if (!(await requireOperator(event, "attachment"))) return;
    try {
      const workspaceSession = await preparePromptWorkspaceSession(event, actorId);
      const attachments = await prepareAttachments(event);
      if (attachments.length === 0) {
        await reply(
          event,
          "附件已收到，但当前只能直接处理图片和常见文本/代码文件；这个附件没有可安全读取的内容。",
          "attachment-unsupported",
        );
        return;
      }
      await enqueuePrompt(
        event.message_id,
        workspaceSession.conversationKey,
        actorId,
        attachmentPrompt(event, attachments),
        event.event_id,
        attachments,
        [],
        { replyInThread: workspaceSession.replyInThread },
      );
    } catch (error) {
      await replyQueueOrError(event, error, "attachment");
    }
    return;
  }

  if (!isTextualMessageType(event.message_type)) {
    await reply(
      event,
      "目前支持文本、图片和常见文本/代码文件。请换一种格式发送。",
      "unsupported",
    );
    return;
  }

  const prompt = normalizePrompt(event.content, event.chat_type, config.botMentionNames);
  if (!prompt) {
    await reply(event, HELP_TEXT, "empty");
    return;
  }

  const command = classifyCommand(prompt);
  if (command === "onboarding") {
    await openOnboarding(event);
    return;
  }
  await ensureFirstRunOnboardingState(event, conversationKey, actorId);

  if (
    command === "prompt" &&
    shouldClarifyContextualFollowUp(prompt, {
      hasThread: Boolean(state.getThread(conversationKey)),
      hasActiveTask: Boolean(runner.getActiveTask(conversationKey)),
      queuedTasks: queue.queuedForConversation(conversationKey),
    })
  ) {
    await reply(
      event,
      "当前没有可继续的会话。请直接写出完整目标；如果要接着以前的工作，请发送“会话”并恢复对应记录。",
      "contextual-follow-up-empty",
    );
    return;
  }

  switch (command) {
    case "help":
      await reply(event, HELP_TEXT, "help");
      return;
    case "home": {
      await replyPrivateHomeCard(event);
      return;
    }
    case "status": {
      await replyDeviceCard(event);
      return;
    }
    case "quota": {
      await replyQuotaCard(event);
      return;
    }
    case "projects": {
      await projectRegistry.refresh();
      const project = await currentProject(conversationKey, actorId);
      await replyProjectCard(event, project);
      return;
    }
    case "project_overview": {
      await replyProjectOverview(event);
      return;
    }
    case "switch_project": {
      if (!(await requireOperator(event, "project.switch"))) return;
      await projectRegistry.refresh();
      const selector = projectSelector(prompt);
      if (!selector) {
        const project = await currentProject(conversationKey, actorId);
        await replyProjectCard(event, project, "请从下拉列表选择要切换的项目。", "switch-help");
        return;
      }
      const resolution = resolveAccessibleProject(selector, actorId);
      if (resolution.status !== "found") {
        await reply(event, projectResolutionError(selector, resolution, actorId), "switch-not-found");
        return;
      }
      const current = await currentProject(conversationKey, actorId);
      const projectChat = state.getProjectChat(chatIdFromConversationKey(conversationKey));
      if (projectChat && current.path !== resolution.project.path) {
        await replyProjectCard(
          event,
          current,
          `本群已固定连接 ${current.name}，不能切换到其他项目。请回机器人私聊创建或打开另一个项目群。`,
          "switch-project-chat-blocked",
        );
        await audit(
          actorId,
          "project.switch",
          "project",
          resolution.project.path,
          "denied",
          "project chat is fixed",
        );
        return;
      }
      if (current.path === resolution.project.path) {
        await replyProjectCard(
          event,
          current,
          `当前已经是 ${current.name}，无需切换。`,
          "switch-unchanged",
        );
        return;
      }
      const activeBeforeSwitch = runner.getActiveTask(conversationKey) ? 1 : 0;
      const queuedBeforeSwitch = queue.queuedForConversation(conversationKey);
      const hasSavedThread = Boolean(state.getThread(conversationKey));
      if (
        !isConfirmedProjectSwitch(prompt) &&
        (activeBeforeSwitch > 0 || queuedBeforeSwitch > 0 || hasSavedThread)
      ) {
        const taskImpact = activeBeforeSwitch + queuedBeforeSwitch > 0
          ? `会停止 ${activeBeforeSwitch} 个运行任务和 ${queuedBeforeSwitch} 个排队任务`
          : "当前没有未完成任务";
        await replyProjectCard(
          event,
          current,
          `尚未切换。切换到 ${resolution.project.name} ${taskImpact}，并清空当前聊天保存的 Codex 上下文。请在下拉框确认，或发送“确认切换 ${resolution.project.name}”。`,
          "switch-confirm",
        );
        return;
      }
      const cancelledActive = runner.cancel(conversationKey);
      const cancelledQueued = queue.cancelPending(conversationKey);
      await closeRuntimeInteractionsForConversation(conversationKey);
      const switched = await state.setProject(conversationKey, resolution.project.path);
      await state.recordProjectUse(actorId, resolution.project.path);
      await audit(actorId, "project.switch", "project", resolution.project.path, "allowed");
      await replyProjectCard(
        event,
        resolution.project,
        switchFeedback(
          resolution.project,
          cancelledActive ? 1 : 0,
          cancelledQueued,
          switched.threadReset,
        ),
        "switch-complete",
      );
      return;
    }
    case "settings": {
      const change = settingsChange(prompt);
      if (!change) {
        await replyControlCenter(event);
        return;
      }
      if (!(await requireOperator(event, "settings.change"))) return;
      try {
        const feedback = await applySettingsChange(conversationKey, actorId, change);
        await replyControlCenter(event, feedback, "settings-changed");
      } catch (error) {
        await reply(event, `设置未修改：${(error as Error).message}`, "settings-invalid");
      }
      return;
    }
    case "sessions": {
      await replySessionCenter(event);
      return;
    }
    case "tasks": {
      await replyTaskCenter(event);
      return;
    }
    case "team": {
      await replyTeamDashboard(event);
      return;
    }
    case "runbooks": {
      await replyRunbookCenter(event);
      return;
    }
    case "runbook_run": {
      if (!(await requireOperator(event, "runbook.execute"))) return;
      const invocation = parseRunbookInvocation(prompt);
      if (!invocation) {
        await reply(
          event,
          "运行格式不正确。请先发送“运行手册”查看模板，再使用 /run <手册ID> 参数=值。",
          "runbook-invocation-invalid",
        );
        return;
      }
      const project = await currentProject(conversationKey, actorId);
      const catalog = await loadProjectRunbooks(project.path);
      const runbook = catalog.runbooks.find((candidate) => candidate.id === invocation.id);
      if (!runbook) {
        await replyRunbookCenter(
          event,
          catalog.status === "invalid"
            ? `配置未通过安全校验：${catalog.error ?? "未知错误"}`
            : `没有找到运行手册“${invocation.id}”。`,
          "runbook-not-found",
        );
        return;
      }
      try {
        await launchRunbook(
          event.message_id,
          conversationKey,
          actorId,
          event.event_id,
          runbook,
          invocation.values,
        );
      } catch (error) {
        await replyRunbookCenter(
          event,
          `运行手册未启动：${(error as Error).message}`,
          "runbook-start-failed",
        );
      }
      return;
    }
    case "compact": {
      if (!(await requireOperator(event, "session.compact"))) return;
      const threadId = state.getThread(conversationKey);
      if (!threadId) {
        await reply(event, "当前还没有可压缩的 Codex 会话。", "compact-empty");
        return;
      }
      await runner.compactThread(threadId);
      await audit(actorId, "session.compact", "session", threadId, "allowed");
      await reply(event, "当前会话已完成上下文压缩，后续任务会继续沿用它。", "compact-complete");
      return;
    }
    case "audit": {
      const isAdmin = canAdminister(config, actorId);
      const entries = state.listAudit(20, isAdmin ? undefined : actorId);
      await reply(event, formatAuditLog(entries, isAdmin), "audit");
      return;
    }
    case "new": {
      if (!(await requireOperator(event, "session.new"))) return;
      const cancelledActive = runner.cancel(conversationKey);
      const cancelledQueued = queue.cancelPending(conversationKey);
      await closeRuntimeInteractionsForConversation(conversationKey);
      const reset = await state.resetThread(conversationKey);
      await audit(actorId, "session.new", "session", conversationKey, "allowed");
      await reply(
        event,
        `已创建新会话。旧会话${reset ? "已清除" : "原本为空"}；取消运行中任务 ${cancelledActive ? 1 : 0} 个、排队任务 ${cancelledQueued} 个。`,
        "new",
      );
      return;
    }
    case "cancel": {
      if (!(await requireOperator(event, "task.cancel"))) return;
      const target = activeTaskTarget(actorId, event.chat_id, conversationKey);
      if (target.status === "found" && target.record.conversationKey !== conversationKey) {
        const cancelled = runner.cancel(target.record.conversationKey);
        if (cancelled) await closeRuntimeInteractionsForTask(target.record.id);
        await audit(
          actorId,
          "task.cancel_controlled",
          "task",
          target.record.id,
          cancelled ? "allowed" : "denied",
        );
        await reply(
          event,
          cancelled
            ? `已向你当前控制的任务 ${target.record.id} 发送停止请求。`
            : "该任务已经结束，无需停止。",
          "cancel-controlled",
        );
        return;
      }
      if (target.status === "ambiguous") {
        await reply(
          event,
          "你当前控制多个运行任务。为避免停止错误任务，请在对应任务卡或任务中心点击“停止”。",
          "cancel-ambiguous",
        );
        return;
      }
      const cancelledActive = runner.cancel(conversationKey);
      const cancelledQueued = queue.cancelPending(conversationKey);
      await closeRuntimeInteractionsForConversation(conversationKey);
      await audit(actorId, "task.cancel_all", "task", conversationKey, "allowed");
      await reply(
        event,
        `取消请求已处理：运行中 ${cancelledActive ? 1 : 0} 个，排队 ${cancelledQueued} 个。`,
        "cancel",
      );
      return;
    }
    case "steer": {
      if (!(await requireOperator(event, "task.steer"))) return;
      const addition = steerPrompt(prompt);
      if (!addition) {
        await reply(event, "请写成：追加 <补充要求>。", "steer-empty");
        return;
      }
      const explicitTarget = explicitSteerTarget(actorId, event.chat_id, addition);
      if (explicitTarget === "denied") {
        await reply(
          event,
          "指定任务不存在、已经结束或不由你控制。请发送“任务”查看最新状态。",
          "steer-target-denied",
        );
        return;
      }
      let targetRecord: TaskRecord | undefined;
      if (explicitTarget) {
        targetRecord = explicitTarget.record;
      } else {
        const target = activeTaskTarget(
          actorId,
          event.chat_id,
          conversationKey,
          !isTopicConversationKey(conversationKey),
        );
        if (target.status === "ambiguous") {
          await reply(
            event,
            "你当前控制多个运行任务。请写成：追加 #任务ID <补充要求>。",
            "steer-ambiguous",
          );
          return;
        }
        if (target.status === "found") targetRecord = target.record;
      }
      const effectiveAddition = explicitTarget ? explicitTarget.addition : addition;
      const externalActions = externalActionsForPrompt(effectiveAddition);
      if (externalActions.length > 0) {
        await requestExternalConfirmation(event, effectiveAddition, externalActions);
        return;
      }
      try {
        const targetConversation = targetRecord?.conversationKey ?? conversationKey;
        const accepted = await runner.steer(targetConversation, effectiveAddition);
        const taskId = accepted ? await recordAcceptedSteer(targetConversation) : undefined;
        if (accepted) {
          await audit(actorId, "task.steer", "task", taskId ?? "active", "allowed");
        }
        await reply(
          event,
          accepted
            ? "补充要求已加入当前任务，Codex 会在本轮中继续处理。"
            : "当前没有可追加的运行任务；请直接发送这条要求，它会作为新任务进入队列。",
          accepted ? "steer-accepted" : "steer-unavailable",
        );
      } catch (error) {
        console.error("[bridge] unable to steer active turn", error);
        await reply(event, "补充要求暂时未能加入当前任务，请直接作为新任务发送。", "steer-failed");
      }
      return;
    }
    case "queue_prompt": {
      if (!(await requireOperator(event, "task.enqueue"))) return;
      const queued = queuedPrompt(prompt);
      if (!queued) {
        await reply(event, "请写成：排队 <独立任务>。", "queue-empty");
        return;
      }
      const externalActions = externalActionsForPrompt(queued);
      try {
        const workspaceSession = await preparePromptWorkspaceSession(event, actorId);
        if (externalActions.length > 0) {
          await requestExternalConfirmation(event, queued, externalActions, workspaceSession);
        } else {
          await enqueuePrompt(
            event.message_id,
            workspaceSession.conversationKey,
            actorId,
            queued,
            event.event_id,
            [],
            [],
            { replyInThread: workspaceSession.replyInThread },
          );
        }
      } catch (error) {
        await replyQueueOrError(event, error, "queue-prompt");
      }
      return;
    }
    case "prompt": {
      if (!(await requireOperator(event, "task.enqueue"))) return;
      const externalActions = externalActionsForPrompt(prompt);
      try {
        const workspaceSession = await preparePromptWorkspaceSession(event, actorId);
        if (externalActions.length > 0) {
          await requestExternalConfirmation(event, prompt, externalActions, workspaceSession);
        } else {
          const target = workspaceSession.startsNewTopic
            ? { status: "none" as const }
            : activeTaskTarget(
                actorId,
                event.chat_id,
                workspaceSession.conversationKey,
                !isTopicConversationKey(workspaceSession.conversationKey),
              );
          const targetConversation = target.status === "found"
            ? target.record.conversationKey
            : workspaceSession.conversationKey;
          const steered = target.status !== "ambiguous" &&
            await runner.steer(targetConversation, prompt);
          if (steered) {
            const taskId = await recordAcceptedSteer(targetConversation);
            await audit(actorId, "task.steer", "task", taskId ?? "active", "allowed");
            await reply(
              event,
              "补充要求已自动加入正在运行的任务。若要创建独立任务，请发送“排队 <任务>”。",
              "auto-steer",
            );
          } else {
            await enqueuePrompt(
              event.message_id,
              workspaceSession.conversationKey,
              actorId,
              prompt,
              event.event_id,
              [],
              [],
              {
                replyInThread: workspaceSession.replyInThread,
                freshThread: shouldStartFreshAnswerThread(prompt, {
                  hasThread: Boolean(state.getThread(workspaceSession.conversationKey)),
                  isReply: Boolean(event.reply_to || event.root_id || event.thread_id),
                }),
              },
            );
          }
        }
      } catch (error) {
        await replyQueueOrError(event, error, "prompt");
      }
      return;
    }
  }
}

async function handleCardAction(raw: unknown): Promise<void> {
  const event = parseCardActionEvent(raw);
  if (!event) {
    console.error("[bridge] ignored card action with unexpected shape");
    return;
  }
  const parsedAction = parseCardActionValue(event);
  const bindingCard = projectCards.get(event.message_id);
  const canFinishGroupBinding = Boolean(
    parsedAction?.action === "select_project" &&
      bindingCard &&
      conversationBelongsToChat(bindingCard.conversationKey, event.chat_id) &&
      !state.getProjectChat(event.chat_id) &&
      canAdminister(config, event.operator_id),
  );
  const canExplainGroupBinding = Boolean(
    parsedAction?.action === "select_project" &&
      bindingCard &&
      conversationBelongsToChat(bindingCard.conversationKey, event.chat_id) &&
      !state.getProjectChat(event.chat_id) &&
      roleForSender(config, event.operator_id),
  );
  if (
    !isAuthorizedCardAction(event, config) &&
    !canFinishGroupBinding &&
    !canExplainGroupBinding
  ) {
    console.warn(
      `[bridge] rejected unauthorized card action event=${logRef(event.event_id)} operator=${logRef(event.operator_id)}`,
    );
    return;
  }
  if (
    config.sandboxMode === "danger-full-access" &&
    !config.allowedChatIds.has(event.chat_id) &&
    state.getChatType(event.chat_id) !== "p2p" &&
    !canFinishGroupBinding &&
    !canExplainGroupBinding
  ) {
    console.warn(
      `[bridge] rejected full-access card action from an untrusted chat event=${logRef(event.event_id)}`,
    );
    return;
  }
  if (state.hasSeenEvent(event.event_id) || inFlightEvents.has(event.event_id)) {
    console.info(`[bridge] ignored duplicate card action=${logRef(event.event_id)}`);
    return;
  }

  inFlightEvents.add(event.event_id);
  runtimeHealth.lastCardActionAt = Date.now();
  try {
    if (canExplainGroupBinding && !canFinishGroupBinding) {
      await productReply(
        event.message_id,
        "这个群还没有绑定项目。只有 Codex 管理员能完成首次绑定；请联系管理员在这张卡片上选择项目。绑定前不会执行任何任务。",
        replyKey(event.event_id, "project-group-admin-required-action"),
        "project-group-admin-required-action",
      );
      await audit(
        event.operator_id,
        "project.chat.bind",
        "project",
        event.option ?? "unknown",
        "denied",
        "administrator required",
      );
    } else {
      await handleAuthorizedCardAction(event);
    }
    await state.markEventIfNew(event.event_id);
  } finally {
    inFlightEvents.delete(event.event_id);
  }
}

async function handleAuthorizedCardAction(event: FeishuCardActionEvent): Promise<void> {
  const action = parseCardActionValue(event);
  if (!action) {
    console.warn(`[bridge] ignored unknown card action event=${logRef(event.event_id)}`);
    return;
  }
  if (action.bridge === "feishu-codex-v7") {
    await handleRunbookCardAction(event, action);
    return;
  }
  if (action.bridge === "feishu-codex-v6") {
    await handleReviewCardAction(event, action);
    return;
  }
  if (action.bridge === "feishu-codex-v5") {
    await handleV5CardAction(event, action);
    return;
  }
  if (action.bridge === "feishu-codex-v4") {
    if ("request_id" in action) await handleRuntimeCardAction(event, action);
    else await handleDeviceCardAction(event, action);
    return;
  }
  if (action.action === "approve_external" || action.action === "reject_external") {
    await handleExternalConfirmation(event, action);
    return;
  }
  if (action.action === "select_project") {
    await handleProjectCardSelection(event);
    return;
  }
  if (action.action === "toggle_project_favorite") {
    await handleProjectFavoriteToggle(event);
    return;
  }
  if (action.action === "project_chat") {
    await handleProjectChatAction(event);
    return;
  }
  if (!("task_id" in action)) return;
  const record = tasks.get(action.task_id);
  const isReadOnlyTaskAction =
    action.action === "review" ||
    action.action === "changes" ||
    action.action === "result" ||
    action.action === "result_back";
  const actionAuthorized = record
    ? action.action === "takeover"
      ? canTakeOverTask(config, event.operator_id, record)
      : isReadOnlyTaskAction
        ? canViewTask(config, event.operator_id, record)
        : canControlTask(config, event.operator_id, record)
    : false;
  if (
    !record ||
    !conversationBelongsToChat(record.conversationKey, event.chat_id) ||
    !actionAuthorized
  ) {
    console.warn(`[bridge] card action references unavailable task=${action.task_id}`);
    await productReply(
      event.message_id,
      "这条任务记录已过期或不属于当前聊天，请重新发送任务。",
      replyKey(event.event_id, "task-unavailable"),
      "task-unavailable",
    );
    return;
  }

  console.info(`[bridge] card action=${action.action} task=${record.id}`);
  switch (action.action) {
    case "handoff": {
      if (state.getChatType(event.chat_id) !== "group") {
        await record.card?.addActionNote("任务转交只在团队群聊中开放；私聊任务始终由发起人控制。");
        await audit(event.operator_id, "task.handoff", "task", record.id, "denied", "not group");
        return;
      }
      const target = event.option
        ? resolveMemberSelector(config, event.option)
        : undefined;
      if (
        !target ||
        target.role === "viewer" ||
        !canAccessProject(config, target.id, record.project)
      ) {
        await record.card?.addActionNote("转交失败：目标成员已失效、为只读角色或无权访问当前项目。");
        await audit(event.operator_id, "task.handoff", "task", record.id, "denied", "invalid target");
        return;
      }
      await setTaskController(record, target.id, event.operator_id, "handoff");
      return;
    }
    case "takeover": {
      if (state.getChatType(event.chat_id) !== "group") {
        await audit(event.operator_id, "task.takeover", "task", record.id, "denied", "not group");
        return;
      }
      await setTaskController(record, event.operator_id, event.operator_id, "takeover");
      return;
    }
    case "cancel": {
      const cancelledQueued = queue.cancelTask(record.id);
      const cancelledActive =
        runner.getActiveTask(record.conversationKey) === record.id &&
        runner.cancel(record.conversationKey);
      if (cancelledActive) await closeRuntimeInteractionsForTask(record.id);
      if (!cancelledQueued && !cancelledActive) {
        await record.card?.addActionNote("任务已经结束，无需取消。");
      }
      return;
    }
    case "changes":
    case "review": {
      await replyReviewCard(event, record);
      await audit(event.operator_id, "task.review", "task", record.id, "allowed");
      return;
    }
    case "result": {
      if (!record.card || record.card.messageId !== event.message_id) {
        await productReply(
          event.message_id,
          "完整结果入口已过期，请从最新任务卡重新打开。",
          replyKey(event.event_id, `result-unavailable-${record.id}`),
          "task-result-unavailable",
        );
        return;
      }
      reviewCards.delete(event.message_id);
      const updated = await record.card.showSurface(
        renderTaskResultCard(record.card.progress),
        "result-surface",
      );
      if (!updated) {
        await productReply(
          event.message_id,
          record.progress.finalResponse || "任务已完成，但完整结果暂时无法展开。",
          replyKey(event.event_id, `result-fallback-${record.id}`),
          "task-result-fallback",
        );
      }
      await audit(event.operator_id, "task.result", "task", record.id, "allowed");
      return;
    }
    case "result_back": {
      if (record.card?.messageId === event.message_id) {
        reviewCards.delete(event.message_id);
        await record.card.restoreTaskSurface();
      }
      await audit(event.operator_id, "task.result.back", "task", record.id, "allowed");
      return;
    }
    case "retry": {
      if (!canOperate(config, record.ownerId)) {
        await record.card?.addActionNote(
          "任务发起人的执行权限已被撤销，不能重新执行；请由当前操作者重新发送任务。",
        );
        await audit(event.operator_id, "task.retry", "task", record.id, "denied", "owner revoked");
        return;
      }
      if (record.status === "queued" || record.status === "running") {
        await record.card?.addActionNote("当前任务尚未结束，暂不能重新执行。");
        return;
      }
      const project = await currentProject(record.conversationKey, record.ownerId);
      if (project.path !== record.project.path) {
        await record.card?.addActionNote(
          `原任务属于 ${record.project.name}，当前项目是 ${project.name}；请先切回原项目再重试。`,
        );
        return;
      }
      if (record.allowedExternalActions.length > 0) {
        try {
          await createExternalConfirmation(
            event.message_id,
            record.conversationKey,
            record.ownerId,
            record.prompt,
            record.allowedExternalActions,
            event.event_id,
            record.attachments,
            record.replyInThread,
          );
          await record.card?.addActionNote("已创建新的外部动作确认卡；确认后才会重新执行。");
        } catch (error) {
          await record.card?.addActionNote(`无法创建确认卡：${(error as Error).message}`);
        }
        return;
      }
      try {
        const retryId = await enqueuePrompt(
          event.message_id,
          record.conversationKey,
          record.ownerId,
          record.prompt,
          event.event_id,
          record.attachments,
          [],
          { replyInThread: record.replyInThread },
        );
        await record.card?.addActionNote(`已创建重试任务 ${retryId}。`);
      } catch (error) {
        const message =
          error instanceof QueueCapacityError
            ? "当前会话队列已满，请稍后再试。"
            : `无法创建重试任务：${(error as Error).message}`;
        await record.card?.addActionNote(message);
      }
      return;
    }
    case "new": {
      const cancelledActive = runner.cancel(record.conversationKey);
      const cancelledQueued = queue.cancelPending(record.conversationKey);
      await closeRuntimeInteractionsForConversation(record.conversationKey);
      await state.resetThread(record.conversationKey);
      await audit(event.operator_id, "session.new", "session", record.conversationKey, "allowed");
      await record.card?.addActionNote(
        `已开启新会话；取消运行中 ${cancelledActive ? 1 : 0} 个、排队 ${cancelledQueued} 个。`,
      );
    }
  }
}

async function handleReviewCardAction(
  event: FeishuCardActionEvent,
  action: ReviewCardActionValue,
): Promise<void> {
  const task = tasks.get(action.task_id);
  if (
    !task ||
    !conversationBelongsToChat(task.conversationKey, event.chat_id) ||
    !canViewTask(config, event.operator_id, task)
  ) {
    await productReply(
      event.message_id,
      "这份审阅已过期或不属于当前聊天。请从最新任务卡重新打开。",
      replyKey(event.event_id, "review-unavailable"),
      "task-review-expired",
    );
    await audit(
      event.operator_id,
      action.action,
      "task",
      action.task_id,
      "denied",
      "task unavailable or owner mismatch",
    );
    return;
  }

  const cardRecord = reviewCards.get(event.message_id);
  if (action.action === "review_close" && task.card?.messageId === event.message_id) {
    reviewCards.delete(event.message_id);
    await task.card.restoreTaskSurface();
    await audit(event.operator_id, action.action, "task", task.id, "allowed");
    return;
  }
  if (
    cardRecord &&
    (cardRecord.taskId !== task.id ||
      !conversationBelongsToChat(cardRecord.conversationKey, event.chat_id) ||
      !canViewTask(config, event.operator_id, task))
  ) {
    await productReply(
      event.message_id,
      "这张审阅卡与任务不匹配，请从最新任务卡重新打开。",
      replyKey(event.event_id, "review-card-mismatch"),
      "task-review-invalid",
    );
    await audit(event.operator_id, action.action, "task", task.id, "denied", "card mismatch");
    return;
  }

  if (!cardRecord) {
    await replyReviewCard(
      event,
      task,
      "原审阅卡已失效，已根据当前工作区重新创建。",
      "review-recreated",
      action.page ?? 0,
      action.action === "review_file" ||
        action.action === "review_diff_page" ||
        action.action === "review_refresh"
        ? action.file_index
        : undefined,
      action.diff_page ?? 0,
    );
    await audit(event.operator_id, action.action, "task", task.id, "allowed", "recreated");
    return;
  }

  let page = cardRecord.page;
  let selectedFileIndex = cardRecord.selectedFileIndex;
  let diffPage = cardRecord.diffPage ?? 0;
  let feedback = "";
  if (action.action === "review_page") {
    page = action.page ?? page;
    selectedFileIndex = undefined;
    diffPage = 0;
  } else if (action.action === "review_file") {
    selectedFileIndex = action.file_index;
    diffPage = 0;
  } else if (action.action === "review_back") {
    page = action.page ?? page;
    selectedFileIndex = undefined;
    diffPage = 0;
  } else if (action.action === "review_diff_page") {
    diffPage = action.diff_page ?? diffPage;
  } else if (action.action === "review_refresh") {
    const selectedPath = selectedFileIndex === undefined
      ? undefined
      : task.progress.review?.files[selectedFileIndex]?.path;
    await refreshTaskReview(task);
    selectedFileIndex = selectedPath
      ? task.progress.review?.files.findIndex((file) => file.path === selectedPath)
      : undefined;
    if (selectedFileIndex !== undefined && selectedFileIndex < 0) selectedFileIndex = undefined;
    feedback = "审阅快照已刷新；若文件在任务后继续变化，会单独标记。";
  }

  if (
    selectedFileIndex !== undefined &&
    (!Number.isInteger(selectedFileIndex) ||
      selectedFileIndex < 0 ||
      selectedFileIndex >= (task.progress.review?.files.length ?? 0))
  ) {
    selectedFileIndex = undefined;
    feedback = "该文件已不在当前审阅快照中，已返回文件列表。";
  }

  const snapshot = await buildReviewCardSnapshot(
    task,
    page,
    selectedFileIndex,
    feedback,
    diffPage,
    cardRecord.embedded ?? false,
  );
  try {
    if (
      cardRecord.embedded &&
      task.card?.messageId === event.message_id &&
      task.card.cardId === cardRecord.cardId
    ) {
      const updated = await task.card.showSurface(
        renderReviewCard(snapshot),
        "review-action",
      );
      if (!updated) throw new Error("unable to update embedded review surface");
      cardRecord.sequence = task.card.sequenceNumber;
    } else {
      cardRecord.sequence += 1;
      await lark.updateCard(cardRecord.cardId, renderReviewCard(snapshot), cardRecord.sequence);
    }
    cardRecord.page = snapshot.page;
    if (snapshot.selectedFileIndex === undefined) delete cardRecord.selectedFileIndex;
    else cardRecord.selectedFileIndex = snapshot.selectedFileIndex;
    if (snapshot.diffPage === undefined) delete cardRecord.diffPage;
    else cardRecord.diffPage = snapshot.diffPage;
  } catch (error) {
    console.error(`[bridge] review card update failed task=${task.id}`, error);
    reviewCards.delete(event.message_id);
    if (cardRecord.embedded && task.card?.messageId === event.message_id) {
      await task.card.restoreTaskSurface();
    } else {
      await replyReviewCard(
        event,
        task,
        feedback || "原审阅卡更新失败，已创建新卡。",
        "review-update-fallback",
        snapshot.page,
        snapshot.selectedFileIndex,
        snapshot.diffPage ?? 0,
      );
    }
  }
  await audit(event.operator_id, action.action, "task", task.id, "allowed");
}

async function handleRunbookCardAction(
  event: FeishuCardActionEvent,
  action: RunbookCardActionValue,
): Promise<void> {
  const record = runbookCards.get(event.message_id);
  const isRun = action.action === "runbook_run";
  const authorized = record && conversationBelongsToChat(record.conversationKey, event.chat_id) &&
    (isRun
      ? event.operator_id === record.ownerId && canOperate(config, event.operator_id)
      : canViewOwnedResource(config, event.operator_id, record.ownerId));
  if (!record || !authorized) {
    await productReply(
      event.message_id,
      "这张运行手册卡已过期，或不属于你。请重新发送“运行手册”。",
      replyKey(event.event_id, "runbook-card-unavailable"),
      "runbook-unavailable",
    );
    await audit(event.operator_id, action.action, "security", event.message_id, "denied");
    return;
  }

  if (action.action === "runbook_projects") {
    await projectRegistry.refresh();
    const project = await currentProject(record.conversationKey, record.ownerId);
    await replyProjectCard(event, project, "从运行手册打开。", "runbook-projects", record);
    await updateRunbookCenterCard(event, record, "项目工作台已发送到下方。");
    return;
  }
  if (action.action === "runbook_team") {
    await replyTeamDashboard(event, "从运行手册打开。", "runbook-team", record);
    await updateRunbookCenterCard(event, record, "团队工作台已发送到下方。");
    return;
  }
  if (action.action === "runbook_refresh") {
    await updateRunbookCenterCard(event, record, "运行手册已重新校验。");
    return;
  }

  const project = await currentProject(record.conversationKey, record.ownerId);
  const catalog = await loadProjectRunbooks(project.path);
  const runbook = action.runbook_id
    ? catalog.runbooks.find((candidate) => candidate.id === action.runbook_id)
    : undefined;
  if (!runbook) {
    await updateRunbookCenterCard(
      event,
      record,
      catalog.status === "invalid"
        ? `配置未通过安全校验：${catalog.error ?? "未知错误"}`
        : "这个运行手册已经删除或改名，请刷新后重试。",
    );
    return;
  }
  try {
    const taskId = await launchRunbook(
      event.message_id,
      record.conversationKey,
      record.ownerId,
      event.event_id,
      runbook,
    );
    await updateRunbookCenterCard(
      event,
      record,
      `已创建任务 ${taskId} · ${runbook.name}。`,
    );
  } catch (error) {
    await updateRunbookCenterCard(
      event,
      record,
      `运行手册未启动：${(error as Error).message}`,
    );
  }
}

async function handleProjectCardSelection(event: FeishuCardActionEvent): Promise<void> {
  if (!canOperate(config, event.operator_id)) {
    await audit(event.operator_id, "project.switch", "project", event.option ?? "unknown", "denied");
    return;
  }
  const cardRecord = projectCards.get(event.message_id);
  if (
    cardRecord &&
    (!conversationBelongsToChat(cardRecord.conversationKey, event.chat_id) ||
      !canControlOwnedResource(config, event.operator_id, cardRecord.ownerId))
  ) {
    console.warn(`[bridge] project card chat mismatch message=${logRef(event.message_id)}`);
    await audit(event.operator_id, "project.switch", "project", event.option ?? "unknown", "denied");
    return;
  }
  if (!event.option) {
    await productReply(
      event.message_id,
      "没有识别到所选项目，请重新发送“项目”后再试。",
      replyKey(event.event_id, "project-option-missing"),
      "project-invalid",
    );
    return;
  }

  await projectRegistry.refresh();
  const selected = projectRegistry.getByPath(event.option);
  if (!selected || !canAccessProject(config, event.operator_id, selected)) {
    await productReply(
      event.message_id,
      "这个项目已不在 Codex 项目列表中，请重新发送“项目”刷新。",
      replyKey(event.event_id, "project-option-stale"),
      "project-stale",
    );
    return;
  }

  const conversationKey = cardRecord?.conversationKey ?? cardKey(event);
  const ownerId = cardRecord?.ownerId ?? event.operator_id;
  const current = await currentProject(conversationKey, ownerId);
  let feedback: string;
  const chatId = chatIdFromConversationKey(conversationKey);
  let projectChat = state.getProjectChat(chatId);
  const firstGroupBinding = state.getChatType(chatId) === "group" && !projectChat;
  let blockedByProjectChat = Boolean(projectChat && current.path !== selected.path);
  let bindingCompleted = false;
  if (firstGroupBinding && !canAdminister(config, event.operator_id)) {
    feedback = "只有 Codex 管理员可以为群聊完成第一次项目绑定。";
    blockedByProjectChat = true;
    await audit(
      event.operator_id,
      "project.chat.bind",
      "project",
      selected.path,
      "denied",
      "administrator required",
    );
  } else if (firstGroupBinding) {
    const existingProjectChat = state.getProjectChatByProject(selected.path);
    if (existingProjectChat) {
      feedback = `项目 ${selected.name} 已经绑定了项目群“${existingProjectChat.name}”，请选择其他项目。`;
      blockedByProjectChat = true;
      await audit(
        event.operator_id,
        "project.chat.bind",
        "project",
        selected.path,
        "denied",
        "project already has a chat",
      );
    } else {
      let chatName = `${selected.name} · 项目群`;
      try {
        chatName = (await lark.getChatName(chatId)) || chatName;
      } catch (error) {
        console.warn(`[bridge] unable to read existing project chat name chat=${logRef(chatId)}`, error);
      }
      try {
        projectChat = await state.upsertProjectChat({
          chatId,
          projectPath: selected.path,
          ownerId: event.operator_id,
          name: chatName,
          origin: "existing",
          membersStatus: "succeeded",
          membersFingerprint: null,
          workspaceStatus: "pending",
          pinStatus: "pending",
          messageStatus: "pending",
          workspaceCardId: null,
          workspaceMessageId: null,
          lastErrorStep: null,
          lastError: null,
          lastAttemptAt: new Date().toISOString(),
        });
        config.allowedChatIds.add(chatId);
        await state.setProject(conversationKey, selected.path);
        await state.recordProjectUse(ownerId, selected.path);
        feedback = `绑定完成：本群已永久固定到 ${selected.name}，之后不再支持切换项目。`;
        bindingCompleted = true;
        await audit(
          event.operator_id,
          "project.chat.bind",
          "project",
          selected.path,
          "allowed",
          "first and immutable binding",
        );
      } catch (error) {
        if (projectChat) {
          await state.updateProjectChatSetup(projectChat.chatId, {
            lastErrorStep: "binding",
            lastError: safeErrorText(error, 500),
            lastAttemptAt: new Date().toISOString(),
          });
          feedback = `项目绑定已保存，但群工作区初始化失败：${safeErrorText(error)}。请重新发送“项目”修复。`;
        } else {
          feedback = `绑定失败：${safeErrorText(error)}`;
        }
        blockedByProjectChat = true;
        await audit(
          event.operator_id,
          "project.chat.bind",
          "project",
          selected.path,
          "failed",
          safeErrorText(error),
        );
      }
    }
  } else if (blockedByProjectChat) {
    feedback = `本群已固定连接 ${current.name}，不能切换到其他项目。请回机器人私聊创建或打开另一个项目群。`;
    await audit(
      event.operator_id,
      "project.switch",
      "project",
      selected.path,
      "denied",
      "project chat is fixed",
    );
  } else if (current.path === selected.path) {
    feedback = `当前已经是 ${selected.name}，无需切换。`;
  } else {
    const cancelledActive = runner.cancel(conversationKey);
    const cancelledQueued = queue.cancelPending(conversationKey);
    await closeRuntimeInteractionsForConversation(conversationKey);
    const switched = await state.setProject(conversationKey, selected.path);
    await state.recordProjectUse(ownerId, selected.path);
    feedback = switchFeedback(
      selected,
      cancelledActive ? 1 : 0,
      cancelledQueued,
      switched.threadReset,
    );
  }

  console.info(
    `[bridge] selected project=${logRef(selected.path)} chat=${logRef(event.chat_id)}`,
  );
  if (!blockedByProjectChat && !firstGroupBinding) {
    await audit(event.operator_id, "project.switch", "project", selected.path, "allowed");
  }
  if (!cardRecord) {
    if (bindingCompleted && projectChat) {
      await state.updateProjectChatSetup(projectChat.chatId, {
        workspaceStatus: "failed",
        workspaceCardId: null,
        workspaceMessageId: null,
        lastErrorStep: "workspace",
        lastError: "首次绑定卡记录已过期，无法转换为项目工作台。",
        lastAttemptAt: new Date().toISOString(),
      });
    }
    await productReply(
      event.message_id,
      feedback,
      replyKey(event.event_id, "project-selected-fallback"),
      "project-switched",
    );
    return;
  }

  try {
    const displayedProject = blockedByProjectChat && !bindingCompleted ? current : selected;
    const workspace = await buildProjectWorkspace(conversationKey, ownerId, displayedProject);
    cardRecord.sequence += 1;
    await lark.updateCard(
      cardRecord.cardId,
      renderProjectCard(workspace.projects, displayedProject, feedback, workspace.context),
      cardRecord.sequence,
    );
    await state.upsertProjectCard({
      messageId: event.message_id,
      cardId: cardRecord.cardId,
      conversationKey: cardRecord.conversationKey,
      ownerId: cardRecord.ownerId,
      sequence: cardRecord.sequence,
      createdAt: cardRecord.createdAt,
    });
    if (bindingCompleted && projectChat) {
      projectChat = await state.updateProjectChatSetup(projectChat.chatId, {
        workspaceStatus: "succeeded",
        workspaceCardId: cardRecord.cardId,
        workspaceMessageId: event.message_id,
        pinStatus: "pending",
        lastErrorStep: null,
        lastError: null,
        lastAttemptAt: new Date().toISOString(),
      });
      try {
        await lark.pinMessage(event.message_id);
        await state.updateProjectChatSetup(projectChat.chatId, {
          pinStatus: "succeeded",
          lastErrorStep: null,
          lastError: null,
          lastAttemptAt: new Date().toISOString(),
        });
      } catch (error) {
        const pinError = safeErrorText(error, 500);
        await state.updateProjectChatSetup(projectChat.chatId, {
          pinStatus: "failed",
          lastErrorStep: "pin",
          lastError: pinError,
          lastAttemptAt: new Date().toISOString(),
        });
        console.warn(
          `[bridge] existing project group bound but workspace card pin failed chat=${logRef(chatId)}`,
          error,
        );
        cardRecord.sequence += 1;
        await lark.updateCard(
          cardRecord.cardId,
          renderProjectCard(
            workspace.projects,
            displayedProject,
            `${feedback} 工作台可以使用，但置顶失败；重新发送“项目”后可重试。`,
            workspace.context,
          ),
          cardRecord.sequence,
        );
        await state.upsertProjectCard({
          messageId: event.message_id,
          cardId: cardRecord.cardId,
          conversationKey: cardRecord.conversationKey,
          ownerId: cardRecord.ownerId,
          sequence: cardRecord.sequence,
          createdAt: cardRecord.createdAt,
        });
      }
    }
  } catch (error) {
    console.error(
      `[bridge] project card update failed message=${logRef(event.message_id)}`,
      error,
    );
    if (bindingCompleted && projectChat) {
      await state.updateProjectChatSetup(projectChat.chatId, {
        workspaceStatus: "failed",
        workspaceCardId: null,
        workspaceMessageId: null,
        lastErrorStep: "workspace",
        lastError: safeErrorText(error, 500),
        lastAttemptAt: new Date().toISOString(),
      });
    }
    await productReply(
      event.message_id,
      feedback,
      replyKey(event.event_id, "project-selected-update-fallback"),
      "project-switched",
    );
  }
}

async function handleProjectFavoriteToggle(event: FeishuCardActionEvent): Promise<void> {
  const cardRecord = projectCards.get(event.message_id);
  if (
    !cardRecord ||
    !conversationBelongsToChat(cardRecord.conversationKey, event.chat_id) ||
    event.operator_id !== cardRecord.ownerId
  ) {
    await audit(event.operator_id, "project.favorite", "project", "unknown", "denied");
    return;
  }
  const current = await currentProject(cardRecord.conversationKey, cardRecord.ownerId);
  if (!canAccessProject(config, cardRecord.ownerId, current)) return;
  const favorite = await state.toggleProjectFavorite(cardRecord.ownerId, current.path);
  const workspace = await buildProjectWorkspace(
    cardRecord.conversationKey,
    cardRecord.ownerId,
    current,
  );
  const feedback = favorite
    ? `已收藏 ${current.name}，它会固定在项目列表前面。`
    : `已取消收藏 ${current.name}。`;
  try {
    cardRecord.sequence += 1;
    await lark.updateCard(
      cardRecord.cardId,
      renderProjectCard(workspace.projects, current, feedback, workspace.context),
      cardRecord.sequence,
    );
    await state.upsertProjectCard({
      messageId: event.message_id,
      cardId: cardRecord.cardId,
      conversationKey: cardRecord.conversationKey,
      ownerId: cardRecord.ownerId,
      sequence: cardRecord.sequence,
      createdAt: cardRecord.createdAt,
    });
    await audit(
      event.operator_id,
      favorite ? "project.favorite" : "project.unfavorite",
      "project",
      current.path,
      "allowed",
    );
  } catch (error) {
    console.error("[bridge] project favorite card update failed", error);
    await productReply(
      event.message_id,
      feedback,
      replyKey(event.event_id, "project-favorite-fallback"),
      "project-changed",
    );
  }
}

async function handleProjectChatAction(event: FeishuCardActionEvent): Promise<void> {
  const record = projectCards.get(event.message_id);
  if (
    !record ||
    !conversationBelongsToChat(record.conversationKey, event.chat_id) ||
    !canViewOwnedResource(config, event.operator_id, record.ownerId)
  ) {
    await productReply(
      event.message_id,
      "这张项目卡已过期，或不属于你。请发送“项目”重新打开。",
      replyKey(event.event_id, "project-chat-unavailable"),
      "project-chat-unavailable",
    );
    await audit(event.operator_id, "project.chat.open", "security", event.message_id, "denied");
    return;
  }

  const project = await currentProject(record.conversationKey, record.ownerId);
  let binding = state.getProjectChatByProject(project.path);
  let feedback: string;
  try {
    if (!binding) {
      if (
        state.getChatType(event.chat_id) !== "p2p" ||
        !canControlOwnedResource(config, event.operator_id, record.ownerId)
      ) {
        feedback = "请在机器人私聊中创建项目群；这样可以确认创建者和项目归属。";
        await updateProjectCardRecord(event, record, project, feedback);
        await audit(
          event.operator_id,
          "project.chat.create",
          "project",
          project.path,
          "denied",
          "creation requires owner private chat",
        );
        return;
      }
    }
    if (binding && binding.ownerId !== event.operator_id) {
      binding = await state.updateProjectChatSetup(binding.chatId, {
        membersStatus: "pending",
        lastAttemptAt: new Date().toISOString(),
      });
    }
    const result = await provisionProjectChat(project, record.ownerId, record.conversationKey);
    binding = result.binding;
    feedback = projectChatSetupStatusText(result);
    const shared = await lark.sendSharedChat(
      event.chat_id,
      result.binding.chatId,
      replyKey(event.event_id, "project-chat-share"),
    );
    if (!shared) {
      feedback += " 项目群本身不受影响，但群入口消息发送失败；再次点击可重新发送入口。";
    }
    await audit(
      event.operator_id,
      result.created ? "project.chat.create" : "project.chat.open",
      "project",
      project.path,
      result.ready ? "allowed" : "failed",
      result.ready
        ? result.binding.chatId
        : result.issues.map((issue) => `${issue.step}: ${issue.message}`).join("; "),
    );
  } catch (error) {
    feedback = projectChatFailureMessage(error);
    await audit(
      event.operator_id,
      binding ? "project.chat.open" : "project.chat.create",
      "project",
      project.path,
      "failed",
      safeErrorText(error),
    );
  }
  await updateProjectCardRecord(event, record, project, feedback);
}

async function provisionProjectChat(
  project: CodexProject,
  ownerId: string,
  sourceConversationKey: string,
): Promise<ProjectChatSetupResult> {
  const creationKey = createHash("sha256")
    .update(`${config.instanceId}\u0000${project.path}`)
    .digest("hex")
    .slice(0, 40);
  const memberIds = teamMembers(config)
    .filter((member) => canAccessProject(config, member.id, project))
    .map((member) => member.id)
    .filter((memberId) => memberId !== ownerId);
  return projectChatService.provision({
    projectPath: project.path,
    projectName: project.name,
    ownerId,
    memberIds,
    creationKey,
    sourceConversationKey,
  });
}

async function prepareProjectChatBinding(
  binding: ProjectChatBinding,
  target: ProjectChatTarget,
): Promise<void> {
  config.allowedChatIds.add(binding.chatId);
  await state.setChatType(binding.chatId, "group");

  const groupConversationKey = config.groupSessionScope === "member"
    ? `${binding.chatId}::${target.ownerId}`
    : binding.chatId;
  await state.setProject(groupConversationKey, target.projectPath);
  const sourcePreferences = state.getPreferences(target.sourceConversationKey);
  if (sourcePreferences) {
    const { updatedAt: _updatedAt, ...preferences } = sourcePreferences;
    await state.setPreferences(groupConversationKey, preferences);
  }
  await state.recordProjectUse(target.ownerId, target.projectPath);
}

async function publishProjectChatWorkspace(
  binding: ProjectChatBinding,
  target: ProjectChatTarget,
): Promise<{ cardId: string; messageId: string }> {
  const project = projectRegistry.getByPath(target.projectPath);
  if (!project) throw new Error("项目已不在本机项目列表中，无法生成群工作台。");
  const conversationKey = config.groupSessionScope === "member"
    ? `${binding.chatId}::${target.ownerId}`
    : binding.chatId;
  const workspace = await buildProjectWorkspace(conversationKey, target.ownerId, project);
  const cardId = await lark.createCard(
    renderProjectCard(
      workspace.projects,
      project,
      "项目已固定。请直接发送一条不 @ 机器人的普通消息验证连接；若没有回复，先 @ 机器人并检查群消息权限。每个话题是一段独立 Codex 会话。",
      workspace.context,
    ),
  );
  const messageId = await lark.sendCard(
    binding.chatId,
    cardId,
    `project-chat-workspace-${logRef(binding.chatId)}`,
  );
  if (!messageId) throw new Error("飞书没有返回项目工作台消息标识。");
  const record = {
    cardId,
    conversationKey,
    ownerId: target.ownerId,
    sequence: 0,
    createdAt: Date.now(),
  };
  projectCards.set(messageId, record);
  await state.upsertProjectCard({ messageId, ...record });
  pruneProjectCards();
  return { cardId, messageId };
}

async function reconcilePersistedProjectChatSetups(): Promise<void> {
  for (const binding of state.listProjectChats()) {
    const project = projectRegistry.getByPath(binding.projectPath);
    if (!project || !canAccessProject(config, binding.ownerId, project)) continue;
    const sourceConversationKey = config.groupSessionScope === "member"
      ? `${binding.chatId}::${binding.ownerId}`
      : binding.chatId;
    try {
      const result = await provisionProjectChat(project, binding.ownerId, sourceConversationKey);
      await audit(
        binding.ownerId,
        "project.chat.reconcile",
        "project",
        binding.projectPath,
        result.ready ? "allowed" : "failed",
        result.ready
          ? "persisted project chat reconciled after restart"
          : result.issues.map((issue) => `${issue.step}: ${issue.message}`).join("; "),
      );
    } catch (error) {
      console.warn(
        `[bridge] unable to reconcile persisted project chat setup chat=${logRef(binding.chatId)}`,
        error,
      );
    }
  }
}

function projectChatResultFromBinding(binding: ProjectChatBinding): ProjectChatSetupResult {
  const issues: ProjectChatSetupResult["issues"] = [];
  const fallbackMessages = {
    members: "成员同步尚未完成。",
    workspace: "项目工作台尚未完成。",
    pin: "项目工作台尚未置顶。",
    messages: "尚未收到不 @ 机器人的普通群消息，群消息权限仍待验证。",
  } as const;
  for (const step of ["members", "workspace", "pin", "messages"] as const) {
    const status = step === "members"
      ? binding.membersStatus
      : step === "workspace"
        ? binding.workspaceStatus
        : step === "pin"
          ? binding.pinStatus
          : binding.messageStatus;
    if (status === "succeeded") continue;
    issues.push({
      step,
      message:
        binding.lastErrorStep === step && binding.lastError
          ? binding.lastError
          : fallbackMessages[step],
    });
  }
  return {
    binding,
    created: false,
    ready: isProjectChatReady(binding),
    issues,
  };
}

async function refreshProjectChatWorkspaceCard(chatId: string): Promise<void> {
  const binding = state.getProjectChat(chatId);
  if (!binding?.workspaceMessageId) return;
  const record = projectCards.get(binding.workspaceMessageId);
  if (!record) return;
  const project = projectRegistry.getByPath(binding.projectPath);
  if (!project || !canAccessProject(config, record.ownerId, project)) return;
  const workspace = await buildProjectWorkspace(
    record.conversationKey,
    record.ownerId,
    project,
  );
  const feedback = projectChatSetupStatusText(projectChatResultFromBinding(binding));
  record.sequence += 1;
  await lark.updateCard(
    record.cardId,
    renderProjectCard(workspace.projects, project, feedback, workspace.context),
    record.sequence,
  );
  await state.upsertProjectCard({
    messageId: binding.workspaceMessageId,
    cardId: record.cardId,
    conversationKey: record.conversationKey,
    ownerId: record.ownerId,
    sequence: record.sequence,
    createdAt: record.createdAt,
  });
}

function scheduleProjectChatWorkspaceRefresh(chatId: string): Promise<void> {
  const previous = projectChatCardRefreshes.get(chatId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => refreshProjectChatWorkspaceCard(chatId))
    .finally(() => {
      if (projectChatCardRefreshes.get(chatId) === next) {
        projectChatCardRefreshes.delete(chatId);
      }
    });
  projectChatCardRefreshes.set(chatId, next);
  return next;
}

async function refreshPersistedProjectChatCards(): Promise<void> {
  let refreshed = 0;
  for (const binding of state.listProjectChats()) {
    if (!binding.workspaceMessageId || !projectCards.has(binding.workspaceMessageId)) continue;
    await scheduleProjectChatWorkspaceRefresh(binding.chatId);
    refreshed += 1;
  }
  if (refreshed > 0) {
    console.info(`[bridge] refreshed ${refreshed} persisted project chat card(s)`);
  }
}

async function updateProjectCardRecord(
  event: FeishuCardActionEvent,
  record: ProjectCardRecord,
  project: CodexProject,
  feedback: string,
): Promise<void> {
  try {
    const workspace = await buildProjectWorkspace(record.conversationKey, record.ownerId, project);
    record.sequence += 1;
    await lark.updateCard(
      record.cardId,
      renderProjectCard(workspace.projects, project, feedback, workspace.context),
      record.sequence,
    );
    await state.upsertProjectCard({
      messageId: event.message_id,
      cardId: record.cardId,
      conversationKey: record.conversationKey,
      ownerId: record.ownerId,
      sequence: record.sequence,
      createdAt: record.createdAt,
    });
  } catch (error) {
    console.warn("[bridge] unable to update project chat action card", error);
    await productReply(
      event.message_id,
      feedback,
      replyKey(event.event_id, "project-chat-feedback"),
      "project-chat-feedback",
    );
  }
}

function projectChatName(projectName: string): string {
  const safeName = projectName
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48) || "Codex 项目";
  return `${safeName} · Codex`.slice(0, 60);
}

function projectChatDescription(projectName: string): string {
  const safeName = projectName
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 38) || "当前项目";
  return `固定连接本地项目 ${safeName}。每个话题对应一段独立 Codex 会话。`.slice(0, 100);
}

function projectChatFailureMessage(error: unknown): string {
  const message = safeErrorText(error);
  if (/im:chat:create|99991672|permission/i.test(message)) {
    return "项目群没有创建：飞书应用还缺少自动建群权限。请管理员为机器人开通 im:chat:create 后，在这里重试；不需要修改本地配置。";
  }
  return `项目群暂时不可用：${message}`;
}

async function handleDeviceCardAction(
  event: FeishuCardActionEvent,
  action: DeviceCardActionValue,
): Promise<void> {
  const isReadOnlyNavigation = [
    "device_refresh",
    "device_quota",
    "device_projects",
    "device_settings",
    "device_sessions",
    "device_tasks",
    "quota_refresh",
    "quota_device",
  ].includes(action.action);
  if (
    !isReadOnlyNavigation &&
    !canOperate(config, event.operator_id)
  ) {
    await audit(event.operator_id, action.action, "device", config.instanceId, "denied");
    return;
  }
  const cardRecord = deviceCards.get(event.message_id);
  if (
    cardRecord &&
    (!conversationBelongsToChat(cardRecord.conversationKey, event.chat_id) ||
      !(isReadOnlyNavigation
        ? canViewOwnedResource(config, event.operator_id, cardRecord.ownerId)
        : canControlOwnedResource(config, event.operator_id, cardRecord.ownerId)))
  ) {
    console.warn(`[bridge] device card chat mismatch message=${logRef(event.message_id)}`);
    return;
  }
  const conversationKey = cardRecord?.conversationKey ?? cardKey(event);
  const ownerId = cardRecord?.ownerId ?? event.operator_id;
  if (
    (action.action === "remote_ready_enable" || action.action === "remote_ready_disable") &&
    !canAdminister(config, event.operator_id)
  ) {
    await updateDeviceCard(event, "只有管理员可以切换整台设备的远程就绪状态。", cardRecord);
    await audit(event.operator_id, action.action, "device", config.instanceId, "denied");
    return;
  }

  let feedback = "状态已刷新。";
  switch (action.action) {
    case "device_refresh":
      break;
    case "device_quota":
    case "quota_refresh": {
      const detail = action.action === "quota_refresh" ? "额度已刷新。" : "";
      await audit(event.operator_id, action.action, "device", config.instanceId, "allowed");
      await updateQuotaCard(event, detail, cardRecord);
      return;
    }
    case "quota_device":
      await audit(event.operator_id, action.action, "device", config.instanceId, "allowed");
      await updateDeviceCard(event, "已返回设备控制台。", cardRecord);
      return;
    case "device_projects": {
      await projectRegistry.refresh();
      const project = await currentProject(conversationKey, ownerId);
      await replyProjectCard(event, project, "", "device-projects", { conversationKey, ownerId });
      feedback = "项目工作台已发送到下方。";
      break;
    }
    case "device_settings":
      await replyControlCenter(event, "", "device-settings", { conversationKey, ownerId });
      feedback = "模型与权限设置已发送到下方。";
      break;
    case "device_sessions":
      await replySessionCenter(event, "", "device-sessions", { conversationKey, ownerId });
      feedback = "历史会话已发送到下方。";
      break;
    case "device_tasks":
      await replyTaskCenter(event, "device-tasks", { conversationKey, ownerId });
      feedback = "任务中心已发送到下方。";
      break;
    case "device_new_session": {
      const cancelledActive = runner.cancel(conversationKey);
      const cancelledQueued = queue.cancelPending(conversationKey);
      await closeRuntimeInteractionsForConversation(conversationKey);
      const reset = await state.resetThread(conversationKey);
      feedback = `已开启新会话 · 旧上下文${reset ? "已清除" : "原本为空"} · 停止 ${cancelledActive ? 1 : 0} 个运行任务、${cancelledQueued} 个排队任务。`;
      break;
    }
    case "device_stop": {
      const activeTask = runner.getActiveTask(conversationKey);
      const cancelled = runner.cancel(conversationKey);
      if (activeTask && cancelled) await closeRuntimeInteractionsForTask(activeTask);
      feedback = cancelled ? `已向任务 ${activeTask ?? "当前任务"} 发送停止请求。` : "当前没有运行中的任务。";
      break;
    }
    case "device_reconnect": {
      try {
        const models = await runner.listModels();
        feedback = `Codex 已重新连接，可用模型 ${models.length} 个。`;
      } catch (error) {
        feedback = `Codex 重连失败：${error instanceof Error ? error.message : String(error)}`;
      }
      break;
    }
    case "remote_ready_enable": {
      await state.setRemoteReady(true);
      try {
        const status = await remoteReady.setEnabled(true);
        if (!status.supported) {
          await state.setRemoteReady(false);
          await remoteReady.setEnabled(false);
          feedback = "当前系统不支持 Remote Ready；这项能力仅在 macOS 上可用。";
        } else {
          feedback = status.active
            ? "远程就绪已开启；桥接服务运行期间会阻止 macOS 因空闲自动睡眠。"
            : `远程就绪未能启动：${status.lastError ?? "未知原因"}`;
        }
      } catch (error) {
        feedback = `远程就绪未能启动：${error instanceof Error ? error.message : String(error)}`;
      }
      break;
    }
    case "remote_ready_disable":
      await state.setRemoteReady(false);
      await remoteReady.setEnabled(false);
      feedback = "远程就绪已关闭；macOS 将恢复原有睡眠策略。";
      break;
  }

  await audit(event.operator_id, action.action, "device", config.instanceId, "allowed", feedback);
  await updateDeviceCard(event, feedback, cardRecord);
}

async function updateDeviceCard(
  event: FeishuCardActionEvent,
  feedback: string,
  cardRecord = deviceCards.get(event.message_id),
): Promise<void> {
  if (!cardRecord) {
    await replyDeviceCard(event, feedback, "device-recreated");
    return;
  }
  const snapshot = await buildDeviceSnapshot(
    cardRecord.conversationKey,
    cardRecord.ownerId,
    feedback,
  );
  try {
    cardRecord.sequence += 1;
    await lark.updateCard(
      cardRecord.cardId,
      renderDeviceCard(snapshot),
      cardRecord.sequence,
    );
    await state.upsertDeviceCard({
      messageId: event.message_id,
      cardId: cardRecord.cardId,
      conversationKey: cardRecord.conversationKey,
      ownerId: cardRecord.ownerId,
      sequence: cardRecord.sequence,
      createdAt: cardRecord.createdAt,
    });
  } catch (error) {
    console.error(
      `[bridge] device card update failed message=${logRef(event.message_id)}`,
      error,
    );
    deviceCards.delete(event.message_id);
    await state.removeDeviceCard(event.message_id);
    await replyDeviceCard(event, feedback, "device-update-fallback", {
      conversationKey: cardRecord.conversationKey,
      ownerId: cardRecord.ownerId,
    });
  }
}

async function updateQuotaCard(
  event: FeishuCardActionEvent,
  feedback: string,
  cardRecord = deviceCards.get(event.message_id),
): Promise<void> {
  if (!cardRecord) {
    await replyQuotaCard(event, feedback, "quota-recreated");
    return;
  }
  const quota = await readAccountQuota();
  try {
    cardRecord.sequence += 1;
    await lark.updateCard(
      cardRecord.cardId,
      renderQuotaCard({
        deviceName: hostname() || "本地设备",
        quota,
        ...(feedback ? { feedback } : {}),
      }),
      cardRecord.sequence,
    );
    await state.upsertDeviceCard({
      messageId: event.message_id,
      cardId: cardRecord.cardId,
      conversationKey: cardRecord.conversationKey,
      ownerId: cardRecord.ownerId,
      sequence: cardRecord.sequence,
      createdAt: cardRecord.createdAt,
    });
  } catch (error) {
    console.error(`[bridge] quota card update failed message=${logRef(event.message_id)}`, error);
    deviceCards.delete(event.message_id);
    await state.removeDeviceCard(event.message_id);
    await replyQuotaCard(event, feedback, "quota-update-fallback", {
      conversationKey: cardRecord.conversationKey,
      ownerId: cardRecord.ownerId,
    });
  }
}

async function handleV5CardAction(
  event: FeishuCardActionEvent,
  action: V5CardActionValue,
): Promise<void> {
  if (action.action.startsWith("home_")) {
    await handleHomeCardAction(event, action);
    return;
  }
  if (action.action.startsWith("onboarding_")) {
    await handleOnboardingCardAction(event, action);
    return;
  }
  const source = action.action.startsWith("session_") || action.action === "select_session"
    ? sessionCards
    : action.action.startsWith("tasks_")
      ? taskCenterCards
      : action.action.startsWith("team_")
        ? teamCards
      : controlCards;
  const record = source.get(event.message_id);
  const readOnlyActions = new Set<V5CardActionValue["action"]>([
    "settings_refresh",
    "settings_sessions",
    "settings_tasks",
    "session_settings",
    "session_refresh",
    "tasks_settings",
    "tasks_refresh",
    "tasks_review",
    "team_tasks",
    "team_runbooks",
    "team_projects",
    "team_refresh",
  ]);
  if (
    !record ||
    !conversationBelongsToChat(record.conversationKey, event.chat_id) ||
    !(readOnlyActions.has(action.action)
      ? canViewOwnedResource(config, event.operator_id, record.ownerId)
      : canControlOwnedResource(config, event.operator_id, record.ownerId))
  ) {
    await productReply(
      event.message_id,
      "这张控制卡已过期，或你没有权限操作它。请重新发送“设置”“会话”或“任务”。",
      replyKey(event.event_id, "v5-card-unavailable"),
      "settings-unavailable",
    );
    await audit(event.operator_id, action.action, "security", event.message_id, "denied");
    return;
  }

  switch (action.action) {
    case "lease_full_once":
    case "lease_full_30m":
    case "lease_full_session":
    case "lease_full_revoke": {
      const revoking = action.action === "lease_full_revoke";
      if (!revoking && event.operator_id !== record.ownerId) {
        await audit(
          event.operator_id,
          action.action,
          "settings",
          record.conversationKey,
          "denied",
          "full access must be self-granted",
        );
        await updateControlCard(
          event,
          record,
          "管理员可以撤销他人的临时权限，但不能代替成员授予完全访问。",
        );
        return;
      }
      if (revoking) {
        const revoked = state.revokePermissionLease(record.conversationKey);
        await audit(
          event.operator_id,
          "permission_lease.revoke",
          "settings",
          record.conversationKey,
          revoked ? "allowed" : "denied",
          revoked ? "manual revoke" : "no active lease",
        );
        await updateControlCard(
          event,
          record,
          revoked
            ? "临时完全访问已撤销；已运行任务不受影响，后续任务恢复默认权限。"
            : "当前没有可撤销的临时完全访问。",
        );
        return;
      }
      const scope: PermissionLeaseScope =
        action.action === "lease_full_once"
          ? "next-task"
          : action.action === "lease_full_session"
            ? "session"
            : "timed";
      const feedback = await grantFullAccessLease(
        record.conversationKey,
        record.ownerId,
        scope,
      );
      await updateControlCard(event, record, feedback);
      return;
    }
    case "select_model":
    case "select_effort":
    case "select_sandbox": {
      if (!event.option) {
        await updateControlCard(event, record, "没有识别到所选值，请刷新后重试。");
        return;
      }
      const kind =
        action.action === "select_model"
          ? "model"
          : action.action === "select_effort"
            ? "effort"
            : "sandbox";
      try {
        const feedback = await applySettingsChange(record.conversationKey, record.ownerId, {
          kind,
          value: event.option,
        });
        await audit(event.operator_id, action.action, "settings", record.conversationKey, "allowed");
        await updateControlCard(event, record, feedback);
      } catch (error) {
        await updateControlCard(event, record, `设置未修改：${(error as Error).message}`);
      }
      return;
    }
    case "settings_refresh":
      await updateControlCard(event, record, "设置已刷新。");
      return;
    case "settings_sessions":
      await replySessionCenter(event, "", "settings-sessions", record);
      await updateControlCard(event, record, "会话中心已发送到下方。");
      return;
    case "settings_tasks":
      await replyTaskCenter(event, "settings-tasks", record);
      await updateControlCard(event, record, "任务中心已发送到下方。");
      return;
    case "settings_new":
    case "session_new":
    case "tasks_new": {
      const active = runner.cancel(record.conversationKey);
      const queued = queue.cancelPending(record.conversationKey);
      await closeRuntimeInteractionsForConversation(record.conversationKey);
      const reset = await state.resetThread(record.conversationKey);
      const feedback = `已开启新会话 · 旧上下文${reset ? "已清除" : "原本为空"} · 停止 ${active ? 1 : 0} 个运行任务、${queued} 个排队任务。`;
      await audit(event.operator_id, "session.new", "session", record.conversationKey, "allowed");
      if (source === controlCards) await updateControlCard(event, record, feedback);
      else if (source === sessionCards) await updateSessionCard(event, record, feedback);
      else await updateTaskCenterCard(event, record);
      return;
    }
    case "select_session": {
      if (!event.option) {
        await updateSessionCard(event, record, "没有识别到所选会话，请刷新后重试。");
        return;
      }
      const project = await currentProject(record.conversationKey, record.ownerId);
      const sessions = visibleSessions(
        record.ownerId,
        project.path,
        state.getThread(record.conversationKey),
        await runner.listThreads(project.path, 50),
      );
      const selected = sessions.find((session) => session.id === event.option);
      if (!selected) {
        await updateSessionCard(event, record, "该会话已不存在，或不属于当前项目。");
        return;
      }
      if (state.getThread(record.conversationKey) === selected.id) {
        await updateSessionCard(event, record, "当前已经是这个会话，无需重复绑定。");
        return;
      }
      const handoff = assessSessionHandoff(
        runner.getActiveTask(record.conversationKey) ??
          queue.getActiveTask(record.conversationKey),
        queue.queuedForConversation(record.conversationKey),
      );
      if (handoff.blocked) {
        await audit(
          event.operator_id,
          "session.bind_local",
          "session",
          selected.id,
          "denied",
          `busy active=${handoff.active ? 1 : 0} queued=${handoff.queued}`,
        );
        await updateSessionCard(
          event,
          record,
          `当前还有${handoff.active ? "运行中的任务" : ""}${handoff.active && handoff.queued > 0 ? "和" : ""}${handoff.queued > 0 ? `${handoff.queued} 个排队任务` : ""}；请等待完成或先停止任务，再绑定其他会话。`,
        );
        return;
      }
      const alreadyOwned = state.listOwnedThreadIds(record.ownerId, project.path).has(selected.id);
      await state.setThread(record.conversationKey, selected.id);
      await state.registerThreadAccess(
        selected.id,
        record.conversationKey,
        record.ownerId,
        project.path,
      );
      await audit(
        event.operator_id,
        alreadyOwned ? "session.resume" : "session.bind_local",
        "session",
        selected.id,
        "allowed",
      );
      await updateSessionCard(
        event,
        record,
        `${alreadyOwned ? "已继续" : "已绑定本地会话"}“${selected.name || selected.preview || selected.id.slice(0, 8)}”；后续飞书消息会进入同一段 Codex 上下文。`,
      );
      return;
    }
    case "session_compact": {
      const threadId = state.getThread(record.conversationKey);
      if (!threadId) {
        await updateSessionCard(event, record, "当前没有可压缩的会话。");
        return;
      }
      await runner.compactThread(threadId);
      await audit(event.operator_id, "session.compact", "session", threadId, "allowed");
      await updateSessionCard(event, record, "当前会话已完成上下文压缩。");
      return;
    }
    case "session_settings":
      await replyControlCenter(event, "", "session-settings", record);
      await updateSessionCard(event, record, "控制中心已发送到下方。");
      return;
    case "session_open_desktop": {
      const threadId = state.getThread(record.conversationKey);
      if (!threadId) {
        await updateSessionCard(event, record, "当前还没有可在本机打开的会话。");
        return;
      }
      const handoff = assessSessionHandoff(
        runner.getActiveTask(record.conversationKey) ??
          queue.getActiveTask(record.conversationKey),
        queue.queuedForConversation(record.conversationKey),
      );
      if (handoff.blocked) {
        await audit(
          event.operator_id,
          "session.desktop_open",
          "session",
          threadId,
          "denied",
          `busy active=${handoff.active ? 1 : 0} queued=${handoff.queued}`,
        );
        await updateSessionCard(
          event,
          record,
          "为避免飞书和本机同时写入同一会话，请先等待当前任务完成并清空队列。",
        );
        return;
      }
      const project = await currentProject(record.conversationKey, record.ownerId);
      const session = (await runner.listThreads(project.path, 50)).find(
        (candidate) => candidate.id === threadId,
      );
      if (!session) {
        await audit(
          event.operator_id,
          "session.desktop_open",
          "session",
          threadId,
          "denied",
          "thread missing or project mismatch",
        );
        await updateSessionCard(
          event,
          record,
          "当前会话已不存在，或不再属于这个项目。请刷新并重新选择会话。",
        );
        return;
      }
      const result = await openCodexThreadInDesktop(threadId);
      const sessionLabel = session.name || session.preview || threadId.slice(0, 8);
      if (result.status === "opened") {
        await audit(
          event.operator_id,
          "session.desktop_open",
          "session",
          threadId,
          "allowed",
        );
        await updateSessionCard(
          event,
          record,
          `已在本机 Codex 打开“${sessionLabel}”。你可以继续原生对话；飞书卡片和按钮不会写入 Codex 历史。`,
        );
        return;
      }
      await audit(
        event.operator_id,
        "session.desktop_open",
        "session",
        threadId,
        "denied",
        `${result.status}: ${result.reason ?? "unknown"}`,
      );
      await updateSessionCard(
        event,
        record,
        `${result.status === "unsupported" ? "当前系统暂不支持自动打开" : "本机 Codex 打开失败"}。可在本机终端继续同一会话：${result.fallbackCommand}`,
      );
      return;
    }
    case "session_refresh":
      await updateSessionCard(event, record, "会话列表已刷新。");
      return;
    case "tasks_stop": {
      const active = runner.cancel(record.conversationKey);
      const queued = queue.cancelPending(record.conversationKey);
      await closeRuntimeInteractionsForConversation(record.conversationKey);
      await audit(event.operator_id, "task.cancel_all", "task", record.conversationKey, "allowed");
      await updateTaskCenterCard(event, record);
      if (!active && queued === 0) {
        await productReply(
          event.message_id,
          "当前没有属于这张卡的运行或排队任务。",
          replyKey(event.event_id, "tasks-stop-empty"),
          "task-stop-empty",
        );
      }
      return;
    }
    case "tasks_cancel_one": {
      const task = action.task_id ? tasks.get(action.task_id) : undefined;
      if (
        !task ||
        !canControlTask(config, event.operator_id, task)
      ) {
        await productReply(
          event.message_id,
          "这个任务已结束、已过期或不属于你，请刷新任务中心。",
          replyKey(event.event_id, "task-cancel-one-unavailable"),
          "task-unavailable",
        );
        return;
      }
      const queued = queue.cancelTask(task.id);
      const running =
        runner.getActiveTask(task.conversationKey) === task.id &&
        runner.cancel(task.conversationKey);
      if (running) await closeRuntimeInteractionsForTask(task.id);
      await audit(
        event.operator_id,
        "task.cancel",
        "task",
        task.id,
        queued || running ? "allowed" : "denied",
        queued ? "queued" : running ? "running" : "already finished",
      );
      await updateTaskCenterCard(event, record);
      if (!queued && !running) {
        await productReply(
          event.message_id,
          "任务已经结束，无需停止。",
          replyKey(event.event_id, "task-cancel-one-finished"),
          "task-finished",
        );
      }
      return;
    }
    case "tasks_review": {
      const task = action.task_id ? tasks.get(action.task_id) : undefined;
      if (
        !task ||
        !conversationBelongsToChat(task.conversationKey, event.chat_id) ||
        !canViewTask(config, event.operator_id, task)
      ) {
        await productReply(
          event.message_id,
          "这个任务已过期或不属于当前聊天，请刷新任务中心。",
          replyKey(event.event_id, "task-review-unavailable"),
          "task-review-unavailable",
        );
        await audit(
          event.operator_id,
          "task.review",
          "task",
          action.task_id ?? "unknown",
          "denied",
        );
        return;
      }
      await replyReviewCard(event, task, "从任务中心打开。", "task-center-review");
      await audit(event.operator_id, "task.review", "task", task.id, "allowed");
      return;
    }
    case "tasks_settings":
      await replyControlCenter(event, "", "tasks-settings", record);
      await updateTaskCenterCard(event, record);
      return;
    case "tasks_refresh":
      await updateTaskCenterCard(event, record);
      return;
    case "team_tasks":
      await replyTaskCenter(event, "team-tasks", record);
      await updateTeamDashboardCard(event, record, "任务中心已发送到下方。");
      return;
    case "team_projects": {
      await projectRegistry.refresh();
      const project = await currentProject(record.conversationKey, record.ownerId);
      await replyProjectCard(event, project, "从团队工作台打开。", "team-projects", record);
      await updateTeamDashboardCard(event, record, "项目工作台已发送到下方。");
      return;
    }
    case "team_runbooks":
      await replyRunbookCenter(event, "从团队工作台打开。", "team-runbooks", record);
      await updateTeamDashboardCard(event, record, "运行手册已发送到下方。");
      return;
    case "team_refresh":
      await updateTeamDashboardCard(event, record, "团队数据已刷新。");
      return;
  }
}

async function handleHomeCardAction(
  event: FeishuCardActionEvent,
  action: V5CardActionValue,
): Promise<void> {
  const record = homeCards.get(event.message_id);
  if (
    !record ||
    !conversationBelongsToChat(record.conversationKey, event.chat_id) ||
    !canViewOwnedResource(config, event.operator_id, record.ownerId)
  ) {
    await productReply(
      event.message_id,
      "这张首页卡已过期，或不属于你。请发送“状态”重新打开。",
      replyKey(event.event_id, "home-unavailable"),
      "home-unavailable",
    );
    await audit(event.operator_id, action.action, "security", event.message_id, "denied");
    return;
  }

  switch (action.action) {
    case "home_refresh":
      await updatePrivateHomeCard(event, record, "首页状态已刷新。");
      return;
    case "home_device":
      await replyDeviceCard(event, "", "home-device", record);
      await updatePrivateHomeCard(event, record, "设备详情已发送到下方。");
      return;
    case "home_projects": {
      try {
        await projectRegistry.refresh();
        const project = await currentProject(record.conversationKey, record.ownerId);
        await replyProjectCard(event, project, "", "home-projects", record);
        await updatePrivateHomeCard(event, record, "项目列表已发送到下方。");
      } catch (error) {
        await updatePrivateHomeCard(event, record, `项目列表不可用：${(error as Error).message}`);
      }
      return;
    }
    case "home_sessions":
      await replySessionCenter(event, "", "home-sessions", record);
      await updatePrivateHomeCard(event, record, "历史会话已发送到下方。");
      return;
    case "home_project_chat": {
      const project = await currentProject(record.conversationKey, record.ownerId);
      let binding = state.getProjectChatByProject(project.path);
      try {
        if (!binding) {
          if (!canControlOwnedResource(config, event.operator_id, record.ownerId)) {
            await updatePrivateHomeCard(event, record, "你没有权限为这个项目创建群聊。");
            return;
          }
          if (state.getChatType(event.chat_id) !== "p2p") {
            await updatePrivateHomeCard(
              event,
              record,
              "请在机器人私聊首页创建项目群；这样可以确认创建者和项目归属。",
            );
            return;
          }
        }
        if (binding && binding.ownerId !== event.operator_id) {
          binding = await state.updateProjectChatSetup(binding.chatId, {
            membersStatus: "pending",
            lastAttemptAt: new Date().toISOString(),
          });
        }
        const result = await provisionProjectChat(project, record.ownerId, record.conversationKey);
        binding = result.binding;
        const shared = await lark.sendSharedChat(
          event.chat_id,
          result.binding.chatId,
          replyKey(event.event_id, "home-project-chat-share"),
        );
        let feedback = projectChatSetupStatusText(result);
        if (!shared) {
          feedback += " 项目群本身不受影响，但入口消息发送失败；再次点击可重新发送。";
        }
        await audit(
          event.operator_id,
          result.created ? "project.chat.create" : "project.chat.open",
          "project",
          project.path,
          result.ready ? "allowed" : "failed",
          result.ready
            ? result.binding.chatId
            : result.issues.map((issue) => `${issue.step}: ${issue.message}`).join("; "),
        );
        await updatePrivateHomeCard(
          event,
          record,
          feedback,
        );
      } catch (error) {
        await updatePrivateHomeCard(event, record, projectChatFailureMessage(error));
      }
      return;
    }
    case "home_new_session": {
      if (!canControlOwnedResource(config, event.operator_id, record.ownerId)) {
        await updatePrivateHomeCard(event, record, "你没有权限重置这段会话。");
        return;
      }
      const active = runner.cancel(record.conversationKey);
      const queued = queue.cancelPending(record.conversationKey);
      await closeRuntimeInteractionsForConversation(record.conversationKey);
      const reset = await state.resetThread(record.conversationKey);
      const feedback = `新会话已准备好 · 旧上下文${reset ? "已清除" : "原本为空"}${active || queued ? ` · 已停止 ${active ? 1 : 0} 个运行任务和 ${queued} 个排队任务` : ""}`;
      await audit(event.operator_id, "session.new", "session", record.conversationKey, "allowed");
      await updatePrivateHomeCard(event, record, feedback);
      return;
    }
    case "home_first_task": {
      if (!canControlOwnedResource(config, event.operator_id, record.ownerId)) {
        await updatePrivateHomeCard(event, record, "你现在是只读成员，不能启动 Codex 任务。");
        return;
      }
      try {
        await updatePrivateHomeCard(event, record, "正在启动第一次只读任务…");
        const taskId = await startFirstSuccessTask(event, record);
        await updatePrivateHomeCard(
          event,
          record,
          `只读任务 ${taskId} 已开始。完成后，这里会自动进入正常使用状态。`,
        );
      } catch (error) {
        await updatePrivateHomeCard(
          event,
          record,
          `任务没有启动：${(error as Error).message}`,
        );
      }
      return;
    }
    default:
      return;
  }
}

async function startFirstSuccessTask(
  event: FeishuCardActionEvent,
  record: ControlCardRecord,
): Promise<string> {
  const snapshot = await buildPrivateHomeSnapshot(record.conversationKey, record.ownerId);
  if (!snapshot.availability.canExecute) {
    throw new Error(snapshot.availability.nextAction);
  }
  const stateKey = onboardingStateKey(record.conversationKey, record.ownerId);
  const onboarding = state.getOnboarding(stateKey);
  if (!onboarding || onboarding.status !== "active") {
    await state.setOnboarding(stateKey, record.ownerId, "active", 1);
  }
  return enqueuePrompt(
    event.message_id,
    record.conversationKey,
    record.ownerId,
    FIRST_SUCCESS_PROMPT,
    event.event_id,
    [],
    [],
  );
}

async function updatePrivateHomeCard(
  event: FeishuCardActionEvent,
  record: ControlCardRecord,
  feedback = "",
): Promise<void> {
  const snapshot = await buildPrivateHomeSnapshot(
    record.conversationKey,
    record.ownerId,
    feedback,
  );
  try {
    record.sequence += 1;
    await lark.updateCard(record.cardId, renderPrivateHomeCard(snapshot), record.sequence);
  } catch (error) {
    console.error("[bridge] private home card update failed", error);
    homeCards.delete(event.message_id);
    await replyPrivateHomeCard(event, feedback, "home-recreated", record);
  }
}

async function grantFullAccessLease(
  conversationKey: string,
  ownerId: string,
  scope: PermissionLeaseScope,
): Promise<string> {
  const project = await currentProject(conversationKey, ownerId);
  let projectPolicy = defaultProjectPolicy();
  try {
    projectPolicy = await loadProjectPolicy(project.path);
  } catch (error) {
    await audit(
      ownerId,
      "permission_lease.grant",
      "project",
      project.path,
      "denied",
      "invalid project policy",
    );
    return `仓库策略无效，临时完全访问没有启用：${(error as Error).message}`;
  }
  const maximumSandbox = applyProjectSandboxMaximum(
    maxSandboxForActor(ownerId),
    projectPolicy,
  );
  if (maximumSandbox !== "danger-full-access") {
    await audit(
      ownerId,
      "permission_lease.grant",
      "settings",
      conversationKey,
      "denied",
      "role or service maximum does not allow full access",
    );
    return projectPolicy.maximumSandbox
      ? "当前仓库策略不允许完全访问，设置没有修改。"
      : "当前角色或服务上限不允许完全访问，设置没有修改。";
  }
  const threadId = state.getThread(conversationKey);
  if (scope === "session" && !threadId) {
    await audit(
      ownerId,
      "permission_lease.grant",
      "settings",
      conversationKey,
      "denied",
      "no active thread",
    );
    return "当前还没有 Codex 会话；请先完成一个任务，再授权“当前会话”。";
  }
  const ttlMinutes =
    scope === "next-task"
      ? FULL_ACCESS_ONCE_TTL_MINUTES
      : scope === "session"
        ? FULL_ACCESS_SESSION_TTL_MINUTES
        : FULL_ACCESS_TIMED_TTL_MINUTES;
  const lease = await state.setPermissionLease({
    conversationKey,
    ownerId,
    projectPath: project.path,
    scope,
    remainingUses: 1,
    expiresAt: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
    ...(scope === "session" && threadId ? { threadId } : {}),
  });
  await audit(
    ownerId,
    "permission_lease.grant",
    "settings",
    conversationKey,
    "allowed",
    `${scope}:${lease.expiresAt}`,
  );
  return `临时完全访问已启用：${permissionLeaseLabel(lease)}。已运行任务不变。`;
}

async function handleOnboardingCardAction(
  event: FeishuCardActionEvent,
  action: V5CardActionValue,
): Promise<void> {
  const record = onboardingCards.get(event.message_id);
  if (
    !record ||
    !conversationBelongsToChat(record.conversationKey, event.chat_id) ||
    !canViewOwnedResource(config, event.operator_id, record.ownerId)
  ) {
    await productReply(
      event.message_id,
      "这张引导卡已过期，或不属于你。请发送“新手引导”重新打开。",
      replyKey(event.event_id, "onboarding-unavailable"),
      "onboarding-unavailable",
    );
    await audit(
      event.operator_id,
      action.action,
      "security",
      event.message_id,
      "denied",
    );
    return;
  }

  const stateKey = onboardingStateKey(record.conversationKey, record.ownerId);
  let onboarding = state.getOnboarding(stateKey);
  if (!onboarding) {
    onboarding = await state.setOnboarding(stateKey, record.ownerId, "active", 1);
  }
  let feedback = "";

  switch (action.action) {
    case "onboarding_first_task": {
      if (!canControlOwnedResource(config, event.operator_id, record.ownerId)) {
        feedback = "你现在是只读成员，不能启动 Codex 任务。";
        break;
      }
      try {
        feedback = "正在启动第一次只读任务…";
        await updateOnboardingCard(event, record, onboarding, feedback);
        const taskId = await startFirstSuccessTask(event, record);
        onboarding = state.getOnboarding(stateKey) ?? onboarding;
        feedback = onboarding.status === "completed"
          ? "第一次任务已完成，可以直接继续使用。"
          : `只读任务 ${taskId} 已开始。任务完成后，引导会自动结束。`;
      } catch (error) {
        feedback = `任务没有启动：${(error as Error).message}`;
      }
      break;
    }
    case "onboarding_home":
      await replyPrivateHomeCard(event, "", "onboarding-home", record);
      feedback = "首页已发送到下方。";
      break;
    case "onboarding_start":
      onboarding = await state.setOnboarding(stateKey, record.ownerId, "active", 1);
      feedback = "";
      break;
    case "onboarding_next":
      onboarding = await state.setOnboarding(stateKey, record.ownerId, "completed", 4);
      feedback = "";
      break;
    case "onboarding_back":
      onboarding = await state.setOnboarding(stateKey, record.ownerId, "active", 1);
      feedback = "";
      break;
    case "onboarding_finish":
      onboarding = await state.setOnboarding(stateKey, record.ownerId, "completed", 4);
      feedback = "";
      break;
    case "onboarding_dismiss":
      onboarding = await state.setOnboarding(
        stateKey,
        record.ownerId,
        "dismissed",
        onboarding.step,
      );
      feedback = "已暂停自动引导，不影响继续使用。";
      break;
    case "onboarding_restart":
      onboarding = await state.setOnboarding(stateKey, record.ownerId, "active", 1);
      feedback = "已重新开始。";
      break;
    case "onboarding_device":
      await replyDeviceCard(event, "", "onboarding-device", record);
      feedback = "";
      break;
    case "onboarding_projects": {
      try {
        await projectRegistry.refresh();
        const project = await currentProject(record.conversationKey, record.ownerId);
        await replyProjectCard(event, project, "", "onboarding-projects", record);
        feedback = "";
      } catch {
        feedback = "当前没有可选择的授权项目，请先让管理员完成项目配置。";
      }
      break;
    }
    case "onboarding_settings":
      await replyControlCenter(event, "", "onboarding-settings", record);
      feedback = "";
      break;
    case "onboarding_sessions":
      await replySessionCenter(event, "", "onboarding-sessions", record);
      feedback = "";
      break;
    case "onboarding_tasks":
      await replyTaskCenter(event, "onboarding-tasks", record);
      feedback = "";
      break;
    default:
      return;
  }

  await audit(
    event.operator_id,
    action.action,
    "onboarding",
    record.conversationKey,
    "allowed",
    `${onboarding.status}:${onboarding.step}`,
  );
  await updateOnboardingCard(event, record, onboarding, feedback);
}

async function updateOnboardingCard(
  event: FeishuCardActionEvent,
  record: ControlCardRecord,
  onboarding: OnboardingState,
  feedback = "",
): Promise<void> {
  const snapshot = await buildOnboardingSnapshot(
    onboarding,
    record.conversationKey,
    record.ownerId,
    feedback,
  );
  try {
    record.sequence += 1;
    await lark.updateCard(record.cardId, renderOnboardingCard(snapshot), record.sequence);
  } catch (error) {
    console.error("[bridge] onboarding card update failed", error);
    onboardingCards.delete(event.message_id);
    await replyOnboardingCard(event, onboarding, feedback, "onboarding-recreated", record);
  }
}

async function updateControlCard(
  event: FeishuCardActionEvent,
  record: ControlCardRecord,
  feedback = "",
): Promise<void> {
  const snapshot = await buildControlSnapshot(record.conversationKey, record.ownerId, feedback);
  try {
    record.sequence += 1;
    await lark.updateCard(record.cardId, renderControlCenterCard(snapshot), record.sequence);
  } catch (error) {
    console.error("[bridge] control card update failed", error);
    controlCards.delete(event.message_id);
    await replyControlCenter(event, feedback, "settings-recreated", record);
  }
}

async function updateSessionCard(
  event: FeishuCardActionEvent,
  record: ControlCardRecord,
  feedback = "",
): Promise<void> {
  const project = await currentProject(record.conversationKey, record.ownerId);
  const currentThreadId = state.getThread(record.conversationKey);
  const sessions = visibleSessions(
    record.ownerId,
    project.path,
    currentThreadId,
    await runner.listThreads(project.path, 50),
  ).slice(0, 50);
  const snapshot = {
    projectName: project.name,
    sessions,
    ...(currentThreadId ? { currentThreadId } : {}),
    ...(feedback ? { feedback } : {}),
  };
  try {
    record.sequence += 1;
    await lark.updateCard(record.cardId, renderSessionCenterCard(snapshot), record.sequence);
  } catch (error) {
    console.error("[bridge] session card update failed", error);
    sessionCards.delete(event.message_id);
    await replySessionCenter(event, feedback, "sessions-recreated", record);
  }
}

async function updateTaskCenterCard(
  event: FeishuCardActionEvent,
  record: ControlCardRecord,
): Promise<void> {
  const project = await currentProject(record.conversationKey, record.ownerId);
  const snapshot = buildTaskCenterSnapshot(record.ownerId, project);
  try {
    record.sequence += 1;
    await lark.updateCard(
      record.cardId,
      renderTaskCenterCard(snapshot),
      record.sequence,
    );
  } catch (error) {
    console.error("[bridge] task center card update failed", error);
    taskCenterCards.delete(event.message_id);
    await replyTaskCenter(event, "tasks-recreated", record);
  }
}

async function updateTeamDashboardCard(
  event: FeishuCardActionEvent,
  record: ControlCardRecord,
  feedback = "",
): Promise<void> {
  const snapshot = buildTeamDashboardSnapshot(record.ownerId, feedback);
  try {
    record.sequence += 1;
    await lark.updateCard(
      record.cardId,
      renderTeamDashboardCard(snapshot),
      record.sequence,
    );
  } catch (error) {
    console.error("[bridge] team dashboard card update failed", error);
    teamCards.delete(event.message_id);
    await replyTeamDashboard(event, feedback, "team-recreated", record);
  }
}

async function updateRunbookCenterCard(
  event: FeishuCardActionEvent,
  record: ControlCardRecord,
  feedback = "",
): Promise<void> {
  const project = await currentProject(record.conversationKey, record.ownerId);
  const snapshot: RunbookCenterSnapshot = {
    projectName: project.name,
    catalog: await loadProjectRunbooks(project.path),
    canOperate: canOperate(config, record.ownerId),
    ...(feedback ? { feedback } : {}),
  };
  try {
    record.sequence += 1;
    await lark.updateCard(
      record.cardId,
      renderRunbookCenterCard(snapshot),
      record.sequence,
    );
  } catch (error) {
    console.error("[bridge] runbook center card update failed", error);
    runbookCards.delete(event.message_id);
    await replyRunbookCenter(event, feedback, "runbooks-recreated", record);
  }
}

async function requestRuntimeApproval(
  record: TaskRecord,
  request: CodexApprovalRequest,
): Promise<CodexApprovalDecision> {
  const requestId = runtimeInteractionId("approval", record.id, request.id);
  const replyToMessageId =
    record.card?.messageId || record.conversation?.messageId || record.replyToMessageId;
  try {
    const cardId = await lark.createCard(
      renderRuntimeApprovalCard(
        requestId,
        request,
        record.project.name,
        "pending",
        config.confirmationTtlMinutes,
      ),
    );
    const messageId = await lark.replyCard(
      replyToMessageId,
      cardId,
      replyKey(record.seed, `runtime-approval-${requestId}`),
    );
    if (!messageId) throw new Error("飞书没有返回运行时确认卡消息 ID");
    await taskLiveSession(record)?.addActionNote("Codex 正在等待你的运行时权限确认。");
    return await new Promise<CodexApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        const pending = pendingRuntimeApprovals.get(requestId);
        if (pending) void resolveRuntimeApproval(pending, "decline", "expired");
      }, config.confirmationTtlMinutes * 60_000);
      timer.unref();
      pendingRuntimeApprovals.set(requestId, {
        id: requestId,
        taskId: record.id,
        conversationKey: record.conversationKey,
        request,
        projectLabel: record.project.name,
        cardId,
        messageId,
        sequence: 0,
        timer,
        resolve,
      });
    });
  } catch (error) {
    console.error(`[bridge] unable to create runtime approval task=${record.id}`, error);
    await taskLiveSession(record)?.addActionNote(
      "运行时确认卡创建失败，本次权限请求已安全拒绝。",
    );
    return "decline";
  }
}

async function requestRuntimeUserInput(
  record: TaskRecord,
  request: CodexQuestionRequest,
): Promise<Record<string, string[]>> {
  const answers: Record<string, string[]> = {};
  for (let index = 0; index < request.questions.length; index += 1) {
    const question = request.questions[index];
    if (!question) continue;
    answers[question.id] = await requestSingleRuntimeQuestion(
      record,
      request,
      question,
      { index: index + 1, total: request.questions.length },
    );
  }
  return answers;
}

async function requestSingleRuntimeQuestion(
  record: TaskRecord,
  request: CodexQuestionRequest,
  question: CodexQuestion,
  position: { index: number; total: number },
): Promise<string[]> {
  const requestId = runtimeInteractionId(
    "question",
    record.id,
    `${request.id}-${question.id}-${position.index}`,
  );
  const replyToMessageId =
    record.card?.messageId || record.conversation?.messageId || record.replyToMessageId;
  const previousId = pendingQuestionByConversation.get(record.conversationKey);
  const previous = previousId ? pendingRuntimeQuestions.get(previousId) : undefined;
  if (previous) await resolveRuntimeQuestion(previous, "", "expired");
  const requestedTimeout = request.autoResolutionMs ?? config.confirmationTtlMinutes * 60_000;
  const timeoutMs = Math.max(
    1_000,
    Math.min(requestedTimeout, config.confirmationTtlMinutes * 60_000),
  );
  const ttlMinutes = Math.max(1, Math.ceil(timeoutMs / 60_000));

  try {
    const cardId = await lark.createCard(
      renderRuntimeQuestionCard(requestId, question, position, "pending", "", ttlMinutes),
    );
    const messageId = await lark.replyCard(
      replyToMessageId,
      cardId,
      replyKey(record.seed, `runtime-question-${requestId}`),
    );
    if (!messageId) throw new Error("飞书没有返回实时追问卡消息 ID");
    await taskLiveSession(record)?.addActionNote(
      `Codex 正在等待你的回答：${question.header}`,
    );
    return await new Promise<string[]>((resolve) => {
      const timer = setTimeout(() => {
        const pending = pendingRuntimeQuestions.get(requestId);
        if (pending) void resolveRuntimeQuestion(pending, "", "expired");
      }, timeoutMs);
      timer.unref();
      pendingRuntimeQuestions.set(requestId, {
        id: requestId,
        taskId: record.id,
        conversationKey: record.conversationKey,
        question,
        position,
        ttlMinutes,
        cardId,
        messageId,
        sequence: 0,
        timer,
        resolve,
      });
      pendingQuestionByConversation.set(record.conversationKey, requestId);
    });
  } catch (error) {
    console.error(`[bridge] unable to create runtime question task=${record.id}`, error);
    await taskLiveSession(record)?.addActionNote(
      "实时追问卡创建失败，Codex 将在没有回答的情况下继续。",
    );
    return [];
  }
}

async function handleRuntimeCardAction(
  event: FeishuCardActionEvent,
  action: RuntimeCardActionValue,
): Promise<void> {
  if (
    action.action === "answer_runtime" ||
    action.action === "cancel_runtime_question"
  ) {
    const pending = pendingRuntimeQuestions.get(action.request_id);
    const task = pending ? tasks.get(pending.taskId) : undefined;
    if (
      !pending ||
      !task ||
      !conversationBelongsToChat(pending.conversationKey, event.chat_id) ||
      !canControlTask(config, event.operator_id, task)
    ) {
      await audit(
        event.operator_id,
        `runtime.question.${action.action}`,
        "task",
        pending?.taskId ?? action.request_id,
        "denied",
        pending ? "owner or chat mismatch" : "request unavailable",
      );
      await productReply(
        event.message_id,
        "这个问题已经回答或失效。发送“任务”打开任务中心，查看最新状态。",
        replyKey(event.event_id, "runtime-question-unavailable"),
        "task-question-unavailable",
      );
      return;
    }
    if (action.question_id && action.question_id !== pending.question.id) {
      await audit(
        event.operator_id,
        "runtime.question.answer",
        "task",
        pending.taskId,
        "denied",
        "question id mismatch",
      );
      await productReply(
        event.message_id,
        "答案没有提交：问题标识不匹配。请使用最新的问题卡。",
        replyKey(event.event_id, "runtime-question-mismatch"),
        "task-question-invalid",
      );
      return;
    }
    if (action.action === "cancel_runtime_question") {
      await resolveRuntimeQuestion(pending, "", "cancelled", event.operator_id);
      return;
    }
    if (pending.question.isSecret) {
      await productReply(
        event.message_id,
        "敏感问题不能通过飞书回答。请回本机处理，或点击“取消回答”。",
        replyKey(event.event_id, "secret-card-answer-blocked"),
        "security-secret-denied",
      );
      return;
    }
    const answer = action.answer || event.option || "";
    if (!answer) {
      await productReply(
        event.message_id,
        "没有收到有效答案，问题仍在等待处理。请重新选择或直接发送下一条消息。",
        replyKey(event.event_id, "runtime-question-empty"),
        "task-question-waiting",
      );
      return;
    }
    await resolveRuntimeQuestion(
      pending,
      answer,
      "answered",
      event.operator_id,
    );
    return;
  }

  const pending = pendingRuntimeApprovals.get(action.request_id);
  const task = pending ? tasks.get(pending.taskId) : undefined;
  if (
    !pending ||
    !task ||
    !conversationBelongsToChat(pending.conversationKey, event.chat_id) ||
    !canControlTask(config, event.operator_id, task)
  ) {
    await audit(
      event.operator_id,
      `runtime.approval.${action.action}`,
      "task",
      pending?.taskId ?? action.request_id,
      "denied",
      pending ? "owner or chat mismatch" : "request unavailable",
    );
    await productReply(
      event.message_id,
      "这个权限请求已经处理或失效。发送“任务”打开任务中心，查看最新状态。",
      replyKey(event.event_id, "runtime-approval-unavailable"),
      "permission-unavailable",
    );
    return;
  }
  if (action.action === "approve_runtime_once") {
    await resolveRuntimeApproval(pending, "accept", "accepted", event.operator_id);
  } else if (action.action === "approve_runtime_session") {
    await resolveRuntimeApproval(
      pending,
      "acceptForSession",
      "session",
      event.operator_id,
    );
  } else {
    await resolveRuntimeApproval(pending, "decline", "declined", event.operator_id);
  }
}

async function resolveRuntimeApproval(
  pending: PendingRuntimeApproval,
  decision: CodexApprovalDecision,
  stateName: RuntimeApprovalState,
  actorId?: string,
): Promise<void> {
  if (!pendingRuntimeApprovals.delete(pending.id)) return;
  clearTimeout(pending.timer);
  pending.resolve(decision);
  try {
    pending.sequence += 1;
    await lark.updateCard(
      pending.cardId,
      renderRuntimeApprovalCard(
        pending.id,
        pending.request,
        pending.projectLabel,
        stateName,
        config.confirmationTtlMinutes,
      ),
      pending.sequence,
    );
  } catch (error) {
    console.error(`[bridge] runtime approval card update failed id=${pending.id}`, error);
  }
  const task = tasks.get(pending.taskId);
  await audit(
    actorId ?? task?.ownerId ?? "system",
    `runtime.approval.${stateName}`,
    "task",
    pending.taskId,
    stateName === "expired" ? "failed" : "allowed",
    `${pending.request.kind}:${decision}`,
  ).catch((error) => {
    console.error(`[bridge] unable to audit runtime approval id=${pending.id}`, error);
  });
}

async function resolveRuntimeQuestion(
  pending: PendingRuntimeQuestion,
  answer: string,
  stateName: "answered" | "cancelled" | "expired",
  actorId?: string,
): Promise<void> {
  if (!pendingRuntimeQuestions.delete(pending.id)) return;
  clearTimeout(pending.timer);
  if (pendingQuestionByConversation.get(pending.conversationKey) === pending.id) {
    pendingQuestionByConversation.delete(pending.conversationKey);
  }
  pending.resolve(answer ? [answer] : []);
  try {
    pending.sequence += 1;
    await lark.updateCard(
      pending.cardId,
      renderRuntimeQuestionCard(
        pending.id,
        pending.question,
        pending.position,
        stateName,
        answer,
        pending.ttlMinutes,
      ),
      pending.sequence,
    );
  } catch (error) {
    console.error(`[bridge] runtime question card update failed id=${pending.id}`, error);
  }
  const task = tasks.get(pending.taskId);
  await audit(
    actorId ?? task?.ownerId ?? "system",
    `runtime.question.${stateName}`,
    "task",
    pending.taskId,
    stateName === "expired" ? "failed" : "allowed",
    pending.question.id,
  ).catch((error) => {
    console.error(`[bridge] unable to audit runtime question id=${pending.id}`, error);
  });
}

async function closeRuntimeInteractionsForTask(taskId: string): Promise<void> {
  const task = tasks.get(taskId);
  if (task) task.allowThreadBinding = false;
  const approvals = [...pendingRuntimeApprovals.values()].filter(
    (pending) => pending.taskId === taskId,
  );
  const questions = [...pendingRuntimeQuestions.values()].filter(
    (pending) => pending.taskId === taskId,
  );
  await Promise.all([
    ...approvals.map((pending) => resolveRuntimeApproval(pending, "decline", "expired")),
    ...questions.map((pending) => resolveRuntimeQuestion(pending, "", "expired")),
  ]);
}

async function closeRuntimeInteractionsForConversation(conversationKey: string): Promise<void> {
  for (const task of tasks.values()) {
    if (task.conversationKey === conversationKey) task.allowThreadBinding = false;
  }
  const taskIds = new Set([
    ...[...pendingRuntimeApprovals.values()]
      .filter((pending) => pending.conversationKey === conversationKey)
      .map((pending) => pending.taskId),
    ...[...pendingRuntimeQuestions.values()]
      .filter((pending) => pending.conversationKey === conversationKey)
      .map((pending) => pending.taskId),
  ]);
  await Promise.all([...taskIds].map((taskId) => closeRuntimeInteractionsForTask(taskId)));
}

function runtimeInteractionId(kind: string, taskId: string, requestId: string): string {
  return `${kind}-${taskId}-${requestId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

async function requestExternalConfirmation(
  event: FeishuMessageEvent,
  prompt: string,
  actions: ExternalAction[],
  workspaceSession = workspaceSessionForEvent(event, config),
): Promise<void> {
  try {
    await createExternalConfirmation(
      event.message_id,
      workspaceSession.conversationKey,
      event.sender_id,
      prompt,
      actions,
      event.event_id,
      [],
      workspaceSession.replyInThread,
    );
  } catch (error) {
    if (!(error instanceof ProjectPolicyError)) throw error;
    await audit(
      event.sender_id,
      "project_policy.external_action",
      "project",
      (await currentProject(workspaceSession.conversationKey, event.sender_id)).path,
      "denied",
      error.message,
    );
    await reply(event, `任务没有执行：${error.message}。`, "project-policy-denied");
  }
}

async function createExternalConfirmation(
  replyToMessageId: string,
  conversationKey: string,
  ownerId: string,
  prompt: string,
  actions: ExternalAction[],
  seed: string,
  attachments: TaskAttachment[] = [],
  replyInThread = false,
): Promise<void> {
  const existing = [...pendingConfirmations.values()].find(
    (confirmation) =>
      confirmation.seed === seed &&
      confirmation.conversationKey === conversationKey &&
      Date.parse(confirmation.expiresAt) > Date.now(),
  );
  if (existing) return;
  const project = await currentProject(conversationKey, ownerId);
  const projectPolicy = await loadProjectPolicy(project.path);
  const actionDecision = decideProjectActions(projectPolicy, actions);
  if (actionDecision.blockedActions.length > 0) {
    throw new ProjectPolicyError(
      `当前仓库策略禁止：${actionDecision.blockedActions.map(externalActionLabel).join("、")}`,
    );
  }
  const requestId = `confirm-${makeTaskId(seed)}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + config.confirmationTtlMinutes * 60_000,
  ).toISOString();
  const cardId = await lark.createCard(
    renderExternalConfirmationCard(
      requestId,
      prompt,
      project.name,
      actions,
      "pending",
      config.confirmationTtlMinutes,
    ),
  );
  const messageId = await lark.replyCard(
    replyToMessageId,
    cardId,
    replyKey(seed, "external-confirmation"),
    replyInThread,
  );
  if (!messageId) throw new Error("飞书没有返回确认卡消息 ID");
  const pending: PendingConfirmation = {
    id: requestId,
    seed,
    conversationKey,
    ownerId,
    prompt,
    project,
    actions,
    attachments,
    cardId,
    messageId,
    sequence: 0,
    ...(replyInThread ? { replyInThread: true } : {}),
    createdAt,
    expiresAt,
  };
  pendingConfirmations.set(requestId, pending);
  await state.upsertConfirmation(pending);
  while (pendingConfirmations.size > 50) {
    const oldest = pendingConfirmations.keys().next().value as string | undefined;
    if (!oldest) break;
    pendingConfirmations.delete(oldest);
    await state.removeConfirmation(oldest);
  }
}

async function handleExternalConfirmation(
  event: FeishuCardActionEvent,
  action: ConfirmationCardActionValue,
): Promise<void> {
  const pending = pendingConfirmations.get(action.request_id);
  if (
    !pending ||
    !conversationBelongsToChat(pending.conversationKey, event.chat_id) ||
    !canControlOwnedResource(config, event.operator_id, pending.ownerId)
  ) {
    await productReply(
      event.message_id,
      "这张确认卡已失效，请重新发送原任务。",
      replyKey(event.event_id, "confirmation-expired"),
      "task-confirmation-expired",
    );
    return;
  }
  if (Date.parse(pending.expiresAt) <= Date.now()) {
    pendingConfirmations.delete(action.request_id);
    await state.removeConfirmation(action.request_id);
    await updateConfirmationCard(pending, "expired", event.event_id);
    return;
  }

  if (action.action === "approve_external") {
    const project = await currentProject(pending.conversationKey, pending.ownerId);
    if (project.path !== pending.project.path) {
      await productReply(
        event.message_id,
        `当前项目已切换为 ${project.name}，为避免误操作，本次确认未执行。请在新项目中重新发送任务。`,
        replyKey(event.event_id, "confirmation-project-changed"),
        "project-confirmation-changed",
      );
      pendingConfirmations.delete(action.request_id);
      await state.removeConfirmation(action.request_id);
      return;
    }
    try {
      await enqueuePrompt(
        event.message_id,
        pending.conversationKey,
        pending.ownerId,
        pending.prompt,
        event.event_id,
        pending.attachments,
        pending.actions,
        { replyInThread: pending.replyInThread ?? false },
      );
    } catch (error) {
      if (error instanceof QueueCapacityError) {
        await productReply(
          event.message_id,
          "当前会话队列已满；确认仍然有效，请稍后再次点击“确认并执行”。",
          replyKey(event.event_id, "confirmation-queue-full"),
          "task-queue-full",
        );
        return;
      }
      throw error;
    }
    pendingConfirmations.delete(action.request_id);
    await state.removeConfirmation(action.request_id);
    await updateConfirmationCard(pending, "approved", event.event_id);
    return;
  }

  pendingConfirmations.delete(action.request_id);
  await state.removeConfirmation(action.request_id);
  await updateConfirmationCard(pending, "rejected", event.event_id);
}

async function updateConfirmationCard(
  pending: PendingConfirmation,
  stateName: "approved" | "rejected" | "expired",
  eventId: string,
): Promise<void> {
  try {
    pending.sequence += 1;
    await lark.updateCard(
      pending.cardId,
      renderExternalConfirmationCard(
        pending.id,
        pending.prompt,
        pending.project.name,
        pending.actions,
        stateName,
        config.confirmationTtlMinutes,
      ),
      pending.sequence,
    );
  } catch (error) {
    console.error(`[bridge] confirmation card update failed id=${pending.id}`, error);
    await productReply(
      pending.messageId,
      stateName === "approved"
        ? "已确认，任务已进入执行队列。"
        : stateName === "expired"
          ? "确认已过期，请重新发送原任务。"
          : "已取消，本次任务未执行。",
      replyKey(eventId, `confirmation-${stateName}-fallback`),
      `task-confirmation-${stateName}`,
    );
  }
}

async function prepareAttachments(event: FeishuMessageEvent): Promise<TaskAttachment[]> {
  const resources = await lark.downloadMessageResources(event.message_id);
  const attachments: TaskAttachment[] = [];
  for (const resource of resources) {
    if (resource.sizeBytes > config.maxAttachmentBytes) {
      console.warn(
        `[bridge] ignored oversized attachment key=${logRef(resource.key)} bytes=${resource.sizeBytes}`,
      );
      continue;
    }
    const name = basename(resource.localPath);
    if (resource.type === "image") {
      if (!(await isSupportedImageFile(resource.localPath))) {
        console.warn(
          `[bridge] ignored invalid image attachment key=${logRef(resource.key)}`,
        );
        continue;
      }
      attachments.push({
        kind: "image",
        path: resource.localPath,
        name,
        sizeBytes: resource.sizeBytes,
      });
      continue;
    }
    const extension = extname(resource.localPath).toLocaleLowerCase();
    if (
      !TEXT_ATTACHMENT_EXTENSIONS.has(extension) ||
      resource.sizeBytes > config.maxTextAttachmentBytes
    ) {
      continue;
    }
    if (!(await isUtf8TextFile(resource.localPath))) continue;
    attachments.push({
      kind: "text",
      path: resource.localPath,
      name,
      sizeBytes: resource.sizeBytes,
    });
  }
  return attachments;
}

function attachmentPrompt(event: FeishuMessageEvent, attachments: TaskAttachment[]): string {
  const imageCount = attachments.filter((attachment) => attachment.kind === "image").length;
  const textCount = attachments.length - imageCount;
  const kinds = [
    imageCount > 0 ? `${imageCount} 张图片` : "",
    textCount > 0 ? `${textCount} 个文本文件` : "",
  ].filter(Boolean);
  return [
    `用户通过飞书发送了${kinds.join("和")}。`,
    "请读取附件，结合当前项目完成其中明确表达的任务。",
    "如果附件没有表达明确任务，先概括你看到的关键信息，并提出一个最关键的下一步问题。",
    event.content && !/^\[?(?:image|file|audio|media|video)\]?$/i.test(event.content.trim())
      ? `飞书消息说明：${event.content.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function replyQueueOrError(
  event: FeishuMessageEvent,
  error: unknown,
  phase: string,
): Promise<void> {
  if (error instanceof QueueCapacityError) {
    await reply(
      event,
      `当前会话已有 ${config.maxQueuedPerConversation} 个任务在排队，请等一个任务完成或发送“取消”后再试。`,
      `${phase}-queue-full`,
    );
    return;
  }
  if (error instanceof ProjectPolicyError) {
    await reply(
      event,
      `任务没有执行：${error.message}。请由仓库维护者检查 .feishu-codex-policy.json。`,
      `${phase}-project-policy`,
    );
    return;
  }
  console.error(`[bridge] unable to accept ${phase} task`, error);
  await reply(
    event,
    "任务暂时未能进入队列，请检查服务状态后重试。外部动作没有被执行。",
    `${phase}-accept-failed`,
  );
}

function permissionLabel(mode: SandboxMode): string {
  if (mode === "danger-full-access") return "完全访问";
  if (mode === "read-only") return "只读";
  return "工作区写入";
}

function maxSandboxForActor(actorId: string): SandboxMode {
  if (canAdminister(config, actorId)) return config.sandboxMode;
  if (canOperate(config, actorId)) return config.operatorSandboxMode;
  return "read-only";
}

function visibleSessions(
  ownerId: string,
  projectPath: string,
  currentThreadId: string | undefined,
  sessions: CodexThreadSummary[],
): SessionCenterItem[] {
  let visible = sessions;
  if (!canAdminister(config, ownerId)) {
    const owned = state.listOwnedThreadIds(ownerId, projectPath);
    if (currentThreadId) owned.add(currentThreadId);
    visible = sessions.filter((session) => owned.has(session.id));
  }
  return visible.map((session) => {
    const latestTask = [...tasks.values()]
      .filter(
        (task) =>
          task.project.path === projectPath &&
          task.progress.threadId === session.id &&
          (canAdminister(config, ownerId) || task.ownerId === ownerId),
      )
      .sort((left, right) => right.progress.createdAt - left.progress.createdAt)[0];
    const userPreview = latestTask?.prompt;
    const preview = redactSensitiveText(
      sanitizeSessionPreview(userPreview || session.preview),
      240,
    );
    const name = latestTask
      ? sessionNameFromPrompt(latestTask.prompt, latestTask.project.name)
      : session.name
        ? redactSensitiveText(sanitizeSessionPreview(session.name), 120)
        : null;
    const latestFeishuActivityAt = latestTask
      ? latestTask.progress.finishedAt ??
        latestTask.progress.startedAt ??
        latestTask.progress.createdAt
      : undefined;
    const activity = deriveThreadActivity({
      threadUpdatedAt: session.updatedAt,
      ...(latestFeishuActivityAt === undefined ? {} : { latestFeishuActivityAt }),
    });
    return {
      ...session,
      name,
      preview,
      activitySource: activity.source,
      activityAt: activity.activityAt,
    };
  });
}

function executionSettings(conversationKey: string, actorId: string): TaskExecutionSettings {
  const preferences = state.getPreferences(conversationKey);
  const maximum = maxSandboxForActor(actorId);
  const requested = preferences?.sandboxMode;
  const sandboxMode = persistentSandboxMode(requested, maximum);
  const selectedModel = resolveModelPreference(preferences?.model, config.model);
  return {
    sandboxMode,
    ...(selectedModel ? { model: selectedModel } : {}),
    ...(preferences?.reasoningEffort ?? config.reasoningEffort
      ? { reasoningEffort: preferences?.reasoningEffort ?? config.reasoningEffort }
      : {}),
  };
}

async function applySettingsChange(
  conversationKey: string,
  actorId: string,
  change: SettingsChange,
): Promise<string> {
  const current = state.getPreferences(conversationKey);
  const next: Omit<ConversationPreferences, "updatedAt"> = {};
  if (current?.model) next.model = current.model;
  if (current?.reasoningEffort) next.reasoningEffort = current.reasoningEffort;
  if (current?.sandboxMode && current.sandboxMode !== "danger-full-access") {
    next.sandboxMode = current.sandboxMode;
  }

  if (change.kind === "model") {
    const models = await runner.listModels();
    const normalized = change.value.trim().toLocaleLowerCase();
    if (["__default__", "默认", "default", "auto", "自动"].includes(normalized)) {
      // Keep an explicit sentinel so a conversation can override a globally pinned model.
      next.model = "__default__";
      await state.setPreferences(conversationKey, next);
      await audit(actorId, "settings.model", "settings", conversationKey, "allowed", "default");
      return "已恢复 Codex 默认模型；下一轮生效。";
    }
    const matches = models.filter(
      (model) =>
        model.model.toLocaleLowerCase() === normalized ||
        model.id.toLocaleLowerCase() === normalized ||
        model.displayName.toLocaleLowerCase() === normalized,
    );
    const fuzzy =
      matches.length > 0
        ? matches
        : models.filter(
            (model) =>
              model.model.toLocaleLowerCase().includes(normalized) ||
              model.displayName.toLocaleLowerCase().includes(normalized),
          );
    if (fuzzy.length !== 1 || !fuzzy[0]) {
      throw new Error(
        fuzzy.length > 1
          ? `“${change.value}”匹配到多个模型，请使用完整模型名。`
          : `没有找到模型“${change.value}”。`,
      );
    }
    next.model = fuzzy[0].model;
    if (
      next.reasoningEffort &&
      !fuzzy[0].supportedReasoningEfforts.includes(next.reasoningEffort)
    ) {
      next.reasoningEffort = fuzzy[0].defaultReasoningEffort;
    }
    await state.setPreferences(conversationKey, next);
    await audit(actorId, "settings.model", "settings", conversationKey, "allowed", next.model);
    return `模型已切换为 ${fuzzy[0].displayName}；下一轮生效。`;
  }

  if (change.kind === "effort") {
    const effort = normalizeEffort(change.value);
    if (!effort) throw new Error("推理强度支持最低、轻度、中、高、极高或最高。");
    const models = await runner.listModels();
    const effective = executionSettings(conversationKey, actorId);
    const model =
      models.find((candidate) => candidate.model === effective.model) ??
      models.find((candidate) => candidate.isDefault);
    if (model && !model.supportedReasoningEfforts.includes(effort)) {
      throw new Error(`${model.displayName} 不支持“${reasoningEffortLabel(effort)}”推理强度。`);
    }
    next.reasoningEffort = effort;
    await state.setPreferences(conversationKey, next);
    await audit(actorId, "settings.effort", "settings", conversationKey, "allowed", effort);
    return `推理强度已切换为“${reasoningEffortLabel(effort)}”；下一轮生效。`;
  }

  const sandbox = normalizeSandboxMode(change.value);
  if (!sandbox) throw new Error("权限支持只读、工作区写入、完全访问。 ");
  const maximum = maxSandboxForActor(actorId);
  if (!isSandboxModeAllowed(sandbox, maximum)) {
    throw new Error(`你的角色最高只能使用“${permissionLabel(maximum)}”。`);
  }
  if (sandbox === "danger-full-access") {
    await audit(
      actorId,
      "settings.sandbox.persistent_full_access",
      "settings",
      conversationKey,
      "denied",
      "temporary lease required",
    );
    return "完全访问不会永久保存。请在下方选择“下一任务”“30 分钟”或“当前会话”临时授权。";
  }
  next.sandboxMode = sandbox;
  await state.setPreferences(conversationKey, next);
  await audit(actorId, "settings.sandbox", "settings", conversationKey, "allowed", sandbox);
  return `任务权限已切换为${permissionLabel(sandbox)}；下一轮生效。`;
}

function normalizeEffort(value: string): ReasoningEffort | null {
  const normalized = value.trim().toLocaleLowerCase();
  const aliases: Record<string, ReasoningEffort> = {
    "最低": "minimal",
    "极快": "minimal",
    "轻度": "low",
    "快速": "low",
    "中": "medium",
    "均衡": "medium",
    "高": "high",
    "深入": "high",
    "极高": "xhigh",
    "极深": "xhigh",
    "最高": "ultra",
    "自主": "ultra",
    "自主协作": "ultra",
  };
  const candidate = aliases[normalized] ?? normalized;
  return ["minimal", "low", "medium", "high", "xhigh", "ultra"].includes(candidate)
    ? (candidate as ReasoningEffort)
    : null;
}

function normalizeSandboxMode(value: string): SandboxMode | null {
  const normalized = value.trim().toLocaleLowerCase();
  if (["只读", "read-only", "readonly", "read"].includes(normalized)) return "read-only";
  if (["工作区", "工作区写入", "workspace-write", "write"].includes(normalized)) {
    return "workspace-write";
  }
  if (["完全访问", "full", "danger-full-access", "danger"].includes(normalized)) {
    return "danger-full-access";
  }
  return null;
}

async function requireOperator(event: FeishuMessageEvent, action: string): Promise<boolean> {
  if (canOperate(config, event.sender_id)) return true;
  await audit(event.sender_id, action, "security", key(event), "denied", "viewer role");
  await reply(
    event,
    "你的团队角色是只读成员，可以查看状态、项目、会话和任务，但不能执行或修改代码。请联系管理员调整角色。",
    `viewer-denied-${action}`,
  );
  return false;
}

async function audit(
  actorId: string,
  action: string,
  resourceType: AuditEvent["resourceType"],
  resourceId: string,
  outcome: AuditEvent["outcome"],
  detail?: string,
): Promise<void> {
  await state.appendAudit({
    occurredAt: new Date().toISOString(),
    actorId,
    action,
    resourceType,
    resourceId,
    outcome,
    ...(detail ? { detail: redactSensitiveText(detail, 500) } : {}),
  });
}

function formatAuditLog(entries: AuditEvent[], global: boolean): string {
  if (entries.length === 0) return "审计日志为空。";
  return [
    `最近审计记录（${global ? "全团队" : "仅本人"}）`,
    ...entries.map((entry) => {
      const time = new Date(entry.occurredAt).toLocaleString("zh-CN", { hour12: false });
      const actor = global ? ` · ${logRef(entry.actorId)}` : "";
      return `- ${time} · ${entry.action} · ${entry.outcome}${actor}${entry.detail ? ` · ${redactSensitiveText(entry.detail, 120)}` : ""}`;
    }),
  ].join("\n");
}

function conversationBelongsToChat(conversationKey: string, chatId: string): boolean {
  return conversationKey === chatId || conversationKey.startsWith(`${chatId}::`);
}

function taskChatId(conversationKey: string): string {
  const memberBoundary = conversationKey.indexOf("::");
  return memberBoundary >= 0 ? conversationKey.slice(0, memberBoundary) : conversationKey;
}

function taskCollaborationContext(
  ownerId: string,
  controllerId: string,
  project: Pick<CodexProject, "path" | "name" | "displayPath">,
  conversationKey: string,
): Pick<
  TaskProgressContext,
  | "initiatorLabel"
  | "controllerLabel"
  | "controllerSelector"
  | "handoffOptions"
  | "teamMode"
> {
  const teamMode = state.getChatType(taskChatId(conversationKey)) === "group";
  const handoffOptions = teamMode
    ? operatingTeamMembers(config, project).map((member) => ({
        label: teamMemberOptionLabel(member),
        value: member.selector,
      }))
    : [];
  return {
    initiatorLabel: memberLabel(config, ownerId),
    controllerLabel: memberLabel(config, controllerId),
    controllerSelector: memberSelector(controllerId),
    handoffOptions,
    teamMode,
  };
}

async function setTaskController(
  record: TaskRecord,
  controllerId: string,
  actorId: string,
  action: "handoff" | "takeover",
): Promise<void> {
  const previousController = record.controllerId;
  record.controllerId = controllerId;
  const note =
    previousController === controllerId
      ? `${memberLabel(config, controllerId)} 已经是当前控制者。`
      : action === "handoff"
        ? `任务已转交给 ${memberLabel(config, controllerId)}；发起人与执行权限保持不变。`
        : `${memberLabel(config, controllerId)} 已显式接管任务。`;
  const context = taskCollaborationContext(
    record.ownerId,
    controllerId,
    record.project,
    record.conversationKey,
  );
  const session = taskLiveSession(record);
  if (session) {
    await session.updateCollaboration(context, note);
    record.progress = session.progress;
  } else {
    record.progress = updateTaskCollaboration(record.progress, context, note);
  }
  await persistTaskRecord(record);
  await audit(
    actorId,
    `task.${action}`,
    "task",
    record.id,
    previousController === controllerId ? "denied" : "allowed",
    `${memberSelector(previousController)} -> ${memberSelector(controllerId)}`,
  );
}

async function persistTaskRecord(record: TaskRecord): Promise<void> {
  const scheduled = taskPersistTimers.get(record.id);
  if (scheduled) {
    clearTimeout(scheduled);
    taskPersistTimers.delete(record.id);
  }
  const card = record.card;
  const conversation = record.conversation;
  const fallbackCard = record.fallbackCard;
  const persisted: PersistedTaskState = {
    id: record.id,
    conversationKey: record.conversationKey,
    ownerId: record.ownerId,
    controllerId: record.controllerId,
    prompt: record.prompt,
    replyToMessageId: record.replyToMessageId,
    seed: record.seed,
    project: { ...record.project },
    status: record.status,
    progress: structuredClone(record.progress),
    ...(card?.cardId ? { cardId: card.cardId } : {}),
    ...(card?.messageId ? { cardMessageId: card.messageId } : {}),
    cardSequence: card?.sequenceNumber ?? 0,
    ...(fallbackCard?.cardId ? { fallbackCardId: fallbackCard.cardId } : {}),
    ...(fallbackCard?.messageId
      ? { fallbackCardMessageId: fallbackCard.messageId }
      : {}),
    ...(fallbackCard
      ? { fallbackCardSequence: fallbackCard.sequenceNumber }
      : {}),
    ...(conversation?.messageId
      ? { conversationMessageId: conversation.messageId }
      : {}),
    ...(conversation
      ? { conversationMessageSequence: conversation.sequenceNumber }
      : {}),
    ...(record.replyInThread ? { replyInThread: true } : {}),
    ...(record.freshThread ? { freshThread: true } : {}),
    attachments: structuredClone(record.attachments),
    allowedExternalActions: [...record.allowedExternalActions],
    settings: { ...record.settings },
    createdAt: new Date(record.progress.createdAt).toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await state.upsertTask(persisted);
}

function schedulePersistTaskRecord(record: TaskRecord): void {
  if (taskPersistTimers.has(record.id)) return;
  const timer = setTimeout(() => {
    taskPersistTimers.delete(record.id);
    void persistTaskRecord(record).catch((error) => {
      console.error(`[bridge] unable to persist task snapshot id=${record.id}`, error);
    });
  }, 2_000);
  timer.unref();
  taskPersistTimers.set(record.id, timer);
}

async function flushScheduledTaskPersists(): Promise<void> {
  const ids = [...taskPersistTimers.keys()];
  for (const id of ids) {
    const timer = taskPersistTimers.get(id);
    if (timer) clearTimeout(timer);
    taskPersistTimers.delete(id);
    const record = tasks.get(id);
    if (record) await persistTaskRecord(record);
  }
}

function confirmationFromPersisted(saved: PersistedConfirmationState): PendingConfirmation {
  return structuredClone(saved);
}

async function restorePersistedRecords(): Promise<void> {
  for (const saved of state.listProjectCards()) {
    if (!roleForSender(config, saved.ownerId)) {
      await state.removeProjectCard(saved.messageId);
      continue;
    }
    projectCards.set(saved.messageId, {
      cardId: saved.cardId,
      conversationKey: saved.conversationKey,
      ownerId: saved.ownerId,
      sequence: saved.sequence,
      createdAt: saved.createdAt,
    });
  }

  for (const saved of state.listDeviceCards()) {
    if (!roleForSender(config, saved.ownerId)) {
      await state.removeDeviceCard(saved.messageId);
      continue;
    }
    deviceCards.set(saved.messageId, {
      cardId: saved.cardId,
      conversationKey: saved.conversationKey,
      ownerId: saved.ownerId,
      sequence: saved.sequence,
      createdAt: saved.createdAt,
    });
  }

  for (const saved of state.listConfirmations()) {
    const project = projectRegistry.getByPath(saved.project.path);
    if (
      Date.parse(saved.expiresAt) <= Date.now() ||
      !canOperate(config, saved.ownerId) ||
      !project ||
      !canAccessProject(config, saved.ownerId, project)
    ) {
      await state.removeConfirmation(saved.id);
      continue;
    }
    pendingConfirmations.set(saved.id, confirmationFromPersisted(saved));
  }

  const savedTasks = state
    .listTasks()
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  for (const savedTask of savedTasks) {
    const reconciliation = reconcilePersistedTask(savedTask);
    const saved = reconciliation.task;
    if (reconciliation.changed) await state.upsertTask(saved);
    const controllerAuthorized =
      canOperate(config, saved.controllerId) &&
      canAccessProject(config, saved.controllerId, saved.project);
    const controllerId = controllerAuthorized ? saved.controllerId : saved.ownerId;
    const restoredProgress = updateTaskCollaboration(
      saved.progress,
      taskCollaborationContext(
        saved.ownerId,
        controllerId,
        saved.project,
        saved.conversationKey,
      ),
      controllerAuthorized
        ? undefined
        : "原控制者的团队权限已变化，任务控制权已安全回到发起人。",
    );
    const card = saved.cardId
      ? TaskCardSession.restore(
          lark,
          saved.cardId,
          saved.cardMessageId ?? "",
          restoredProgress,
          saved.cardSequence,
        )
      : null;
    const fallbackCard =
      saved.fallbackCardId && saved.fallbackCardMessageId
        ? FallbackCardSession.restore(
            lark,
            saved.fallbackCardId,
            saved.fallbackCardMessageId,
            saved.fallbackCardSequence ?? 0,
          )
        : null;
    const conversation = saved.conversationMessageId
      ? ConversationTurnSession.restore(
          lark,
          saved.conversationMessageId,
          restoredProgress,
          saved.conversationMessageSequence ?? 0,
        )
      : null;
    const record: TaskRecord = {
      id: saved.id,
      conversationKey: saved.conversationKey,
      ownerId: saved.ownerId,
      controllerId,
      prompt: saved.prompt,
      project: saved.project,
      status: saved.status,
      card,
      conversation,
      fallbackCard,
      progress: restoredProgress,
      replyToMessageId: saved.replyToMessageId,
      seed: saved.seed,
      attachments: saved.attachments,
      allowedExternalActions: saved.allowedExternalActions,
      settings: saved.settings,
      allowThreadBinding: saved.status === "queued" || saved.status === "running",
      replyInThread: saved.replyInThread ?? false,
      freshThread: saved.freshThread ?? false,
    };
    if (card) {
      card.onSnapshot((snapshot) => {
        record.progress = snapshot.progress;
        record.status = snapshot.progress.phase;
        schedulePersistTaskRecord(record);
      });
    }
    if (conversation) {
      conversation.onSnapshot((snapshot) => {
        record.progress = snapshot.progress;
        record.status = snapshot.progress.phase;
        schedulePersistTaskRecord(record);
      });
    }
    tasks.set(record.id, record);

    if (!controllerAuthorized && saved.controllerId !== saved.ownerId) {
      await persistTaskRecord(record);
      await audit(
        record.ownerId,
        "task.controller_recover",
        "task",
        record.id,
        "allowed",
        "controller authorization changed; returned to initiator",
      );
    }

    if (
      reconciliation.changed &&
      taskLiveSession(record) &&
      ["succeeded", "failed", "cancelled", "interrupted"].includes(record.status)
    ) {
      const session = taskLiveSession(record)!;
      await session.addActionNote(reconciliation.reason ?? "服务启动时已完成状态对账。");
      record.progress = session.progress;
      await persistTaskRecord(record);
    }
    if (reconciliation.changed) {
      await audit(
        record.ownerId,
        "task.reconcile",
        "task",
        record.id,
        "allowed",
        reconciliation.reason,
      );
    }

    if (record.status === "running") {
      const message =
        "检测到桥接服务在任务运行期间停止。为避免重复执行命令或重复修改文件，任务没有自动重跑；请先查看变更，再决定是否重新执行。";
      record.status = "interrupted";
      if (record.progress.threadId) {
        await rememberActiveThread(record, record.progress.threadId);
      }
      const session = taskLiveSession(record);
      if (session) {
        await session.finishInterrupted(message);
        record.progress = session.progress;
      } else {
        record.progress = interruptTaskProgress(record.progress, message);
      }
      await persistTaskRecord(record);
      await audit(
        record.ownerId,
        "task.recover",
        "task",
        record.id,
        "failed",
        "running task interrupted; automatic replay blocked",
      );
      continue;
    }

    if (record.status === "queued") {
      const project = projectRegistry.getByPath(record.project.path);
      const maximum = maxSandboxForActor(record.ownerId);
      const recoveryBlocked =
        !canOperate(config, record.ownerId) ||
        !project ||
        !canAccessProject(config, record.ownerId, project) ||
        !isSandboxModeAllowed(record.settings.sandboxMode, maximum);
      if (recoveryBlocked) {
        const message =
          "服务重启后检测到成员、项目或权限上限已经变化；为安全起见，旧任务未自动恢复，请重新发送。";
        record.status = "failed";
        const session = taskLiveSession(record);
        if (session) {
          await session.finishFailed(message);
          record.progress = session.progress;
        } else {
          record.progress = failTask(record.progress, message);
        }
        await persistTaskRecord(record);
        await audit(
          record.ownerId,
          "task.recover",
          "task",
          record.id,
          "denied",
          "authorization changed",
        );
        continue;
      }
      record.project = project;
      record.status = "queued";
      const queuePosition = queue.nextPosition(record.conversationKey);
      const session = taskLiveSession(record);
      if (session) {
        await session.markRecovered(
          "服务重启后已从 SQLite 可靠队列恢复，将自动继续执行。",
          queuePosition,
        );
        record.progress = session.progress;
      } else {
        record.progress = recoverTaskProgress(
          record.progress,
          queuePosition,
          "服务重启后已从 SQLite 可靠队列恢复，将自动继续执行。",
        );
      }
      await persistTaskRecord(record);
      try {
        scheduleTaskRecord(record);
      } catch (error) {
        record.status = "failed";
        const message = `恢复任务失败：${(error as Error).message}`;
        const failedSession = taskLiveSession(record);
        if (failedSession) {
          await failedSession.finishFailed(message);
          record.progress = failedSession.progress;
        } else {
          record.progress = failTask(record.progress, message);
        }
        await persistTaskRecord(record);
      }
    }
  }
}

async function currentProject(conversationKey: string, actorId: string): Promise<CodexProject> {
  const projectChat = state.getProjectChat(chatIdFromConversationKey(conversationKey));
  if (projectChat) {
    let boundProject = projectRegistry.getByPath(projectChat.projectPath);
    if (!boundProject) {
      await projectRegistry.refresh();
      boundProject = projectRegistry.getByPath(projectChat.projectPath);
    }
    if (!boundProject) {
      throw new Error(`这个项目群绑定的本地项目已经不可用：${projectChat.name}。`);
    }
    if (!canAccessProject(config, actorId, boundProject)) {
      throw new Error(`你的账号没有被授权访问项目 ${boundProject.name}。`);
    }
    if (state.getProject(conversationKey) !== boundProject.path) {
      await state.setProject(conversationKey, boundProject.path);
    }
    return boundProject;
  }
  const savedPath = state.getProject(conversationKey);
  const accessible = () => visibleProjects(config, actorId, projectRegistry.list());
  if (!savedPath) {
    const preferred = projectRegistry.defaultProject();
    if (canAccessProject(config, actorId, preferred)) return preferred;
    const fallback = accessible()[0];
    if (!fallback) throw new Error("你的账号没有被授权访问任何 Codex 项目。");
    await state.setProject(conversationKey, fallback.path);
    return fallback;
  }
  let project = projectRegistry.getByPath(savedPath);
  if (!project) {
    await projectRegistry.refresh();
    project = projectRegistry.getByPath(savedPath);
  }
  if (project && canAccessProject(config, actorId, project)) return project;
  const preferred = projectRegistry.defaultProject();
  const fallback = canAccessProject(config, actorId, preferred) ? preferred : accessible()[0];
  if (!fallback) throw new Error("你的账号没有被授权访问任何 Codex 项目。");
  await state.setProject(conversationKey, fallback.path);
  return fallback;
}

function formatProjectList(
  current: CodexProject,
  projects: readonly CodexProject[] = projectRegistry.list(),
): string {
  const visible = projects.slice(0, 50);
  const lines = [
    `可用项目（${projects.length}）`,
    ...visible.map((project, index) => {
      const marker = project.path === current.path ? " ← 当前" : "";
      return `${index + 1}. ${project.name}${marker}\n   ${project.displayPath}`;
    }),
  ];
  if (projects.length > visible.length) lines.push(`其余 ${projects.length - visible.length} 个未显示。`);
  lines.push("", "切换方式：/use 2 或 切换 FastGPT");
  return lines.join("\n");
}

function projectResolutionError(
  selector: string,
  resolution: ProjectResolution,
  actorId: string,
): string {
  const projects = rankedProjectsForActor(actorId);
  if (resolution.status === "ambiguous") {
    const options = resolution.projects
      .slice(0, 10)
      .map((project) => {
        const index = projects.findIndex((candidate) => candidate.path === project.path);
        return `${index + 1}. ${project.name} — ${project.displayPath}`;
      });
    return [`“${selector}”匹配到多个项目：`, ...options, "请使用编号切换，例如 /use 2。"].join(
      "\n",
    );
  }
  return `没有找到项目“${selector}”。发送“项目”查看可用列表。`;
}

function resolveAccessibleProject(selector: string, actorId: string): ProjectResolution {
  return resolveProjectSelector(rankedProjectsForActor(actorId), selector);
}

function rankedProjectsForActor(actorId: string): CodexProject[] {
  const projects = visibleProjects(config, actorId, projectRegistry.list());
  return rankProjectWorkspace(projects, state.listProjectUsage(actorId)).projects;
}

function parseCardActionValue(event: FeishuCardActionEvent): CardActionValue | null {
  try {
    const value = JSON.parse(event.action_value) as Record<string, unknown>;
    if (value.bridge === "feishu-codex-v7") {
      const action = String(value.action ?? "");
      if (
        !["runbook_run", "runbook_refresh", "runbook_projects", "runbook_team"].includes(
          action,
        )
      ) {
        return null;
      }
      if (action === "runbook_run" && typeof value.runbook_id !== "string") return null;
      return {
        bridge: "feishu-codex-v7",
        action: action as RunbookCardActionValue["action"],
        ...(typeof value.runbook_id === "string" ? { runbook_id: value.runbook_id } : {}),
      };
    }
    if (value.bridge === "feishu-codex-v6") {
      const action = String(value.action ?? "");
      if (
        ![
          "review_page",
          "review_file",
          "review_refresh",
          "review_back",
          "review_diff_page",
          "review_close",
        ].includes(action) ||
        typeof value.task_id !== "string"
      ) {
        return null;
      }
      const page = cardInteger(value.page);
      const fileIndex = cardInteger(value.file_index);
      const diffPage = cardInteger(value.diff_page);
      if (action === "review_page" && page === undefined) return null;
      if (action === "review_file" && fileIndex === undefined) return null;
      if (action === "review_diff_page" && diffPage === undefined) return null;
      return {
        bridge: "feishu-codex-v6",
        action: action as ReviewCardActionValue["action"],
        task_id: value.task_id,
        ...(page === undefined ? {} : { page }),
        ...(fileIndex === undefined ? {} : { file_index: fileIndex }),
        ...(diffPage === undefined ? {} : { diff_page: diffPage }),
      };
    }
    if (value.bridge === "feishu-codex-v5") {
      const action = String(value.action ?? "");
      if (
        [
          "select_model",
          "select_effort",
          "select_sandbox",
          "settings_refresh",
          "settings_sessions",
          "settings_tasks",
          "settings_new",
          "lease_full_once",
          "lease_full_30m",
          "lease_full_session",
          "lease_full_revoke",
          "select_session",
          "session_compact",
          "session_new",
          "session_settings",
          "session_open_desktop",
          "session_refresh",
          "tasks_stop",
          "tasks_cancel_one",
          "tasks_review",
          "tasks_new",
          "tasks_settings",
          "tasks_refresh",
          "team_tasks",
          "team_runbooks",
          "team_projects",
          "team_refresh",
          "home_first_task",
          "home_new_session",
          "home_projects",
          "home_sessions",
          "home_device",
          "home_project_chat",
          "home_refresh",
          "onboarding_start",
          "onboarding_first_task",
          "onboarding_home",
          "onboarding_device",
          "onboarding_dismiss",
          "onboarding_projects",
          "onboarding_settings",
          "onboarding_next",
          "onboarding_sessions",
          "onboarding_tasks",
          "onboarding_back",
          "onboarding_finish",
          "onboarding_restart",
        ].includes(action)
      ) {
        if (
          (action === "tasks_cancel_one" || action === "tasks_review") &&
          typeof value.task_id !== "string"
        ) return null;
        return {
          bridge: "feishu-codex-v5",
          action: action as V5CardActionValue["action"],
          ...(typeof value.task_id === "string" ? { task_id: value.task_id } : {}),
        };
      }
      return null;
    }
    if (value.bridge === "feishu-codex-v4") {
      const action = String(value.action ?? "");
      if (
        [
          "device_refresh",
          "device_quota",
          "device_projects",
          "device_settings",
          "device_sessions",
          "device_tasks",
          "device_new_session",
          "device_stop",
          "device_reconnect",
          "quota_refresh",
          "quota_device",
          "remote_ready_enable",
          "remote_ready_disable",
        ].includes(action)
      ) {
        return {
          bridge: "feishu-codex-v4",
          action: action as DeviceCardActionValue["action"],
        };
      }
      if (
        ![
          "approve_runtime_once",
          "approve_runtime_session",
          "reject_runtime",
          "answer_runtime",
          "cancel_runtime_question",
        ].includes(action) ||
        typeof value.request_id !== "string"
      ) {
        return null;
      }
      return {
        bridge: "feishu-codex-v4",
        action: action as RuntimeCardActionValue["action"],
        request_id: value.request_id,
        ...(typeof value.question_id === "string" ? { question_id: value.question_id } : {}),
        ...(typeof value.answer === "string" ? { answer: value.answer } : {}),
      };
    }
    if (value.bridge !== "feishu-codex-v2" && value.bridge !== "feishu-codex-v3") return null;
    if (
      value.action === "select_project" ||
      value.action === "toggle_project_favorite" ||
      value.action === "project_chat"
    ) {
      return {
        bridge: value.bridge,
        action: value.action,
      };
    }
    if (
      value.bridge === "feishu-codex-v3" &&
      (value.action === "approve_external" || value.action === "reject_external") &&
      typeof value.request_id === "string"
    ) {
      return {
        bridge: "feishu-codex-v3",
        action: value.action,
        request_id: value.request_id,
      };
    }
    if (
      ![
        "cancel",
        "retry",
        "new",
        "changes",
        "review",
        "result",
        "result_back",
        "handoff",
        "takeover",
      ].includes(
        String(value.action ?? ""),
      ) ||
      typeof value.task_id !== "string"
    ) {
      return null;
    }
    return {
      bridge: value.bridge,
      action: value.action as TaskCardActionValue["action"],
      task_id: value.task_id,
    };
  } catch {
    return null;
  }
}

function cardInteger(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function switchFeedback(
  project: CodexProject,
  cancelledActive: number,
  cancelledQueued: number,
  threadReset: boolean,
): string {
  const cancelled = cancelledActive + cancelledQueued;
  const session = threadReset ? "已开启新会话" : "将从新会话开始";
  return `已切换到 ${project.name} · ${session}${cancelled > 0 ? ` · 已取消 ${cancelled} 个未完成任务` : ""}`;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours} 小时${remainder > 0 ? ` ${remainder} 分钟` : ""}`;
}

function pruneTaskRecords(): void {
  if (tasks.size <= 100) return;
  for (const [id, record] of tasks) {
    if (record.status === "queued" || record.status === "running") continue;
    const scheduled = taskPersistTimers.get(id);
    if (scheduled) clearTimeout(scheduled);
    taskPersistTimers.delete(id);
    tasks.delete(id);
    void state.removeTask(id);
    if (tasks.size <= 80) return;
  }
}

function protectedAttachmentPaths(): string[] {
  return [
    ...[...tasks.values()]
      .filter((task) => task.status === "queued" || task.status === "running")
      .flatMap((task) => task.attachments.map((attachment) => attachment.path)),
    ...[...pendingConfirmations.values()].flatMap((confirmation) =>
      confirmation.attachments.map((attachment) => attachment.path),
    ),
  ];
}

async function runMaintenance(): Promise<void> {
  const cleanup = await cleanupAttachmentCache(
    join(config.projectDir, "lark-im-resources"),
    config.attachmentRetentionHours * 60 * 60_000,
    protectedAttachmentPaths(),
  );
  const trimmedLogs = await trimRuntimeLogs(
    join(config.dataDir, "log"),
    config.maxLogBytes,
  );
  if (cleanup.removedFiles > 0 || trimmedLogs > 0) {
    console.info(
      `[bridge] maintenance removed_files=${cleanup.removedFiles} reclaimed_bytes=${cleanup.reclaimedBytes} trimmed_logs=${trimmedLogs}`,
    );
  }
}

function startMaintenanceTimer(): void {
  maintenanceTimer = setInterval(() => {
    void runMaintenance().catch((error) => {
      console.error("[bridge] runtime maintenance failed", error);
    });
  }, 6 * 60 * 60_000);
  maintenanceTimer.unref();
}

function replayOutbox(): Promise<void> {
  if (outboxReplayPromise) return outboxReplayPromise;
  const operation = replayOutboxOnce().finally(() => {
    if (outboxReplayPromise === operation) outboxReplayPromise = null;
  });
  outboxReplayPromise = operation;
  return operation;
}

async function replayOutboxOnce(): Promise<void> {
  const pending = state.listDueOutbox();
  for (const item of pending) {
    try {
      await deliverTextFallback(
        item.payload.messageId,
        redactSensitiveText(item.payload.text),
        item.payload.idempotencyKey,
      );
      await state.markOutboxSent(item.id);
    } catch (error) {
      await state.markOutboxFailed(
        item.id,
        safeErrorText(error),
      );
    }
  }
  if (pending.length > 0) {
    console.info(`[bridge] replayed durable outbox candidates=${pending.length}`);
  }
}

function startOutboxTimer(): void {
  outboxTimer = setInterval(() => {
    void replayOutbox().catch((error) => {
      console.error("[bridge] durable outbox replay failed", error);
    });
  }, 30_000);
  outboxTimer.unref();
}

function pruneProjectCards(): void {
  if (projectCards.size <= 50) return;
  const oldest = [...projectCards.entries()].sort(
    ([, left], [, right]) => left.createdAt - right.createdAt,
  );
  for (const [messageId] of oldest.slice(0, projectCards.size - 40)) {
    projectCards.delete(messageId);
    void state.removeProjectCard(messageId);
  }
}

function pruneDeviceCards(): void {
  if (deviceCards.size <= 30) return;
  const oldest = [...deviceCards.entries()].sort(
    ([, left], [, right]) => left.createdAt - right.createdAt,
  );
  for (const [messageId] of oldest.slice(0, deviceCards.size - 20)) {
    deviceCards.delete(messageId);
    void state.removeDeviceCard(messageId);
  }
}

function pruneControlCards(records: Map<string, ControlCardRecord>): void {
  const cutoff = Date.now() - 24 * 60 * 60_000;
  for (const [messageId, record] of records) {
    if (record.createdAt < cutoff) records.delete(messageId);
  }
  while (records.size > 100) {
    const oldest = records.keys().next().value as string | undefined;
    if (!oldest) break;
    records.delete(oldest);
  }
}

async function shutdown(signal: string): Promise<void> {
  if (shutdownController.signal.aborted) return;
  console.info(`[bridge] shutting down after ${signal}`);
  shutdownController.abort();
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
  await publishBridgeHealth("stopping").catch(() => undefined);
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }
  if (outboxTimer) {
    clearInterval(outboxTimer);
    outboxTimer = null;
  }
  queue.pause();
  runner.cancelAll("shutdown");
  remoteReady.close();
  await Promise.all([...tasks.keys()].map((taskId) => closeRuntimeInteractionsForTask(taskId)));
  await runner.close();
  await queue.waitForIdle();
  if (outboxReplayPromise) await outboxReplayPromise.catch(() => undefined);
  await flushScheduledTaskPersists();
  await state.flush();
  state.close();
  await removeBridgeHealth(config.dataDir, process.pid).catch(() => undefined);
}

function bridgeHealthStatus(): BridgeHealthStatus {
  const consumers = lark.getConsumerHealth();
  if (consumers.length < 2) return "starting";
  return consumers.every((consumer) => consumer.ready) && lark.getApiHealth().state !== "degraded"
    ? "ready"
    : "degraded";
}

async function publishBridgeHealth(status = bridgeHealthStatus()): Promise<void> {
  const api = lark.getApiHealth();
  await writeBridgeHealth(config.dataDir, {
    status,
    instanceId: config.instanceId,
    pid: process.pid,
    startedAt: bridgeStartedAt,
    configFile: config.configFile ?? null,
    productVersion: PACKAGE_VERSION,
    packageRoot: PACKAGE_ROOT,
    activeTasks: queue.activeCount,
    queuedTasks: queue.pendingCount,
    consumers: lark.getConsumerHealth().map((consumer) => ({
      eventKey: consumer.eventKey,
      ready: consumer.ready,
      restartCount: consumer.restartCount,
      ...(consumer.lastReadyAt
        ? { lastReadyAt: new Date(consumer.lastReadyAt).toISOString() }
        : {}),
      ...(consumer.lastExitAt
        ? { lastExitAt: new Date(consumer.lastExitAt).toISOString() }
        : {}),
    })),
    api: {
      state: api.state,
      consecutiveFailures: api.consecutiveFailures,
      ...(api.lastSuccessAt
        ? { lastSuccessAt: new Date(api.lastSuccessAt).toISOString() }
        : {}),
      ...(api.lastFailureAt
        ? { lastFailureAt: new Date(api.lastFailureAt).toISOString() }
        : {}),
      ...(api.lastError ? { lastError: api.lastError } : {}),
    },
  });
}

function startHealthTimer(): void {
  if (healthTimer) return;
  healthTimer = setInterval(() => {
    void publishBridgeHealth().catch((error) => {
      console.error("[bridge] unable to update health marker", error);
    });
  }, 10_000);
  healthTimer.unref();
}

interface RecoveryContext {
  unexpected: boolean;
  notify: boolean;
  offlineForMs: number;
  previousHeartbeatAt?: string;
}

async function refreshPersistedDeviceCards(recovery: RecoveryContext): Promise<void> {
  const newestByConversation = new Map<
    string,
    { messageId: string; record: DeviceCardRecord }
  >();
  let refreshed = 0;
  for (const [messageId, record] of [...deviceCards.entries()].sort(
    ([, left], [, right]) => right.createdAt - left.createdAt,
  )) {
    try {
      const snapshot = await buildDeviceSnapshot(
        record.conversationKey,
        record.ownerId,
        recovery.unexpected ? "本机服务已恢复，状态已自动刷新。" : "",
      );
      record.sequence += 1;
      await lark.updateCard(record.cardId, renderDeviceCard(snapshot), record.sequence);
      await state.upsertDeviceCard({
        messageId,
        cardId: record.cardId,
        conversationKey: record.conversationKey,
        ownerId: record.ownerId,
        sequence: record.sequence,
        createdAt: record.createdAt,
      });
      refreshed += 1;
      if (!newestByConversation.has(record.conversationKey)) {
        newestByConversation.set(record.conversationKey, { messageId, record });
      }
    } catch (error) {
      console.warn(`[bridge] unable to refresh persisted device card message=${logRef(messageId)}`, error);
    }
  }
  if (refreshed > 0) console.info(`[bridge] refreshed ${refreshed} persisted device card(s)`);

  if (!recovery.notify) return;
  const now = Date.now();
  for (const [conversationKey, { messageId }] of newestByConversation) {
    const lastNotice = state.getLastDeviceRecoveryNotice(conversationKey);
    if (!shouldSendRecoveryNotice(lastNotice, now)) continue;
    const notifiedAt = new Date(now).toISOString();
    try {
      await productReply(
        messageId,
        `本地 Codex 已恢复在线，检测到此前离线约 ${formatDuration(recovery.offlineForMs)}。已有控制台状态已刷新。`,
        replyKey(
          recovery.previousHeartbeatAt ?? bridgeStartedAt,
          `device-recovered-${config.instanceId}`,
        ),
        "device-recovered",
      );
      await state.setLastDeviceRecoveryNotice(conversationKey, notifiedAt);
    } catch (error) {
      console.warn(`[bridge] unable to send recovery notice chat=${logRef(conversationKey)}`, error);
    }
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function main(): Promise<void> {
  const previousHealth = await readBridgeHealth(config.dataDir);
  const recoveryDecision = assessBridgeRecovery(previousHealth, {
    currentPid: process.pid,
    processAlive: processIsAlive,
  });
  if (recoveryDecision.blockDuplicate && previousHealth) {
    throw new Error(
      `Another bridge process is already using this data directory (pid=${previousHealth.pid}, instance=${previousHealth.instanceId}).`,
    );
  }
  const recovery: RecoveryContext = {
    unexpected: recoveryDecision.unexpected,
    notify: recoveryDecision.notify,
    offlineForMs: recoveryDecision.offlineForMs,
    ...(recoveryDecision.previousHeartbeatAt
      ? { previousHeartbeatAt: recoveryDecision.previousHeartbeatAt }
      : {}),
  };
  await removeBridgeHealth(config.dataDir);
  await publishBridgeHealth("starting");
  ownsHealthMarker = true;
  await state.load();
  for (const binding of state.listProjectChats()) {
    config.allowedChatIds.add(binding.chatId);
    await state.setChatType(binding.chatId, "group");
  }
  if (state.getRemoteReady()) {
    try {
      await remoteReady.setEnabled(true);
    } catch (error) {
      console.error("[bridge] unable to restore Remote Ready", error);
    }
  }
  await replayOutbox();
  startOutboxTimer();
  const discoveredProjects = await projectRegistry.refresh();
  await restorePersistedRecords();
  await reconcilePersistedProjectChatSetups();
  await runMaintenance();
  startMaintenanceTimer();
  console.info(
    `[bridge] starting V5 instance=${config.instanceId} default=${logRef(config.workdir)} projects=${discoveredProjects.length} roots=${config.projectRoots.length} codex_sync=${config.syncSavedProjects} sandbox=${config.sandboxMode} operator_sandbox=${config.operatorSandboxMode} concurrency=${config.maxConcurrentTasks} admins=${config.adminSenderIds.size} operators=${config.allowedSenderIds.size} viewers=${config.viewerSenderIds.size} project_acl=${config.projectAcl.size} group_scope=${config.groupSessionScope} auto_onboarding=${config.autoOnboarding} chat_allowlist=${config.allowedChatIds.size} env_passthrough=${config.codexAllowedEnvVars.length}`,
  );

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  const ready = new Set<string>();
  const reportReady = (consumer: string) => {
    ready.add(consumer);
    if (ready.size === 2) {
      console.info("[bridge] V5 ready — team isolation, model controls, sessions, durable queue, approvals, and Remote Ready are listening");
      void publishBridgeHealth("ready").catch((error) => {
        console.error("[bridge] unable to publish ready health marker", error);
      });
      void refreshPersistedDeviceCards(recovery).catch((error) => {
        console.error("[bridge] unable to refresh recovered device cards", error);
      });
      void refreshPersistedProjectChatCards().catch((error) => {
        console.error("[bridge] unable to refresh persisted project chat cards", error);
      });
      startHealthTimer();
    }
  };

  await Promise.all([
    lark.consumeMessages(handleEvent, shutdownController.signal, () => reportReady("messages")),
    lark.consumeEvent("card.action.trigger", handleCardAction, shutdownController.signal, () =>
      reportReady("cards"),
    ),
  ]);
}

main().catch(async (error) => {
  console.error("[bridge] fatal", error);
  if (ownsHealthMarker) await publishBridgeHealth("failed").catch(() => undefined);
  process.exitCode = 1;
});
