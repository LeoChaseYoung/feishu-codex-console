import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("global product response routing", () => {
  it("uses natural Markdown for routine replies and keeps raw text as reliability fallback", async () => {
    const source = await readFile(path.join(root, "src", "index.ts"), "utf8");
    expect(source.match(/\blark\.reply\(/g)).toHaveLength(1);
    expect(source).toContain("async function deliverTextFallback(");
    expect(source).toContain("await lark.replyMarkdown(");
    expect(source).toContain("session.replyInThread");
    expect(source).toContain("await deliverTextFallback(messageId, safeText, idempotencyKey)");
    expect(source).toContain("await deliverTextFallback(\n        item.payload.messageId");
  });
});
