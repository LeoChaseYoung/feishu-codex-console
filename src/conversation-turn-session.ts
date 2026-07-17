import type { CodexEvent, CodexUsage } from "./codex-events.js";
import type { LarkCli } from "./lark-cli.js";
import {
  applyCodexEvent,
  cancelTask,
  failTask,
  interruptTask,
  noteSteer,
  recoverTask,
  startTask,
  succeedTask,
  updateTaskCollaboration,
  updateQueuePosition,
  type TaskProgressContext,
  type TaskProgress,
} from "./progress.js";
import { prepareRemoteMarkdown, redactSensitiveText } from "./redaction.js";
import { runningActivity, taskModeOf } from "./task-intent.js";
import type { TaskReviewBaseline } from "./task-review.js";

// Feishu allows at most 20 edits for one text/post message. Keep ordinary
// answers progressive without exhausting the edit budget before the final
// response can replace the working state.
const STREAM_THROTTLE_MS = 1_800;
const MAX_PROGRESS_EDITS = 18;
const MAX_MESSAGE_EDITS = 20;

export interface ConversationTurnSnapshot {
  messageId: string;
  sequence: number;
  progress: TaskProgress;
}

export class ConversationTurnSession {
  private operationChain: Promise<void> = Promise.resolve();
  private pendingContent = "";
  private lastContent = "";
  private streamTimer: NodeJS.Timeout | null = null;
  private snapshotListener?: (
    snapshot: ConversationTurnSnapshot,
  ) => void | Promise<void>;

  private constructor(
    private readonly lark: LarkCli,
    readonly messageId: string,
    private current: TaskProgress,
    private sequence = 0,
  ) {
    this.lastContent = renderConversationTurn(current);
  }

  static async create(
    lark: LarkCli,
    progress: TaskProgress,
    replyToMessageId: string,
    idempotencyKey: string,
    replyInThread = false,
  ): Promise<ConversationTurnSession> {
    const content = renderConversationTurn(progress);
    const messageId = await lark.replyMarkdown(
      replyToMessageId,
      content,
      idempotencyKey,
      replyInThread,
    );
    if (!messageId) throw new Error("飞书没有返回自然回复消息 ID");
    return new ConversationTurnSession(lark, messageId, progress);
  }

  static restore(
    lark: LarkCli,
    messageId: string,
    progress: TaskProgress,
    sequence = 0,
  ): ConversationTurnSession {
    return new ConversationTurnSession(lark, messageId, progress, sequence);
  }

  get progress(): TaskProgress {
    return this.current;
  }

  get sequenceNumber(): number {
    return this.sequence;
  }

  onSnapshot(
    listener: (snapshot: ConversationTurnSnapshot) => void | Promise<void>,
  ): void {
    this.snapshotListener = listener;
  }

  async markRunning(
    reviewBaseline?: TaskReviewBaseline,
    permissionLabel?: string,
  ): Promise<void> {
    this.current = startTask(
      this.current,
      Date.now(),
      reviewBaseline,
      permissionLabel,
    );
    await this.update("start");
  }

  async markRecovered(note: string, queuePosition = 1): Promise<void> {
    this.current = recoverTask(this.current, queuePosition, note);
    await this.update("recover");
  }

  async updateQueuePosition(queuePosition: number): Promise<void> {
    const next = updateQueuePosition(this.current, queuePosition);
    if (next === this.current) return;
    this.current = next;
    await this.update("queue-position");
  }

  async markSteered(): Promise<void> {
    this.current = noteSteer(this.current);
    await this.update("steer");
  }

  async addActionNote(note: string): Promise<void> {
    this.current = { ...this.current, actionNote: note };
    await this.update("note");
  }

  async updateCollaboration(
    context: Pick<
      TaskProgressContext,
      | "initiatorLabel"
      | "controllerLabel"
      | "controllerSelector"
      | "handoffOptions"
      | "teamMode"
    >,
    note?: string,
  ): Promise<void> {
    this.current = updateTaskCollaboration(this.current, context, note);
    await this.update("collaboration");
  }

  handleCodexEvent(event: CodexEvent): void {
    this.current = { ...applyCodexEvent(this.current, event), actionNote: "" };
    this.scheduleUpdate(renderConversationTurn(this.current));
  }

  async finishSucceeded(
    finalResponse: string,
    usage: CodexUsage | null,
    threadId: string,
  ): Promise<boolean> {
    this.current = succeedTask(this.current, finalResponse, usage, threadId);
    return this.update("complete");
  }

  async finishFailed(error: string): Promise<boolean> {
    this.current = failTask(this.current, error);
    return this.update("fail");
  }

  async finishCancelled(reason: string): Promise<boolean> {
    if (this.current.phase === "cancelled") return true;
    this.current = cancelTask(this.current, reason);
    return this.update("cancel");
  }

  async finishInterrupted(reason: string): Promise<boolean> {
    this.current = interruptTask(this.current, reason);
    return this.update("interrupt");
  }

  async flush(): Promise<void> {
    await this.flushPendingUpdate();
    await this.operationChain;
  }

  private scheduleUpdate(content: string): void {
    this.pendingContent = content;
    if (this.streamTimer) return;
    this.streamTimer = setTimeout(() => {
      this.streamTimer = null;
      void this.flushPendingUpdate();
    }, STREAM_THROTTLE_MS);
    this.streamTimer.unref();
  }

  private async flushPendingUpdate(): Promise<void> {
    if (this.streamTimer) {
      clearTimeout(this.streamTimer);
      this.streamTimer = null;
    }
    const content = this.pendingContent;
    this.pendingContent = "";
    if (!content || content === this.lastContent) return;
    try {
      await this.enqueue("stream", content);
    } catch {
      // A later terminal update or the durable fallback will retry delivery.
    }
  }

  private async update(label: string): Promise<boolean> {
    await this.flushPendingUpdate();
    const content = renderConversationTurn(this.current);
    if (content === this.lastContent) {
      await this.notifySnapshot();
      return true;
    }
    try {
      await this.enqueue(label, content, isTerminalPhase(this.current.phase));
      return true;
    } catch {
      return false;
    }
  }

  private async enqueue(
    label: string,
    content: string,
    terminal = false,
  ): Promise<void> {
    const next = this.operationChain.then(async () => {
      if (!terminal && this.sequence >= MAX_PROGRESS_EDITS) return;
      if (terminal && this.sequence >= MAX_MESSAGE_EDITS) {
        throw new Error("飞书消息已达到最大可编辑次数");
      }
      await this.lark.updateMarkdown(this.messageId, content);
      this.sequence += 1;
      this.lastContent = content;
      await this.notifySnapshot();
    });
    this.operationChain = next.catch((error) => {
      console.error(`[conversation] ${label} update failed message=${this.messageId}`, error);
    });
    await next;
  }

  private async notifySnapshot(): Promise<void> {
    await this.snapshotListener?.({
      messageId: this.messageId,
      sequence: this.sequence,
      progress: this.current,
    });
  }
}

function isTerminalPhase(phase: TaskProgress["phase"]): boolean {
  return phase === "succeeded" ||
    phase === "failed" ||
    phase === "cancelled" ||
    phase === "interrupted";
}

export function renderConversationTurn(progress: TaskProgress): string {
  if (progress.phase === "succeeded") {
    return safeMarkdown(
      progress.finalResponse || progress.partialResponse || "Codex 已完成。",
    );
  }
  if (progress.phase === "failed") {
    return `**这次没有完成**\n\n${safeMarkdown(progress.error || "Codex 执行失败，请稍后重试。")}`;
  }
  if (progress.phase === "cancelled") {
    return `**已停止**\n\n${safeMarkdown(progress.error || "当前处理已由用户停止。")}`;
  }
  if (progress.phase === "interrupted") {
    return `**会话被中断**\n\n${safeMarkdown(progress.error || "本地服务中断了这次处理。")}`;
  }
  if (progress.phase === "queued") {
    const queue = progress.queuePosition > 1
      ? ` · 队列第 ${progress.queuePosition} 位`
      : "";
    return `已收到 · 正在准备${queue}`;
  }
  if (progress.actionNote.trim()) {
    return safeInline(progress.actionNote);
  }
  if (progress.partialResponse.trim()) {
    return `${safeMarkdown(progress.partialResponse)}\n\n正在继续生成…`;
  }
  const activity = progress.activity || runningActivity(taskModeOf(progress));
  return `${safeInline(activity)}…`;
}

function safeMarkdown(value: string): string {
  return prepareRemoteMarkdown(redactSensitiveText(value, 12_000))
    .replaceAll("<at", "＜at")
    .replaceAll("</at>", "＜/at＞")
    .replaceAll("<person", "＜person")
    .replaceAll("</person>", "＜/person＞")
    .trim();
}

function safeInline(value: string): string {
  return safeMarkdown(value).replace(/[*_`>#\[\]()]/g, "").replace(/\s+/g, " ").trim();
}
