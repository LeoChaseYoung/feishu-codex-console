import { describe, expect, it } from "vitest";

import { sanitizeSessionPreview } from "../src/session-preview.js";

describe("session preview safety", () => {
  it("replaces raw bridge instructions with a neutral fallback", () => {
    expect(
      sanitizeSessionPreview(
        "This request comes from a remote Feishu control surface; keep execution proportional.",
      ),
    ).toBe("历史会话（暂无用户摘要）");
  });

  it("extracts only the user request from a wrapped bridge prompt", () => {
    expect(
      sanitizeSessionPreview(
        "This request came from an authorized Feishu user through a restricted bridge. User request:\n修复登录页",
      ),
    ).toBe("修复登录页");
  });

  it("keeps ordinary user previews compact", () => {
    expect(sanitizeSessionPreview("  这个项目的定位是什么？\n")).toBe(
      "这个项目的定位是什么？",
    );
  });
});
