import { describe, expect, it } from "vitest";

import type { CodexModel } from "../src/codex-runner.js";
import {
  compatibleModelSettings,
  resolveModelPreference,
} from "../src/model-capabilities.js";

const models: CodexModel[] = [
  {
    id: "gpt-default",
    model: "gpt-default",
    displayName: "GPT Default",
    description: "Default model",
    isDefault: true,
    supportedReasoningEfforts: ["low", "medium", "high"],
    defaultReasoningEffort: "medium",
  },
];

describe("model capability compatibility", () => {
  it("lets a conversation explicitly restore the native default over a global pin", () => {
    expect(resolveModelPreference("__default__", "globally-pinned")).toBeUndefined();
    expect(resolveModelPreference(undefined, "globally-pinned")).toBe("globally-pinned");
    expect(resolveModelPreference("conversation-model", "globally-pinned")).toBe(
      "conversation-model",
    );
  });

  it("falls back from a removed model and unsupported effort", () => {
    const result = compatibleModelSettings(
      {
        model: "removed-model",
        reasoningEffort: "ultra",
        sandboxMode: "workspace-write",
      },
      models,
    );
    expect(result.settings).toEqual({
      reasoningEffort: "medium",
      sandboxMode: "workspace-write",
    });
    expect(result.effectiveModel?.model).toBe("gpt-default");
    expect(result.notices).toHaveLength(2);
  });

  it("keeps requested settings when the model catalog is unavailable", () => {
    const requested = {
      model: "configured-model",
      reasoningEffort: "high" as const,
      sandboxMode: "read-only" as const,
    };
    expect(compatibleModelSettings(requested, []).settings).toEqual(requested);
  });
});
