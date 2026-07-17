import { describe, expect, it } from "vitest";

import {
  prepareRemoteMarkdown,
  redactDiagnosticText,
  redactSensitiveText,
  safeErrorText,
} from "../src/redaction.js";

describe("redaction", () => {
  it("redacts common credentials consistently", () => {
    const input = [
      "API_KEY=abc123",
      '"access_token":"secret-value"',
      "Authorization: Bearer abcdefghijklmnop",
      "https://alice:supersecret@example.com/path",
      `github_${"pat"}_1234567890abcdefghijklmnop`,
    ].join("\n");
    const output = redactSensitiveText(input);
    expect(output).not.toContain("abc123");
    expect(output).not.toContain("secret-value");
    expect(output).not.toContain("abcdefghijklmnop");
    expect(output).not.toContain("supersecret");
    expect(output).toContain("[REDACTED]");
  });

  it("turns local Markdown links into remote-safe file labels", () => {
    const input = [
      "[README.md](/Users/demo/work/README.md)",
      "[source](file:///tmp/source.ts)",
      "[docs](https://example.com/docs)",
    ].join("\n");
    const output = prepareRemoteMarkdown(input);
    expect(output).toContain("`README.md`");
    expect(output).toContain("`source`");
    expect(output).not.toContain("/Users/demo");
    expect(output).not.toContain("file:///tmp");
    expect(output).toContain("[docs](https://example.com/docs)");
  });

  it("collapses the home directory in diagnostics and bounds errors", () => {
    expect(
      redactDiagnosticText("/Users/demo/code API_KEY=secret", {
        homeDirectory: "/Users/demo",
      }),
    ).toBe("~/code API_KEY=[REDACTED]");
    expect(safeErrorText(new Error("password=hunter2\nnext line"), 80)).toBe(
      "password=[REDACTED] next line",
    );
  });
});
