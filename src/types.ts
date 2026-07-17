import type { TaskProgress } from "./progress.js";

export interface FeishuMessageEvent {
  type: "im.message.receive_v1";
  event_id: string;
  message_id: string;
  chat_id: string;
  chat_type: "p2p" | "group";
  sender_id: string;
  message_type: string;
  content: string;
  reply_to?: string;
  root_id?: string;
  thread_id?: string;
  create_time?: string;
  timestamp?: string;
}

export interface FeishuCardActionEvent {
  type: "card.action.trigger";
  event_id: string;
  operator_id: string;
  chat_id: string;
  message_id: string;
  token: string;
  action_value: string;
  card_content: string;
  action_tag?: string;
  action_name?: string;
  option?: string;
  timestamp?: string;
}

export interface ThreadState {
  threadId: string;
  updatedAt: string;
}

export interface ProjectState {
  path: string;
  updatedAt: string;
}

export interface ChatState {
  type: "p2p" | "group";
  updatedAt: string;
}

export interface SeenEvent {
  id: string;
  seenAt: string;
}

export interface DeviceState {
  remoteReadyEnabled: boolean;
  updatedAt: string;
}

export type TeamRole = "admin" | "operator" | "viewer";

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "ultra";

export interface ConversationPreferences {
  model?: string;
  reasoningEffort?: ReasoningEffort;
  sandboxMode?: SandboxMode;
  updatedAt: string;
}

export interface OnboardingState {
  ownerId: string;
  status: "active" | "completed" | "dismissed";
  step: 1 | 2 | 3 | 4;
  updatedAt: string;
}

export interface TaskExecutionSettings {
  model?: string;
  reasoningEffort?: ReasoningEffort;
  sandboxMode: SandboxMode;
}

export type PermissionLeaseScope = "next-task" | "timed" | "session";

export interface PermissionLease {
  conversationKey: string;
  ownerId: string;
  projectPath: string;
  scope: PermissionLeaseScope;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  remainingUses: number;
  threadId?: string;
}

export type TaskRecordStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

export type ExternalAction = "commit" | "push" | "deploy" | "pull_request";

export interface TaskAttachment {
  kind: "image" | "text";
  path: string;
  name: string;
  sizeBytes: number;
}

export interface PersistedTaskState {
  id: string;
  conversationKey: string;
  ownerId: string;
  controllerId: string;
  prompt: string;
  replyToMessageId: string;
  seed: string;
  project: {
    path: string;
    name: string;
    displayPath: string;
    isGitRepository: boolean;
    source: "codex" | "scan" | "default";
  };
  status: TaskRecordStatus;
  progress: TaskProgress;
  cardId?: string;
  cardMessageId?: string;
  cardSequence: number;
  fallbackCardId?: string;
  fallbackCardMessageId?: string;
  fallbackCardSequence?: number;
  conversationMessageId?: string;
  conversationMessageSequence?: number;
  replyInThread?: boolean;
  attachments: TaskAttachment[];
  allowedExternalActions: ExternalAction[];
  settings: TaskExecutionSettings;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedProjectCardState {
  messageId: string;
  cardId: string;
  conversationKey: string;
  ownerId: string;
  sequence: number;
  createdAt: number;
}

export interface PersistedDeviceCardState {
  messageId: string;
  cardId: string;
  conversationKey: string;
  ownerId: string;
  sequence: number;
  createdAt: number;
}

export interface ProjectUsageState {
  ownerId: string;
  projectPath: string;
  favorite: boolean;
  lastUsedAt?: string;
  useCount: number;
}

export interface PersistedConfirmationState {
  id: string;
  seed: string;
  conversationKey: string;
  ownerId: string;
  prompt: string;
  project: PersistedTaskState["project"];
  actions: ExternalAction[];
  attachments: TaskAttachment[];
  cardId: string;
  messageId: string;
  sequence: number;
  replyInThread?: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface PersistedState {
  version: 6;
  threads: Record<string, ThreadState>;
  projects: Record<string, ProjectState>;
  chats: Record<string, ChatState>;
  seenEvents: SeenEvent[];
  tasks: Record<string, PersistedTaskState>;
  projectCards: Record<string, PersistedProjectCardState>;
  confirmations: Record<string, PersistedConfirmationState>;
  preferences: Record<string, ConversationPreferences>;
  device: DeviceState;
}

export interface AuditEvent {
  id?: number;
  occurredAt: string;
  actorId: string;
  action: string;
  resourceType:
    | "task"
    | "project"
    | "session"
    | "settings"
    | "device"
    | "onboarding"
    | "security";
  resourceId: string;
  outcome: "allowed" | "denied" | "failed";
  detail?: string;
}

export interface PersistedOutboxItem {
  id: string;
  kind: "reply_text";
  payload: {
    messageId: string;
    text: string;
    idempotencyKey: string;
  };
  attempts: number;
  createdAt: string;
  nextAttemptAt: string;
  lastError?: string;
}

export type LegacyTaskState = Omit<PersistedTaskState, "ownerId" | "controllerId" | "settings"> & {
  ownerId?: string;
  controllerId?: string;
  settings?: TaskExecutionSettings;
};

export type LegacyProjectCardState = Omit<PersistedProjectCardState, "ownerId"> & {
  ownerId?: string;
};

export type LegacyConfirmationState = Omit<PersistedConfirmationState, "ownerId"> & {
  ownerId?: string;
};

export interface LegacyPersistedStateV5 {
  version: 5;
  threads: Record<string, ThreadState>;
  projects: Record<string, ProjectState>;
  chats: Record<string, ChatState>;
  seenEvents: SeenEvent[];
  tasks: Record<string, LegacyTaskState>;
  projectCards: Record<string, LegacyProjectCardState>;
  confirmations: Record<string, LegacyConfirmationState>;
  device: DeviceState;
}

export interface LegacyPersistedStateV4 {
  version: 4;
  threads: Record<string, ThreadState>;
  projects: Record<string, ProjectState>;
  chats?: Record<string, ChatState>;
  seenEvents: SeenEvent[];
  tasks: Record<string, LegacyTaskState>;
  projectCards: Record<string, LegacyProjectCardState>;
  confirmations?: Record<string, LegacyConfirmationState>;
}

export interface LegacyPersistedStateV3 {
  version: 3;
  threads: Record<string, ThreadState>;
  projects: Record<string, ProjectState>;
  chats?: Record<string, ChatState>;
  seenEvents: SeenEvent[];
  tasks: Record<string, LegacyTaskState>;
  projectCards: Record<string, LegacyProjectCardState>;
}

export interface LegacyPersistedStateV2 {
  version: 2;
  threads: Record<string, ThreadState>;
  projects: Record<string, ProjectState>;
  seenEvents: SeenEvent[];
}

export interface LegacyPersistedStateV1 {
  version: 1;
  threads: Record<string, ThreadState>;
  seenEvents: SeenEvent[];
}
