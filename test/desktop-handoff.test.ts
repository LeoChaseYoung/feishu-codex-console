import { describe, expect, it, vi } from "vitest";

import {
  codexResumeCommand,
  codexThreadUrl,
  openCodexThreadInDesktop,
} from "../src/desktop-handoff.js";

describe("Codex desktop handoff", () => {
  it("opens the exact native thread URL on macOS without a shell", async () => {
    const launch = vi.fn(async () => undefined);
    const result = await openCodexThreadInDesktop("019f6402-0c19-7140-a2f1-c06dcb4cc459", {
      platform: "darwin",
      launch,
    });

    expect(result.status).toBe("opened");
    expect(result.url).toBe("codex://threads/019f6402-0c19-7140-a2f1-c06dcb4cc459");
    expect(launch).toHaveBeenCalledWith("open", [
      "-b",
      "com.openai.codex",
      "codex://threads/019f6402-0c19-7140-a2f1-c06dcb4cc459",
    ]);
  });

  it("returns a truthful resume fallback on unsupported systems", async () => {
    const launch = vi.fn(async () => undefined);
    const result = await openCodexThreadInDesktop("thread_123", {
      platform: "linux",
      launch,
    });

    expect(result.status).toBe("unsupported");
    expect(result.fallbackCommand).toBe("codex resume thread_123");
    expect(launch).not.toHaveBeenCalled();
  });

  it("reports launch failure instead of claiming the desktop opened", async () => {
    const result = await openCodexThreadInDesktop("thread-123", {
      platform: "darwin",
      launch: async () => {
        throw new Error("application not found");
      },
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("application not found");
    expect(result.fallbackCommand).toBe("codex resume thread-123");
  });

  it("rejects unsafe thread IDs before building URLs or commands", () => {
    expect(() => codexThreadUrl("thread; rm -rf /")).toThrow("无效的 Codex 会话 ID");
    expect(() => codexResumeCommand("thread with spaces")).toThrow("无效的 Codex 会话 ID");
  });
});
