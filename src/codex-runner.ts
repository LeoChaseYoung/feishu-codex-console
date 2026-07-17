import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  AppServerRpcError,
  CodexAppServerClient,
  resolveBundledCodexCommand,
  type AppServerHealth,
  type AppServerNotification,
  type AppServerRequest,
} from "./app-server-client.js";
import {
  normalizeAccountQuotaResponse,
  type AccountQuotaSnapshot,
} from "./account-quota.js";
import type { BridgeConfig } from "./config.js";
import type {
  CodexApprovalDecision,
  CodexApprovalRequest,
  CodexEvent,
  CodexInteractiveHandlers,
  CodexQuestion,
  CodexQuestionRequest,
  CodexThreadItem,
  CodexUsage,
} from "./codex-events.js";
import { isSupportedImageFile } from "./maintenance.js";
import { commandPolicyDecision, externalActionLabel } from "./policy.js";
import type {
  ExternalAction,
  ReasoningEffort,
  SandboxMode,
  TaskAttachment,
  TaskExecutionSettings,
} from "./types.js";

export interface CodexRunResult {
  finalResponse: string;
  threadId: string;
  usage: CodexUsage | null;
}

export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  supportedReasoningEfforts: ReasoningEffort[];
  defaultReasoningEffort: ReasoningEffort;
}

export interface CodexThreadSummary {
  id: string;
  name: string | null;
  preview: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  status: "active" | "idle" | "not_loaded" | "error";
}

export class CodexCancelledError extends Error {
  constructor(
    message: string,
    readonly reason: "manual" | "timeout" | "shutdown",
  ) {
    super(message);
    this.name = "CodexCancelledError";
  }
}

export class CodexPolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexPolicyViolationError";
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  settled: boolean;
}

interface ActiveRun {
  taskId: string;
  conversationKey: string;
  threadId?: string;
  turnId?: string;
  reason?: CodexCancelledError["reason"];
  policyViolation?: string;
  finalResponse: string;
  usage: CodexUsage | null;
  usageBaseline: CodexUsage | null;
  lastThreadUsage: CodexUsage | null;
  modelCalls: number;
  agentMessages: Map<string, string>;
  allowedExternalActions: ExternalAction[];
  sandboxMode: SandboxMode;
  onEvent?: (event: CodexEvent) => void;
  handlers: CodexInteractiveHandlers;
  completion: Deferred<CodexRunResult>;
  startedEventSent: boolean;
}

interface ThreadResponse {
  thread: { id: string };
}

interface TurnResponse {
  turn: { id: string; status: string };
}

interface RawNotificationParams {
  threadId?: string;
  turnId?: string;
  itemId?: string;
  delta?: string;
  item?: unknown;
  turn?: {
    id?: string;
    status?: string;
    error?: { message?: string } | null;
  };
  error?: { message?: string };
  willRetry?: boolean;
  tokenUsage?: {
    last?: RawTokenUsage;
    total?: RawTokenUsage;
    modelContextWindow?: number | null;
  };
  plan?: Array<{ step?: string; status?: string }>;
}

interface RawTokenUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
}

interface RawModelListResponse {
  data: unknown[];
  nextCursor?: string | null;
}

interface RawThreadListResponse {
  data: unknown[];
  nextCursor?: string | null;
}

type AppServerInput =
  | { type: "text"; text: string; text_elements: [] }
  | { type: "localImage"; path: string };

const BRIDGE_DEVELOPER_INSTRUCTIONS = [
  "This request comes from a remote Feishu control surface; keep execution proportional to the user's request.",
  "Do not spawn subagents or delegate work unless the user explicitly asks for agents, delegation, or parallel work.",
  "For a simple question or repository inspection, read only the minimum relevant files and stop once there is enough evidence to answer.",
  "Do not exhaustively scan tests, assets, styles, documentation, or the whole repository unless the request requires it.",
  "Do not run tests or builds for a read-only question unless verification is requested or materially needed for accuracy.",
].join(" ");

export class CodexRunner {
  private readonly client: CodexAppServerClient;
  private readonly activeRuns = new Map<string, ActiveRun>();

  constructor(private readonly config: BridgeConfig) {
    const featureArgs = config.multiAgentEnabled ? [] : ["--disable", "multi_agent"];
    const command = config.codexCliPath
      ? { command: config.codexCliPath, args: ["app-server", ...featureArgs] }
      : resolveBundledCodexCommand(featureArgs);
    this.client = new CodexAppServerClient({
      env: {
        ...buildCodexEnvironment(config),
        CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "feishu_codex_bridge",
      },
      command,
      onNotification: (notification) => this.handleNotification(notification),
      onRequest: (request) => this.handleServerRequest(request),
      onExit: (error) => this.handleAppServerExit(error),
    });
  }

  async run(
    conversationKey: string,
    taskId: string,
    prompt: string,
    workingDirectory: string,
    isGitRepository: boolean,
    existingThreadId?: string,
    onEvent?: (event: CodexEvent) => void,
    attachments: TaskAttachment[] = [],
    allowedExternalActions: ExternalAction[] = [],
    handlers: CodexInteractiveHandlers = {},
    executionSettings: TaskExecutionSettings = { sandboxMode: this.config.sandboxMode },
  ): Promise<CodexRunResult> {
    if (this.activeRuns.has(conversationKey)) {
      throw new Error("A Codex turn is already running for this conversation");
    }

    const active: ActiveRun = {
      taskId,
      conversationKey,
      finalResponse: "",
      usage: null,
      usageBaseline: null,
      lastThreadUsage: null,
      modelCalls: 0,
      agentMessages: new Map(),
      allowedExternalActions,
      sandboxMode: executionSettings.sandboxMode,
      ...(onEvent ? { onEvent } : {}),
      handlers,
      completion: deferred<CodexRunResult>(),
      startedEventSent: false,
    };
    this.activeRuns.set(conversationKey, active);
    const timeout = setTimeout(() => {
      active.reason = "timeout";
      void this.interruptActive(active);
    }, this.config.codexTimeoutMs);
    timeout.unref();

    try {
      const input = await this.buildInput(prompt, attachments, allowedExternalActions);
      const thread = await this.openThread(
        workingDirectory,
        isGitRepository,
        existingThreadId,
        executionSettings,
      );
      active.threadId = thread.thread.id;
      this.emit(active, { type: "thread.started", thread_id: active.threadId });

      const turn = await this.client.request<TurnResponse>("turn/start", {
        threadId: active.threadId,
        input,
        cwd: workingDirectory,
        approvalPolicy: this.approvalPolicy(executionSettings.sandboxMode),
        model: executionSettings.model ?? this.config.model ?? null,
        effort: executionSettings.reasoningEffort ?? this.config.reasoningEffort ?? null,
      });
      active.turnId = turn.turn.id;
      if (!active.startedEventSent) {
        active.startedEventSent = true;
        this.emit(active, { type: "turn.started" });
      }
      if (active.reason) await this.interruptActive(active);
      return await active.completion.promise;
    } catch (error) {
      if (active.policyViolation) {
        throw new CodexPolicyViolationError(`安全闸门已停止命令：${active.policyViolation}`);
      }
      if (active.reason) {
        throw new CodexCancelledError(`Codex task cancelled: ${active.reason}`, active.reason);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      this.activeRuns.delete(conversationKey);
    }
  }

  async steer(conversationKey: string, text: string): Promise<boolean> {
    const active = this.activeRuns.get(conversationKey);
    if (!active?.threadId || !active.turnId || active.completion.settled) return false;
    await this.client.request("turn/steer", {
      threadId: active.threadId,
      expectedTurnId: active.turnId,
      input: [{ type: "text", text, text_elements: [] }],
    });
    return true;
  }

  cancel(conversationKey: string, reason: CodexCancelledError["reason"] = "manual"): boolean {
    const active = this.activeRuns.get(conversationKey);
    if (!active || active.completion.settled) return false;
    active.reason = reason;
    void this.interruptActive(active);
    return true;
  }

  cancelAll(reason: CodexCancelledError["reason"] = "shutdown"): number {
    const count = this.activeRuns.size;
    for (const active of this.activeRuns.values()) {
      active.reason = reason;
      void this.interruptActive(active);
    }
    return count;
  }

  async close(): Promise<void> {
    this.cancelAll("shutdown");
    await this.client.close();
  }

  getActiveTask(conversationKey: string): string | undefined {
    return this.activeRuns.get(conversationKey)?.taskId;
  }

  get activeCount(): number {
    return this.activeRuns.size;
  }

  getHealth(): AppServerHealth {
    return this.client.getHealth();
  }

  async listModels(): Promise<CodexModel[]> {
    const response = await this.client.request<RawModelListResponse>("model/list", {
      limit: 100,
      includeHidden: false,
    });
    return response.data.flatMap(normalizeModel);
  }

  async readAccountQuota(): Promise<AccountQuotaSnapshot> {
    const response = await this.client.request<unknown>("account/rateLimits/read");
    return normalizeAccountQuotaResponse(response);
  }

  async listThreads(workingDirectory: string, limit = 12): Promise<CodexThreadSummary[]> {
    const response = await this.client.request<RawThreadListResponse>("thread/list", {
      limit: Math.max(1, Math.min(50, limit)),
      sortKey: "updated_at",
      sortDirection: "desc",
      cwd: workingDirectory,
      archived: false,
    });
    return response.data
      .flatMap(normalizeThreadSummary)
      .filter((thread) => threadBelongsToWorkingDirectory(thread, workingDirectory));
  }

  async compactThread(threadId: string): Promise<void> {
    await this.client.request("thread/compact/start", { threadId }, 60_000);
  }

  async nameThread(threadId: string, name: string): Promise<void> {
    await this.client.request("thread/name/set", { threadId, name: name.slice(0, 120) });
  }

  private async openThread(
    workingDirectory: string,
    isGitRepository: boolean,
    existingThreadId?: string,
    executionSettings: TaskExecutionSettings = { sandboxMode: this.config.sandboxMode },
  ): Promise<ThreadResponse> {
    const params = this.threadParams(workingDirectory, isGitRepository, executionSettings);
    if (existingThreadId) {
      try {
        return await this.client.request<ThreadResponse>("thread/resume", {
          threadId: existingThreadId,
          excludeTurns: true,
          ...params,
        });
      } catch (error) {
        console.warn(
          `[codex] unable to resume thread=${existingThreadId}; starting a new thread`,
          error,
        );
      }
    }
    return this.client.request<ThreadResponse>("thread/start", params);
  }

  private threadParams(
    workingDirectory: string,
    isGitRepository: boolean,
    executionSettings: TaskExecutionSettings,
  ): Record<string, unknown> {
    const config: Record<string, unknown> = {
      web_search: this.config.webSearchMode,
      sandbox_workspace_write: { network_access: this.config.networkAccessEnabled },
    };
    const workspaceInstruction =
      !isGitRepository && this.config.skipGitRepoCheck
        ? "This selected workspace is an authorized non-Git folder. Work in it directly."
        : "";
    return {
      cwd: workingDirectory,
      runtimeWorkspaceRoots: [workingDirectory],
      approvalPolicy: this.approvalPolicy(executionSettings.sandboxMode),
      approvalsReviewer: "user",
      sandbox: executionSettings.sandboxMode,
      model: executionSettings.model ?? this.config.model ?? null,
      developerInstructions: [BRIDGE_DEVELOPER_INSTRUCTIONS, workspaceInstruction]
        .filter(Boolean)
        .join(" "),
      config,
    };
  }

  private approvalPolicy(sandboxMode: SandboxMode): "on-request" | "untrusted" {
    return sandboxMode === "danger-full-access" ? "untrusted" : "on-request";
  }

  private handleNotification(notification: AppServerNotification): void {
    const params = asRecord(notification.params) as RawNotificationParams;
    const active = this.findActive(params.threadId, params.turnId);
    if (!active) return;

    switch (notification.method) {
      case "turn/started":
        if (params.turn?.id) active.turnId = params.turn.id;
        if (!active.startedEventSent) {
          active.startedEventSent = true;
          this.emit(active, { type: "turn.started" });
        }
        return;
      case "thread/tokenUsage/updated":
        this.updateTaskUsage(active, params.tokenUsage);
        return;
      case "item/started":
      case "item/completed": {
        const item = normalizeThreadItem(params.item);
        if (!item) return;
        if (item.type === "agent_message") {
          active.agentMessages.set(item.id, item.text);
          if (item.text) active.finalResponse = item.text;
        }
        if (item.type === "command_execution" && notification.method === "item/started") {
          const violation = this.commandViolation(item.command, active.allowedExternalActions);
          if (violation) {
            active.policyViolation = violation;
            void this.interruptActive(active);
          }
        }
        this.emit(active, {
          type: notification.method === "item/started" ? "item.started" : "item.completed",
          item,
        });
        return;
      }
      case "item/agentMessage/delta": {
        if (!params.itemId || typeof params.delta !== "string") return;
        const text = `${active.agentMessages.get(params.itemId) ?? ""}${params.delta}`;
        active.agentMessages.set(params.itemId, text);
        active.finalResponse = text;
        this.emit(active, {
          type: "item.updated",
          item: { id: params.itemId, type: "agent_message", text },
        });
        return;
      }
      case "turn/plan/updated": {
        const items = (params.plan ?? []).map((step) => ({
          text: step.step ?? "计划步骤",
          completed: step.status === "completed",
        }));
        this.emit(active, {
          type: "item.updated",
          item: { id: `plan-${params.turnId ?? active.turnId ?? "active"}`, type: "todo_list", items },
        });
        return;
      }
      case "error": {
        const message = params.error?.message ?? "Codex app-server error";
        this.emit(active, { type: "error", message });
        if (!params.willRetry) active.completion.reject(new Error(message));
        return;
      }
      case "turn/completed":
        this.finishTurn(active, params);
        return;
      default:
        return;
    }
  }

  private updateTaskUsage(
    active: ActiveRun,
    tokenUsage: RawNotificationParams["tokenUsage"],
  ): void {
    const total = normalizeUsage(tokenUsage?.total);
    const last = normalizeUsage(tokenUsage?.last);
    if (!total && !last) return;

    // App-server's `total` is cumulative for the whole thread, while `last`
    // covers only the most recent model response. Derive the thread baseline
    // from the first event, then report the delta so a resumed thread does not
    // charge old turns to the current Feishu task.
    if (total && last) {
      if (active.lastThreadUsage && sameUsage(total, active.lastThreadUsage)) return;
      const derived = deriveTaskUsage(
        total,
        last,
        active.usageBaseline,
        active.modelCalls + 1,
        tokenUsage?.modelContextWindow,
      );
      active.usageBaseline = derived.baseline;
      active.lastThreadUsage = total;
      active.modelCalls += 1;
      active.usage = derived.usage;
      return;
    }

    // Compatibility fallback for older app-server builds that only emit one
    // side of the breakdown. It is less precise, but never drops usage data.
    active.modelCalls += 1;
    const value = total ?? last!;
    active.usage = {
      ...value,
      model_calls: active.modelCalls,
      last_input_tokens: last?.input_tokens ?? value.input_tokens,
      last_cached_input_tokens: last?.cached_input_tokens ?? value.cached_input_tokens,
      ...(typeof tokenUsage?.modelContextWindow === "number"
        ? { model_context_window: tokenUsage.modelContextWindow }
        : {}),
    };
  }

  private finishTurn(active: ActiveRun, params: RawNotificationParams): void {
    const status = params.turn?.status ?? "completed";
    if (active.policyViolation) {
      active.completion.reject(
        new CodexPolicyViolationError(`安全闸门已停止命令：${active.policyViolation}`),
      );
      return;
    }
    if (active.reason || status === "interrupted") {
      const reason = active.reason ?? "manual";
      active.completion.reject(new CodexCancelledError(`Codex task cancelled: ${reason}`, reason));
      return;
    }
    if (status === "failed") {
      const message = params.turn?.error?.message ?? "Codex turn failed";
      this.emit(active, { type: "turn.failed", error: { message } });
      active.completion.reject(new Error(message));
      return;
    }
    this.emit(active, { type: "turn.completed", usage: active.usage });
    active.completion.resolve({
      finalResponse: active.finalResponse,
      threadId: active.threadId ?? "",
      usage: active.usage,
    });
  }

  private async handleServerRequest(request: AppServerRequest): Promise<unknown> {
    const params = asRecord(request.params);
    const threadId = stringValue(params.threadId) ?? stringValue(params.conversationId);
    const turnId = stringValue(params.turnId);
    const active = this.findActive(threadId, turnId);
    if (!active) throw new AppServerRpcError("No active Feishu task for request", -32001);

    switch (request.method) {
      case "item/commandExecution/requestApproval":
        return this.handleCommandApproval(request, params, active, false);
      case "execCommandApproval":
        return this.handleCommandApproval(request, params, active, true);
      case "item/fileChange/requestApproval":
      case "applyPatchApproval":
        return this.handleFileApproval(request, params, active, request.method === "applyPatchApproval");
      case "item/tool/requestUserInput":
        return this.handleUserInputRequest(request, params, active);
      case "item/permissions/requestApproval":
        return this.handlePermissionsApproval(request, params, active);
      case "mcpServer/elicitation/request":
        return { action: "decline", content: null, _meta: null };
      default:
        throw new AppServerRpcError(`Unsupported Codex request: ${request.method}`, -32601);
    }
  }

  private async handleCommandApproval(
    request: AppServerRequest,
    params: Record<string, unknown>,
    active: ActiveRun,
    legacy: boolean,
  ): Promise<unknown> {
    const rawCommand = params.command;
    const command = Array.isArray(rawCommand)
      ? rawCommand.map(String).join(" ")
      : stringValue(rawCommand) ?? "未知命令";
    const violation = this.commandViolation(command, active.allowedExternalActions);
    if (violation) {
      active.policyViolation = violation;
      return { decision: legacy ? "denied" : "decline" };
    }
    if (active.sandboxMode === "danger-full-access") {
      return { decision: legacy ? "approved" : "accept" };
    }

    const reason = stringValue(params.reason);
    const cwd = stringValue(params.cwd);
    const approval: CodexApprovalRequest = {
      id: String(request.id),
      kind: "command",
      threadId: active.threadId ?? "",
      turnId: active.turnId ?? "",
      itemId: stringValue(params.itemId) ?? stringValue(params.callId) ?? String(request.id),
      title: "Codex 请求执行命令",
      detail: command,
      command,
      ...(cwd ? { cwd } : {}),
      ...(reason ? { reason } : {}),
    };
    const decision = await this.requestApproval(active, approval);
    return { decision: legacy ? legacyDecision(decision) : decision };
  }

  private async handleFileApproval(
    request: AppServerRequest,
    params: Record<string, unknown>,
    active: ActiveRun,
    legacy: boolean,
  ): Promise<unknown> {
    const reason = stringValue(params.reason);
    const paths = Object.keys(asRecord(params.fileChanges));
    const approval: CodexApprovalRequest = {
      id: String(request.id),
      kind: "file_change",
      threadId: active.threadId ?? "",
      turnId: active.turnId ?? "",
      itemId: stringValue(params.itemId) ?? stringValue(params.callId) ?? String(request.id),
      title: "Codex 请求扩大文件写入范围",
      detail: paths.length > 0 ? paths.slice(0, 12).join("\n") : reason ?? "写入当前沙箱之外的文件",
      ...(reason ? { reason } : {}),
    };
    const decision = await this.requestApproval(active, approval);
    return { decision: legacy ? legacyDecision(decision) : decision };
  }

  private async handlePermissionsApproval(
    request: AppServerRequest,
    params: Record<string, unknown>,
    active: ActiveRun,
  ): Promise<unknown> {
    const requestedPermissions = asRecord(params.permissions);
    const reason = stringValue(params.reason);
    const cwd = stringValue(params.cwd);
    const approval: CodexApprovalRequest = {
      id: String(request.id),
      kind: "permissions",
      threadId: active.threadId ?? "",
      turnId: active.turnId ?? "",
      itemId: stringValue(params.itemId) ?? String(request.id),
      title: "Codex 请求临时权限",
      detail: reason ?? JSON.stringify(requestedPermissions, null, 2),
      ...(cwd ? { cwd } : {}),
      ...(reason ? { reason } : {}),
      requestedPermissions,
    };
    const decision = await this.requestApproval(active, approval);
    return {
      permissions: decision === "decline" ? {} : requestedPermissions,
      scope: decision === "acceptForSession" ? "session" : "turn",
    };
  }

  private async handleUserInputRequest(
    request: AppServerRequest,
    params: Record<string, unknown>,
    active: ActiveRun,
  ): Promise<unknown> {
    const questions = Array.isArray(params.questions)
      ? params.questions.map(normalizeQuestion).filter((value): value is CodexQuestion => value !== null)
      : [];
    const questionRequest: CodexQuestionRequest = {
      id: String(request.id),
      threadId: active.threadId ?? "",
      turnId: active.turnId ?? "",
      itemId: stringValue(params.itemId) ?? String(request.id),
      questions,
      autoResolutionMs:
        typeof params.autoResolutionMs === "number" ? params.autoResolutionMs : null,
    };
    const answers = active.handlers.requestUserInput
      ? await active.handlers.requestUserInput(questionRequest)
      : Object.fromEntries(questions.map((question) => [question.id, []]));
    return {
      answers: Object.fromEntries(
        questions.map((question) => [question.id, { answers: answers[question.id] ?? [] }]),
      ),
    };
  }

  private async requestApproval(
    active: ActiveRun,
    request: CodexApprovalRequest,
  ): Promise<CodexApprovalDecision> {
    if (!active.handlers.requestApproval) return "decline";
    return active.handlers.requestApproval(request);
  }

  private commandViolation(command: string, allowedExternalActions: ExternalAction[]): string | undefined {
    const decision = commandPolicyDecision(command);
    const missingActions = decision.requiredActions.filter(
      (action) => !allowedExternalActions.includes(action),
    );
    return (
      decision.blockedReason ??
      (missingActions.length > 0
        ? `未在飞书确认卡中授权：${missingActions.map(externalActionLabel).join("、")}`
        : undefined)
    );
  }

  private async interruptActive(active: ActiveRun): Promise<void> {
    if (!active.threadId || !active.turnId || active.completion.settled) return;
    try {
      await this.client.request(
        "turn/interrupt",
        { threadId: active.threadId, turnId: active.turnId },
        10_000,
      );
    } catch (error) {
      if (!active.completion.settled) {
        if (active.policyViolation) {
          active.completion.reject(
            new CodexPolicyViolationError(`安全闸门已停止命令：${active.policyViolation}`),
          );
        } else if (active.reason) {
          active.completion.reject(
            new CodexCancelledError(`Codex task cancelled: ${active.reason}`, active.reason),
          );
        } else {
          active.completion.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }
  }

  private handleAppServerExit(error: Error): void {
    for (const active of this.activeRuns.values()) {
      if (!active.completion.settled) active.completion.reject(error);
    }
  }

  private findActive(threadId?: string, turnId?: string): ActiveRun | undefined {
    for (const active of this.activeRuns.values()) {
      if (threadId && active.threadId && active.threadId !== threadId) continue;
      if (turnId && active.turnId && active.turnId !== turnId) continue;
      if (threadId && !active.threadId) continue;
      return active;
    }
    return undefined;
  }

  private emit(active: ActiveRun, event: CodexEvent): void {
    try {
      active.onEvent?.(event);
    } catch (error) {
      console.error(`[codex] progress handler failed task=${active.taskId}`, error);
    }
  }

  private async buildInput(
    userPrompt: string,
    attachments: TaskAttachment[],
    allowedExternalActions: ExternalAction[],
  ): Promise<AppServerInput[]> {
    const textAttachments = await Promise.all(
      attachments
        .filter((attachment) => attachment.kind === "text")
        .map(async (attachment) => ({
          attachment,
          text: await readTextAttachment(attachment, this.config),
        })),
    );
    const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
    await Promise.all(
      imageAttachments.map((attachment) => validateImageAttachment(attachment, this.config)),
    );
    const actionPolicy =
      allowedExternalActions.length > 0
        ? `The user explicitly confirmed these external actions: ${allowedExternalActions.join(", ")}. You may perform only those confirmed actions when required by the request.`
        : "Do not commit, push, deploy, publish, release, create a pull request, or merge a pull request.";
    const text = [
      "This request came from an authorized Feishu user through a restricted bridge.",
      "Operate only inside the selected project's configured working directory.",
      "You may inspect and edit workspace files and run relevant checks.",
      actionPolicy,
      "Never change credentials, contact people, or delete external data.",
      "For chat readability, lead with the answer, use short paragraphs and at most five bullets; avoid tables, repeated headings, and execution metadata unless asked.",
      "When a choice is required, use request_user_input so the Feishu user can answer remotely.",
      "",
      "User request:",
      userPrompt,
      ...textAttachments.flatMap(({ attachment, text: attachmentText }) => [
        "",
        `Attached text file: ${attachment.name}`,
        "```text",
        attachmentText,
        "```",
      ]),
    ].join("\n");

    return [
      { type: "text", text, text_elements: [] },
      ...imageAttachments.map((attachment) => ({
        type: "localImage" as const,
        path: attachment.path,
      })),
    ];
  }
}

const SAFE_CODEX_ENV_NAMES = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "SSH_AUTH_SOCK",
  "GPG_TTY",
  "CODEX_HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
  "NVM_BIN",
  "NVM_DIR",
  "NVM_INC",
  "PNPM_HOME",
  "VOLTA_HOME",
  "HOMEBREW_PREFIX",
  "HOMEBREW_CELLAR",
  "HOMEBREW_REPOSITORY",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
]);

export function buildCodexEnvironment(
  config: Pick<BridgeConfig, "codexAllowedEnvVars">,
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const allowed = new Set([...SAFE_CODEX_ENV_NAMES, ...config.codexAllowedEnvVars]);
  return Object.fromEntries(
    Object.entries(source).filter(
      (entry): entry is [string, string] => allowed.has(entry[0]) && entry[1] !== undefined,
    ),
  );
}

export function normalizeThreadItem(value: unknown): CodexThreadItem | null {
  const item = asRecord(value);
  const id = stringValue(item.id) ?? "unknown";
  switch (item.type) {
    case "agentMessage":
      return { id, type: "agent_message", text: stringValue(item.text) ?? "" };
    case "reasoning":
      return { id, type: "reasoning" };
    case "commandExecution":
      return {
        id,
        type: "command_execution",
        command: stringValue(item.command) ?? "",
        aggregated_output: stringValue(item.aggregatedOutput) ?? "",
        ...(typeof item.exitCode === "number" ? { exit_code: item.exitCode } : {}),
        status: normalizeStatus(item.status),
      };
    case "fileChange":
      return {
        id,
        type: "file_change",
        changes: Array.isArray(item.changes)
          ? item.changes.map((change) => {
              const record = asRecord(change);
              return {
                path: stringValue(record.path) ?? "unknown",
                kind: normalizeChangeKind(record.kind),
              };
            })
          : [],
        status: normalizeStatus(item.status),
      };
    case "mcpToolCall":
      return {
        id,
        type: "mcp_tool_call",
        server: stringValue(item.server) ?? "mcp",
        tool: stringValue(item.tool) ?? "unknown",
        status: normalizeStatus(item.status),
      };
    case "dynamicToolCall":
      return {
        id,
        type: "mcp_tool_call",
        server: stringValue(item.namespace) ?? "codex",
        tool: stringValue(item.tool) ?? "unknown",
        status: normalizeStatus(item.status),
      };
    case "collabAgentToolCall":
      return {
        id,
        type: "mcp_tool_call",
        server: "codex",
        tool: `agent/${stringValue(item.tool) ?? "collaboration"}`,
        status: normalizeStatus(item.status),
      };
    case "webSearch":
      return { id, type: "web_search", query: stringValue(item.query) ?? "" };
    default:
      return null;
  }
}

export function normalizeModel(value: unknown): CodexModel[] {
  const model = asRecord(value);
  const id = stringValue(model.id);
  const slug = stringValue(model.model) ?? id;
  if (!id || !slug || model.hidden === true) return [];
  const supported = Array.isArray(model.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts.flatMap((option) => {
        const effort = stringValue(asRecord(option).reasoningEffort);
        return effort && isReasoningEffort(effort) ? [effort] : [];
      })
    : [];
  const defaultEffortValue = stringValue(model.defaultReasoningEffort);
  const defaultReasoningEffort =
    defaultEffortValue && isReasoningEffort(defaultEffortValue)
      ? defaultEffortValue
      : supported[0] ?? "medium";
  return [
    {
      id,
      model: slug,
      displayName: stringValue(model.displayName) ?? slug,
      description: stringValue(model.description) ?? "",
      isDefault: model.isDefault === true,
      supportedReasoningEfforts: supported,
      defaultReasoningEffort,
    },
  ];
}

export function normalizeThreadSummary(value: unknown): CodexThreadSummary[] {
  const thread = asRecord(value);
  const id = stringValue(thread.id);
  const cwd = stringValue(thread.cwd);
  if (!id || !cwd || stringValue(thread.parentThreadId)) return [];
  const rawStatus = stringValue(asRecord(thread.status).type);
  const status: CodexThreadSummary["status"] =
    rawStatus === "active"
      ? "active"
      : rawStatus === "idle"
        ? "idle"
        : rawStatus === "systemError"
          ? "error"
          : "not_loaded";
  return [
    {
      id,
      name: typeof thread.name === "string" && thread.name.trim() ? thread.name.trim() : null,
      preview: stringValue(thread.preview) ?? "",
      cwd,
      createdAt: typeof thread.createdAt === "number" ? thread.createdAt : 0,
      updatedAt: typeof thread.updatedAt === "number" ? thread.updatedAt : 0,
      status,
    },
  ];
}

export function threadBelongsToWorkingDirectory(
  thread: Pick<CodexThreadSummary, "cwd">,
  workingDirectory: string,
): boolean {
  return Boolean(thread.cwd) && path.resolve(thread.cwd) === path.resolve(workingDirectory);
}

function isReasoningEffort(value: string): value is ReasoningEffort {
  return ["minimal", "low", "medium", "high", "xhigh", "ultra"].includes(value);
}

function normalizeQuestion(value: unknown): CodexQuestion | null {
  const question = asRecord(value);
  const id = stringValue(question.id);
  const text = stringValue(question.question);
  if (!id || !text) return null;
  return {
    id,
    header: stringValue(question.header) ?? "需要你的输入",
    question: text,
    isOther: question.isOther === true,
    isSecret: question.isSecret === true,
    options: Array.isArray(question.options)
      ? question.options.map((option) => {
          const record = asRecord(option);
          return {
            label: stringValue(record.label) ?? "选项",
            description: stringValue(record.description) ?? "",
          };
        })
      : [],
  };
}

function normalizeUsage(value: RawTokenUsage | undefined): CodexUsage | null {
  if (!value) return null;
  return {
    input_tokens: value.inputTokens ?? 0,
    cached_input_tokens: value.cachedInputTokens ?? 0,
    output_tokens: value.outputTokens ?? 0,
    reasoning_output_tokens: value.reasoningOutputTokens ?? 0,
  };
}

export function deriveTaskUsage(
  threadTotal: CodexUsage,
  lastCall: CodexUsage,
  existingBaseline: CodexUsage | null,
  modelCalls: number,
  modelContextWindow?: number | null,
): { baseline: CodexUsage; usage: CodexUsage } {
  const baseline = existingBaseline ?? subtractUsage(threadTotal, lastCall);
  return {
    baseline,
    usage: {
      ...subtractUsage(threadTotal, baseline),
      model_calls: modelCalls,
      last_input_tokens: lastCall.input_tokens,
      last_cached_input_tokens: lastCall.cached_input_tokens,
      ...(typeof modelContextWindow === "number"
        ? { model_context_window: modelContextWindow }
        : {}),
    },
  };
}

function subtractUsage(total: CodexUsage, baseline: CodexUsage): CodexUsage {
  return {
    input_tokens: Math.max(0, total.input_tokens - baseline.input_tokens),
    cached_input_tokens: Math.max(
      0,
      total.cached_input_tokens - baseline.cached_input_tokens,
    ),
    output_tokens: Math.max(0, total.output_tokens - baseline.output_tokens),
    reasoning_output_tokens: Math.max(
      0,
      total.reasoning_output_tokens - baseline.reasoning_output_tokens,
    ),
  };
}

function sameUsage(left: CodexUsage, right: CodexUsage): boolean {
  return (
    left.input_tokens === right.input_tokens &&
    left.cached_input_tokens === right.cached_input_tokens &&
    left.output_tokens === right.output_tokens &&
    left.reasoning_output_tokens === right.reasoning_output_tokens
  );
}

function normalizeStatus(value: unknown): "in_progress" | "completed" | "failed" | "declined" {
  if (value === "completed") return "completed";
  if (value === "failed") return "failed";
  if (value === "declined") return "declined";
  return "in_progress";
}

function normalizeChangeKind(value: unknown): "add" | "delete" | "update" {
  const kind = typeof value === "string" ? value : asRecord(value).type;
  if (kind === "add" || kind === "delete") return kind;
  return "update";
}

function legacyDecision(decision: CodexApprovalDecision): string {
  if (decision === "accept") return "approved";
  if (decision === "acceptForSession") return "approved_for_session";
  return "denied";
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: Error) => void;
  const result: Deferred<T> = {
    promise: Promise.resolve(undefined as T),
    resolve: () => undefined,
    reject: () => undefined,
    settled: false,
  };
  result.promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  result.resolve = (value) => {
    if (result.settled) return;
    result.settled = true;
    resolvePromise(value);
  };
  result.reject = (error) => {
    if (result.settled) return;
    result.settled = true;
    rejectPromise(error);
  };
  return result;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

async function readTextAttachment(
  attachment: TaskAttachment,
  config: Pick<BridgeConfig, "maxTextAttachmentBytes">,
): Promise<string> {
  let details;
  try {
    details = await stat(attachment.path);
  } catch {
    throw new Error(`附件 ${attachment.name} 已过期或已被清理，请重新发送。`);
  }
  if (!details.isFile() || details.size > config.maxTextAttachmentBytes) {
    throw new Error(`附件 ${attachment.name} 不再符合安全读取限制，请重新发送。`);
  }
  const bytes = await readFile(attachment.path);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\u0000")) throw new Error("binary text attachment");
    return text;
  } catch {
    throw new Error(`附件 ${attachment.name} 不是有效的 UTF-8 文本。`);
  }
}

async function validateImageAttachment(
  attachment: TaskAttachment,
  config: Pick<BridgeConfig, "maxAttachmentBytes">,
): Promise<void> {
  let details;
  try {
    details = await stat(attachment.path);
  } catch {
    throw new Error(`附件 ${attachment.name} 已过期或已被清理，请重新发送。`);
  }
  if (
    !details.isFile() ||
    details.size > config.maxAttachmentBytes ||
    !(await isSupportedImageFile(attachment.path))
  ) {
    throw new Error(`附件 ${attachment.name} 不再符合安全读取限制，请重新发送。`);
  }
}
