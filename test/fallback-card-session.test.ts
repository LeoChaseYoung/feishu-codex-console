import { describe, expect, it, vi } from "vitest";

import { FallbackCardSession } from "../src/fallback-card-session.js";
import type { LarkCli } from "../src/lark-cli.js";

describe("fallback card session", () => {
  it("creates one response card and updates the same card through terminal state", async () => {
    const lark = {
      createCard: vi.fn().mockResolvedValue("card-1"),
      replyCard: vi.fn().mockResolvedValue("message-1"),
      updateCard: vi.fn().mockResolvedValue(undefined),
    } as unknown as LarkCli;
    const session = await FallbackCardSession.create(
      lark,
      "source-message",
      "任务已接收",
      "task-accepted",
      "accepted-1",
    );

    await expect(session.update("任务执行中", "task-running")).resolves.toBe(true);
    await expect(session.update("任务已完成", "task-completed")).resolves.toBe(true);
    expect(lark.createCard).toHaveBeenCalledTimes(1);
    expect(lark.replyCard).toHaveBeenCalledTimes(1);
    expect(lark.updateCard).toHaveBeenCalledTimes(2);
    expect(session.sequenceNumber).toBe(2);
  });

  it("restores the persisted sequence before updating", async () => {
    const lark = {
      updateCard: vi.fn().mockResolvedValue(undefined),
    } as unknown as LarkCli;
    const session = FallbackCardSession.restore(lark, "card-1", "message-1", 4);
    await expect(session.update("已恢复", "task-recovered")).resolves.toBe(true);
    expect(lark.updateCard).toHaveBeenCalledWith("card-1", expect.any(Object), 5);
  });
});
