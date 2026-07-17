import { describe, expect, it } from "vitest";

import { taskFailurePresentation } from "../src/task-failure.js";

describe("task failure presentation", () => {
  it.each([
    ["Codex task timed out", "timeout"],
    ["安全闸门已停止命令", "policy"],
    ["EACCES: permission denied", "permission"],
    ["Codex app-server connection closed", "connection"],
    ["Task queue is paused", "queue"],
    ["unexpected response", "unknown"],
  ] as const)("classifies %s", (message, kind) => {
    const presentation = taskFailurePresentation(message);
    expect(presentation.kind).toBe(kind);
    expect(presentation.title).toBeTruthy();
    expect(presentation.nextAction).toBeTruthy();
  });
});
