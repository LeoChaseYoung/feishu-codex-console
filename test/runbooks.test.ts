import { describe, expect, it } from "vitest";

import {
  parseRunbookCatalog,
  parseRunbookInvocation,
  renderRunbookPrompt,
  runbookHasDefaultInputs,
} from "../src/runbooks.js";

describe("team runbooks", () => {
  it("loads fixed and parameterized safe templates", () => {
    const [runbook] = parseRunbookCatalog(
      JSON.stringify({
        version: 1,
        runbooks: [
          {
            id: "verify",
            name: "验证模块",
            description: "运行测试并修复",
            prompt: "验证 {{module}} 模块并修复测试。",
            sandboxMode: "workspace-write",
            reasoningEffort: "high",
            parameters: [
              { name: "module", label: "模块", required: true, default: "core" },
            ],
          },
        ],
      }),
    );
    expect(runbook).toBeDefined();
    expect(runbookHasDefaultInputs(runbook!)).toBe(true);
    expect(renderRunbookPrompt(runbook!, { module: "auth" })).toBe("验证 auth 模块并修复测试。");
  });

  it("parses explicit parameter values without accepting loose trailing text", () => {
    expect(parseRunbookInvocation('/run verify module="auth flow"')).toEqual({
      id: "verify",
      values: { module: "auth flow" },
    });
    expect(parseRunbookInvocation("/run verify this is not key value")).toBeNull();
  });

  it("rejects templates that could pre-authorize external mutations or full access", () => {
    expect(() =>
      parseRunbookCatalog(
        JSON.stringify({
          version: 1,
          runbooks: [{ id: "ship", name: "发布", prompt: "git push 当前分支" }],
        }),
      ),
    ).toThrow(/不允许预授权外部动作/);
    expect(() =>
      parseRunbookCatalog(
        JSON.stringify({
          version: 1,
          runbooks: [
            {
              id: "unsafe",
              name: "完全访问",
              prompt: "检查项目",
              sandboxMode: "danger-full-access",
            },
          ],
        }),
      ),
    ).toThrow(/sandboxMode/);
  });

  it("requires every placeholder to be declared and every required value to exist", () => {
    const [runbook] = parseRunbookCatalog(
      JSON.stringify({
        version: 1,
        runbooks: [
          {
            id: "inspect",
            name: "检查",
            prompt: "检查 {{area}}",
            parameters: [{ name: "area", label: "区域", required: true }],
          },
        ],
      }),
    );
    expect(runbookHasDefaultInputs(runbook!)).toBe(false);
    expect(() => renderRunbookPrompt(runbook!)).toThrow(/缺少参数/);
  });
});
