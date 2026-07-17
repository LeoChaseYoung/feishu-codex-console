import { describe, expect, it } from "vitest";

import {
  buildCodexEnvironment,
  deriveTaskUsage,
  normalizeModel,
  normalizeThreadItem,
  normalizeThreadSummary,
  threadBelongsToWorkingDirectory,
} from "../src/codex-runner.js";

const usage = (
  input_tokens: number,
  cached_input_tokens: number,
  output_tokens: number,
) => ({
  input_tokens,
  cached_input_tokens,
  output_tokens,
  reasoning_output_tokens: 0,
});

describe("Codex process environment", () => {
  it("reports the complete current task instead of only the final model call", () => {
    const first = deriveTaskUsage(
      usage(371_902, 295_936, 2_885),
      usage(36_515, 0, 371),
      null,
      1,
      258_400,
    );
    expect(first.baseline).toEqual(usage(335_387, 295_936, 2_514));
    expect(first.usage).toMatchObject({
      input_tokens: 36_515,
      cached_input_tokens: 0,
      output_tokens: 371,
      model_calls: 1,
    });

    const final = deriveTaskUsage(
      usage(409_094, 331_520, 2_955),
      usage(37_192, 35_584, 70),
      first.baseline,
      2,
      258_400,
    );
    expect(final.usage).toMatchObject({
      input_tokens: 73_707,
      cached_input_tokens: 35_584,
      output_tokens: 441,
      model_calls: 2,
      last_input_tokens: 37_192,
      model_context_window: 258_400,
    });
  });

  it("passes only safe defaults and explicitly allowed variables", () => {
    const environment = buildCodexEnvironment(
      { codexAllowedEnvVars: ["PROJECT_SPECIFIC_TOKEN"] },
      {
        PATH: "/usr/bin:/bin",
        HOME: "/Users/demo",
        SSH_AUTH_SOCK: "/tmp/ssh.sock",
        FEISHU_APP_SECRET: "feishu-secret",
        OPENAI_API_KEY: "openai-secret",
        NPM_TOKEN: "npm-secret",
        PROJECT_SPECIFIC_TOKEN: "explicit-secret",
      },
    );

    expect(environment).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: "/Users/demo",
      SSH_AUTH_SOCK: "/tmp/ssh.sock",
      PROJECT_SPECIFIC_TOKEN: "explicit-secret",
    });
  });

  it("normalizes app-server file changes without losing add/delete kinds", () => {
    expect(
      normalizeThreadItem({
        id: "change-1",
        type: "fileChange",
        status: "completed",
        changes: [
          { path: "src/new.ts", kind: "add" },
          { path: "src/old.ts", kind: "delete" },
          { path: "src/main.ts", kind: "update" },
        ],
      }),
    ).toMatchObject({
      type: "file_change",
      changes: [
        { path: "src/new.ts", kind: "add" },
        { path: "src/old.ts", kind: "delete" },
        { path: "src/main.ts", kind: "update" },
      ],
    });
  });

  it("normalizes the app-server model catalog and top-level sessions", () => {
    expect(
      normalizeModel({
        id: "gpt-5.4",
        model: "gpt-5.4",
        displayName: "GPT-5.4",
        description: "Latest",
        hidden: false,
        isDefault: true,
        supportedReasoningEfforts: [
          { reasoningEffort: "medium" },
          { reasoningEffort: "high" },
        ],
        defaultReasoningEffort: "medium",
      }),
    ).toMatchObject([
      {
        model: "gpt-5.4",
        displayName: "GPT-5.4",
        supportedReasoningEfforts: ["medium", "high"],
      },
    ]);
    expect(
      normalizeThreadSummary({
        id: "thread-1",
        parentThreadId: null,
        cwd: "/repos/bridge",
        preview: "Fix the tests",
        name: "Repair",
        createdAt: 1,
        updatedAt: 2,
        status: { type: "idle" },
      }),
    ).toMatchObject([{ id: "thread-1", status: "idle", name: "Repair" }]);
    expect(
      normalizeThreadSummary({
        id: "subagent-1",
        parentThreadId: "thread-1",
        cwd: "/repos/bridge",
      }),
    ).toEqual([]);
    expect(
      threadBelongsToWorkingDirectory({ cwd: "/repos/bridge" }, "/repos/bridge"),
    ).toBe(true);
    expect(
      threadBelongsToWorkingDirectory({ cwd: "/repos/private" }, "/repos/bridge"),
    ).toBe(false);
  });
});
