import { describe, expect, it } from "vitest";

import { TaskQueue } from "../src/task-queue.js";

async function until(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition not reached");
}

describe("TaskQueue", () => {
  it("runs different conversations concurrently", async () => {
    const queue = new TaskQueue();
    const order: string[] = [];
    queue.enqueue({
      id: "1",
      conversationKey: "a",
      run: async () => {
        order.push("1-start");
        await new Promise((resolve) => setTimeout(resolve, 15));
        order.push("1-end");
      },
    });
    queue.enqueue({
      id: "2",
      conversationKey: "b",
      run: async () => {
        order.push("2");
      },
    });
    await until(() => order.includes("2"));
    expect(order).toEqual(["1-start", "2"]);
    await until(() => order.includes("1-end"));
  });

  it("runs tasks from the same conversation serially", async () => {
    const queue = new TaskQueue(2);
    const order: string[] = [];
    queue.enqueue({
      id: "1",
      conversationKey: "a",
      run: async () => {
        order.push("1-start");
        await new Promise((resolve) => setTimeout(resolve, 15));
        order.push("1-end");
      },
    });
    queue.enqueue({
      id: "2",
      conversationKey: "a",
      run: async () => {
        order.push("2");
      },
    });
    await until(() => order.includes("2"));
    expect(order).toEqual(["1-start", "1-end", "2"]);
  });

  it("serializes different chats that target the same project", async () => {
    const queue = new TaskQueue(2);
    const order: string[] = [];
    queue.enqueue({
      id: "1",
      conversationKey: "a",
      resourceKey: "/repos/shared",
      run: async () => {
        order.push("1-start");
        await new Promise((resolve) => setTimeout(resolve, 15));
        order.push("1-end");
      },
    });
    queue.enqueue({
      id: "2",
      conversationKey: "b",
      resourceKey: "/repos/shared",
      run: async () => {
        order.push("2");
      },
    });
    await until(() => order.includes("2"));
    expect(order).toEqual(["1-start", "1-end", "2"]);
  });

  it("removes pending jobs for one conversation", async () => {
    const queue = new TaskQueue(1);
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    queue.enqueue({ id: "active", conversationKey: "x", run: () => blocker });
    queue.enqueue({ id: "drop", conversationKey: "a", run: async () => undefined });
    queue.enqueue({ id: "keep", conversationKey: "b", run: async () => undefined });
    expect(queue.cancelPending("a")).toBe(1);
    expect(queue.pendingCount).toBe(1);
    release();
    await until(() => queue.pendingCount === 0 && queue.active === null);
  });

  it("cancels one queued task and invokes its hook", async () => {
    const queue = new TaskQueue();
    let release!: () => void;
    let cancelled = false;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    queue.enqueue({ id: "active", conversationKey: "a", run: () => blocker });
    queue.enqueue({
      id: "drop",
      conversationKey: "a",
      run: async () => undefined,
      onCancel: () => {
        cancelled = true;
      },
    });

    expect(queue.cancelTask("drop")).toBe(true);
    await until(() => cancelled);
    expect(queue.cancelTask("drop")).toBe(false);
    release();
    await until(() => queue.active === null);
  });

  it("updates remaining queue positions when an earlier task is cancelled", async () => {
    const queue = new TaskQueue(1);
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const positions: number[] = [];
    queue.enqueue({ id: "active", conversationKey: "a", run: () => blocker });
    queue.enqueue({ id: "first", conversationKey: "a", run: async () => undefined });
    queue.enqueue({
      id: "second",
      conversationKey: "a",
      run: async () => undefined,
      onPositionChange: (position) => positions.push(position),
    });

    await until(() => positions.includes(3));
    expect(queue.cancelTask("first")).toBe(true);
    await until(() => positions.includes(2));
    expect(positions.at(-1)).toBe(2);
    release();
    await until(() => queue.active === null);
  });
});
