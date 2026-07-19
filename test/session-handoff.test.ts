import { describe, expect, it } from "vitest";

import {
  assessSessionHandoff,
  deriveThreadActivity,
} from "../src/session-handoff.js";

describe("session handoff activity source", () => {
  it("labels a bridge turn as Feishu activity", () => {
    expect(
      deriveThreadActivity({
        threadUpdatedAt: 2_000,
        latestFeishuActivityAt: 2_003_000,
      }),
    ).toEqual({ source: "feishu", activityAt: 2_003_000 });
  });

  it("labels a later native turn as desktop activity", () => {
    expect(
      deriveThreadActivity({
        threadUpdatedAt: 2_020,
        latestFeishuActivityAt: 2_000_000,
      }),
    ).toEqual({ source: "desktop", activityAt: 2_020_000 });
  });

  it("treats an unseen native thread as desktop-created", () => {
    expect(deriveThreadActivity({ threadUpdatedAt: 2_000 })).toEqual({
      source: "desktop",
      activityAt: 2_000_000,
    });
  });

  it("keeps the source honest when ownership exists but task history is missing", () => {
    expect(
      deriveThreadActivity({ threadUpdatedAt: 2_000, bridgeOwned: true }),
    ).toEqual({ source: "unknown", activityAt: 2_000_000 });
  });
});

describe("session handoff concurrency guard", () => {
  it("allows handoff only when the conversation is idle", () => {
    expect(assessSessionHandoff(undefined, 0)).toEqual({
      blocked: false,
      active: false,
      queued: 0,
    });
  });

  it("blocks both active and queued work without cancelling either", () => {
    expect(assessSessionHandoff("task-1", 2)).toEqual({
      blocked: true,
      active: true,
      queued: 2,
    });
  });
});
