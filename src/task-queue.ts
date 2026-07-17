export interface QueueJob {
  id: string;
  conversationKey: string;
  resourceKey?: string;
  run: () => Promise<void>;
  onCancel?: () => void | Promise<void>;
  onPositionChange?: (position: number) => void | Promise<void>;
}

export class QueueCapacityError extends Error {
  constructor(readonly conversationKey: string) {
    super("This conversation already has the maximum number of queued tasks");
    this.name = "QueueCapacityError";
  }
}

export class TaskQueue {
  private readonly pending: QueueJob[] = [];
  private readonly activeJobs = new Map<string, QueueJob>();
  private readonly activeConversations = new Set<string>();
  private readonly activeResources = new Set<string>();
  private readonly idleWaiters = new Set<() => void>();
  private paused = false;

  constructor(
    private readonly maxConcurrency = 2,
    private readonly maxQueuedPerConversation = 5,
  ) {
    if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency <= 0) {
      throw new Error("maxConcurrency must be a positive integer");
    }
    if (!Number.isSafeInteger(maxQueuedPerConversation) || maxQueuedPerConversation <= 0) {
      throw new Error("maxQueuedPerConversation must be a positive integer");
    }
  }

  enqueue(job: QueueJob): number {
    if (this.paused) throw new Error("Task queue is paused");
    if (this.queuedForConversation(job.conversationKey) >= this.maxQueuedPerConversation) {
      throw new QueueCapacityError(job.conversationKey);
    }
    this.pending.push(job);
    const position = this.positionForTask(job.id, job.conversationKey);
    this.notifyPositions();
    void this.drain();
    return position;
  }

  nextPosition(conversationKey: string): number {
    return (
      this.queuedForConversation(conversationKey) +
      (this.activeConversations.has(conversationKey) ? 1 : 0) +
      1
    );
  }

  canEnqueue(conversationKey: string): boolean {
    return this.queuedForConversation(conversationKey) < this.maxQueuedPerConversation;
  }

  cancelPending(conversationKey: string): number {
    let removed = 0;
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      if (this.pending[index]?.conversationKey === conversationKey) {
        const [job] = this.pending.splice(index, 1);
        if (job) this.notifyCancelled(job);
        removed += 1;
      }
    }
    if (removed > 0) this.notifyPositions();
    return removed;
  }

  cancelAllPending(): number {
    const count = this.pending.length;
    const jobs = this.pending.splice(0);
    for (const job of jobs) this.notifyCancelled(job);
    if (count > 0) this.notifyPositions();
    return count;
  }

  cancelTask(taskId: string): boolean {
    const index = this.pending.findIndex((job) => job.id === taskId);
    if (index < 0) return false;
    const [job] = this.pending.splice(index, 1);
    if (job) this.notifyCancelled(job);
    this.notifyPositions();
    return true;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get active(): QueueJob | null {
    return this.activeJobs.values().next().value ?? null;
  }

  get activeCount(): number {
    return this.activeJobs.size;
  }

  getActiveTask(conversationKey: string): string | undefined {
    for (const job of this.activeJobs.values()) {
      if (job.conversationKey === conversationKey) return job.id;
    }
    return undefined;
  }

  pause(): void {
    this.paused = true;
  }

  waitForIdle(): Promise<void> {
    if (this.activeJobs.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  queuedForConversation(conversationKey: string): number {
    return this.pending.filter((job) => job.conversationKey === conversationKey).length;
  }

  private async drain(): Promise<void> {
    if (this.paused) return;
    while (this.activeJobs.size < this.maxConcurrency) {
      const index = this.pending.findIndex(
        (job) =>
          !this.activeConversations.has(job.conversationKey) &&
          !this.activeResources.has(this.resourceKey(job)),
      );
      if (index < 0) return;
      const [next] = this.pending.splice(index, 1);
      if (!next) return;

      this.activeJobs.set(next.id, next);
      this.activeConversations.add(next.conversationKey);
      this.activeResources.add(this.resourceKey(next));
      this.notifyPositions();
      void this.runJob(next);
    }
  }

  private async runJob(job: QueueJob): Promise<void> {
    try {
      await job.run();
    } catch (error) {
      console.error(`[queue] unhandled task error id=${job.id}`, error);
    } finally {
      this.activeJobs.delete(job.id);
      this.activeConversations.delete(job.conversationKey);
      this.activeResources.delete(this.resourceKey(job));
      this.notifyPositions();
      if (this.activeJobs.size === 0) {
        for (const resolve of this.idleWaiters) resolve();
        this.idleWaiters.clear();
      }
      void this.drain();
    }
  }

  private resourceKey(job: QueueJob): string {
    return job.resourceKey ?? `conversation:${job.conversationKey}`;
  }

  private positionForTask(taskId: string, conversationKey: string): number {
    let position = this.activeConversations.has(conversationKey) ? 1 : 0;
    for (const job of this.pending) {
      if (job.conversationKey !== conversationKey) continue;
      position += 1;
      if (job.id === taskId) return position;
    }
    return Math.max(1, position);
  }

  private notifyCancelled(job: QueueJob): void {
    try {
      void Promise.resolve(job.onCancel?.()).catch((error) => {
        console.error(`[queue] cancellation hook failed id=${job.id}`, error);
      });
    } catch (error) {
      console.error(`[queue] cancellation hook failed id=${job.id}`, error);
    }
  }

  private notifyPositions(): void {
    const positions = new Map<string, number>();
    for (const conversationKey of this.activeConversations) positions.set(conversationKey, 1);
    for (const job of this.pending) {
      const position = (positions.get(job.conversationKey) ?? 0) + 1;
      positions.set(job.conversationKey, position);
      try {
        void Promise.resolve(job.onPositionChange?.(position)).catch((error) => {
          console.error(`[queue] position hook failed id=${job.id}`, error);
        });
      } catch (error) {
        console.error(`[queue] position hook failed id=${job.id}`, error);
      }
    }
  }
}
