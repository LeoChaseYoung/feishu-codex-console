import { describe, expect, it, vi } from "vitest";

import { TaskCardSession } from "../src/card-session.js";
import type { LarkCli } from "../src/lark-cli.js";
import { createTaskProgress } from "../src/progress.js";
import { renderResponseCard } from "../src/response-card.js";

describe("task card terminal reliability", () => {
  it("reports a failed terminal card update so callers can send a text fallback", async () => {
    const lark = {
      updateCard: vi.fn().mockRejectedValue(new Error("503 temporarily unavailable")),
      streamCardContent: vi.fn().mockResolvedValue(undefined),
    } as unknown as LarkCli;
    const session = TaskCardSession.restore(
      lark,
      "card-1",
      "message-1",
      createTaskProgress("task-1", "test", 1, "project"),
      0,
    );

    await expect(session.finishFailed("network error")).resolves.toBe(false);
    expect(session.progress.phase).toBe("failed");
  });

  it("reports a successful terminal card update", async () => {
    const lark = {
      updateCard: vi.fn().mockResolvedValue(undefined),
      streamCardContent: vi.fn().mockResolvedValue(undefined),
    } as unknown as LarkCli;
    const session = TaskCardSession.restore(
      lark,
      "card-1",
      "message-1",
      createTaskProgress("task-1", "test", 1, "project"),
      0,
    );

    await expect(session.finishCancelled("user request")).resolves.toBe(true);
    expect(session.progress.phase).toBe("cancelled");
  });

  it("switches auxiliary surfaces on the original card and restores the task", async () => {
    const lark = {
      updateCard: vi.fn().mockResolvedValue(undefined),
      streamCardContent: vi.fn().mockResolvedValue(undefined),
    } as unknown as LarkCli;
    const session = TaskCardSession.restore(
      lark,
      "card-1",
      "message-1",
      createTaskProgress("task-1", "test", 1, "project"),
      2,
    );

    await expect(session.showSurface(renderResponseCard("detail"), "detail")).resolves.toBe(true);
    await expect(session.restoreTaskSurface()).resolves.toBe(true);
    expect(lark.updateCard).toHaveBeenCalledTimes(2);
    expect(session.sequenceNumber).toBe(4);
  });
});
