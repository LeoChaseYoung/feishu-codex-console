import { describe, expect, it } from "vitest";

import { renderExternalConfirmationCard } from "../src/confirmation-card.js";

function collectByKey(value: unknown, key: string, result: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const item of value) collectByKey(item, key, result);
    return result;
  }
  if (typeof value !== "object" || value === null) return result;
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === key) result.push(entryValue);
    collectByKey(entryValue, key, result);
  }
  return result;
}

describe("external action confirmation card", () => {
  it("renders explicit approve and reject callbacks", () => {
    const card = renderExternalConfirmationCard(
      "confirm-1",
      "提交并推送这个项目",
      "feishu-codex-bridge",
      ["commit", "push"],
    );
    const actions = collectByKey(card, "action") as string[];

    expect(card.schema).toBe("2.0");
    expect(actions).toEqual(expect.arrayContaining(["approve_external", "reject_external"]));
    expect(JSON.stringify(card)).toContain("提交代码");
    expect(JSON.stringify(card)).toContain("推送远端");
  });

  it("removes action buttons after a decision", () => {
    const card = renderExternalConfirmationCard(
      "confirm-1",
      "部署项目",
      "bridge",
      ["deploy"],
      "approved",
    );
    expect(collectByKey(card, "behaviors")).toHaveLength(0);
    expect(JSON.stringify(card)).toContain("已确认");
  });

  it("redacts credentials from the displayed original task", () => {
    const card = renderExternalConfirmationCard(
      "confirm-secret",
      "部署 API_KEY=do-not-render",
      "bridge",
      ["deploy"],
    );
    expect(JSON.stringify(card)).not.toContain("do-not-render");
    expect(JSON.stringify(card)).toContain("REDACTED");
  });
});
