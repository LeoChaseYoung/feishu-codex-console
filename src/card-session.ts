import type { CodexEvent, CodexUsage } from "./codex-events.js";

import type { LarkCli } from "./lark-cli.js";
import {
  applyCodexEvent,
  attachTaskReview,
  cancelTask,
  failTask,
  interruptTask,
  noteSteer,
  noteTask,
  recoverTask,
  startTask,
  succeedTask,
  updateQueuePosition,
  updateTaskCollaboration,
  type TaskProgressContext,
  type TaskProgress,
} from "./progress.js";
import type { TaskReviewBaseline, TaskReviewSnapshot } from "./task-review.js";
import {
  renderStreamContent,
  renderTaskCard,
  type FeishuCard,
} from "./task-card.js";

const STREAM_THROTTLE_MS = 700;

export interface TaskCardSnapshot {
  cardId: string;
  messageId: string;
  sequence: number;
  progress: TaskProgress;
}

export class TaskCardSession {
  private sequence = 0;
  private operationChain: Promise<void> = Promise.resolve();
  private pendingContent = "";
  private lastContent = "";
  private streamTimer: NodeJS.Timeout | null = null;
  private snapshotListener?: (snapshot: TaskCardSnapshot) => void | Promise<void>;

  private constructor(
    private readonly lark: LarkCli,
    readonly cardId: string,
    readonly messageId: string,
    private current: TaskProgress,
    sequence = 0,
  ) {
    this.sequence = sequence;
    this.lastContent = renderStreamContent(current);
  }

  static async create(
    lark: LarkCli,
    progress: TaskProgress,
    replyToMessageId: string,
    idempotencyKey: string,
    replyInThread = false,
  ): Promise<TaskCardSession> {
    const cardId = await lark.createCard(renderTaskCard(progress));
    const messageId = await lark.replyCard(
      replyToMessageId,
      cardId,
      idempotencyKey,
      replyInThread,
    );
    return new TaskCardSession(lark, cardId, messageId ?? "", progress);
  }

  static restore(
    lark: LarkCli,
    cardId: string,
    messageId: string,
    progress: TaskProgress,
    sequence: number,
  ): TaskCardSession {
    return new TaskCardSession(lark, cardId, messageId, progress, sequence);
  }

  get progress(): TaskProgress {
    return this.current;
  }

  get sequenceNumber(): number {
    return this.sequence;
  }

  onSnapshot(listener: (snapshot: TaskCardSnapshot) => void | Promise<void>): void {
    this.snapshotListener = listener;
  }

  async markRunning(
    reviewBaseline?: TaskReviewBaseline,
    permissionLabel?: string,
  ): Promise<void> {
    this.current = startTask(this.current, Date.now(), reviewBaseline, permissionLabel);
    await this.updateFullCard("start");
  }

  async markRecovered(note: string, queuePosition = 1): Promise<void> {
    this.current = recoverTask(this.current, queuePosition, note);
    await this.updateFullCard("recover");
  }

  async updateQueuePosition(queuePosition: number): Promise<void> {
    const next = updateQueuePosition(this.current, queuePosition);
    if (next === this.current) return;
    this.current = next;
    await this.updateFullCard("queue-position");
  }

  async markSteered(): Promise<void> {
    this.current = noteSteer(this.current);
    await this.updateFullCard("steer");
  }

  handleCodexEvent(event: CodexEvent): void {
    this.current = applyCodexEvent(this.current, event);
    this.scheduleStream(renderStreamContent(this.current));
  }

  async finishSucceeded(
    finalResponse: string,
    usage: CodexUsage | null,
    threadId: string,
  ): Promise<boolean> {
    this.current = succeedTask(this.current, finalResponse, usage, threadId);
    return this.updateFullCard("complete");
  }

  async finishFailed(error: string): Promise<boolean> {
    this.current = failTask(this.current, error);
    return this.updateFullCard("fail");
  }

  async finishCancelled(reason: string): Promise<boolean> {
    if (this.current.phase === "cancelled") return true;
    this.current = cancelTask(this.current, reason);
    return this.updateFullCard("cancel");
  }

  async finishInterrupted(reason: string): Promise<boolean> {
    this.current = interruptTask(this.current, reason);
    return this.updateFullCard("interrupt");
  }

  async addActionNote(note: string): Promise<void> {
    this.current = noteTask(this.current, note);
    await this.updateFullCard("note");
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
    await this.updateFullCard("collaboration");
  }

  async attachReview(review: TaskReviewSnapshot): Promise<void> {
    this.current = attachTaskReview(this.current, review);
    await this.updateFullCard("review");
  }

  async showSurface(card: FeishuCard, label = "surface"): Promise<boolean> {
    await this.flushStream();
    return this.enqueue(label, async () => {
      this.sequence += 1;
      await this.lark.updateCard(this.cardId, card, this.sequence);
      await this.notifySnapshot();
    });
  }

  async restoreTaskSurface(): Promise<boolean> {
    return this.updateFullCard("restore-task");
  }

  async flush(): Promise<void> {
    await this.flushStream();
    await this.operationChain;
  }

  private scheduleStream(content: string): void {
    this.pendingContent = content;
    if (this.streamTimer) return;
    this.streamTimer = setTimeout(() => {
      this.streamTimer = null;
      void this.flushStream();
    }, STREAM_THROTTLE_MS);
    this.streamTimer.unref();
  }

  private async flushStream(): Promise<void> {
    if (this.streamTimer) {
      clearTimeout(this.streamTimer);
      this.streamTimer = null;
    }
    const content = this.pendingContent;
    this.pendingContent = "";
    if (!content || content === this.lastContent) return;
    await this.enqueue("stream", async () => {
      this.sequence += 1;
      await this.lark.streamCardContent(this.cardId, "stream_text", content, this.sequence);
      this.lastContent = content;
      await this.notifySnapshot();
    });
  }

  private async updateFullCard(label: string): Promise<boolean> {
    await this.flushStream();
    const card = renderTaskCard(this.current);
    const content = renderStreamContent(this.current);
    return this.enqueue(label, async () => {
      this.sequence += 1;
      await this.lark.updateCard(this.cardId, card, this.sequence);
      this.lastContent = content;
      await this.notifySnapshot();
    });
  }

  private async enqueue(label: string, operation: () => Promise<void>): Promise<boolean> {
    const next = this.operationChain.then(operation);
    this.operationChain = next.catch((error) => {
      console.error(`[card] ${label} update failed card=${this.cardId}`, error);
    });
    try {
      await next;
      return true;
    } catch {
      return false;
    }
  }

  private async notifySnapshot(): Promise<void> {
    await this.snapshotListener?.({
      cardId: this.cardId,
      messageId: this.messageId,
      sequence: this.sequence,
      progress: this.current,
    });
  }
}
